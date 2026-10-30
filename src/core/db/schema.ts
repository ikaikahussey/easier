import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tenancy model: the organization is the tenant. Every table holding client data
 * carries org_id, and composite foreign keys force each child row's org_id to match
 * its engagement's. Row-level security policies live in drizzle/0001_tenant_isolation.sql.
 * Columns ending in _enc hold ciphertext sealed with the org's data key.
 */

export interface Filing {
  submissionId: string;
  filedOn: string;
  acknowledgedOn?: string;
  result?: "accepted" | "rejected";
  rejectionNote?: string;
}

export interface Invoice {
  amountCents: number;
  issuedOn: string;
  paidOn?: string;
  reference?: string;
}

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["client", "reviewer", "admin"] }).notNull().default("client"),
  credentials: text("credentials"),
  /** Reviewer credential, e.g. "EA" or "CPA"; must match a product's reviewerCredentials to approve it. */
  credentialType: text("credential_type"),
  credentialNumber: text("credential_number"),
  /** Issuing state for a CPA license; "IRS" for an enrolled agent. */
  credentialJurisdiction: text("credential_jurisdiction"),
  ptin: text("ptin"),
  efin: text("efin"),
  credentialSubmittedAt: timestamp("credential_submitted_at", { withTimezone: true }),
  /** Set by an admin after checking the credential against the issuing body. Cleared when the credential changes. */
  credentialVerifiedAt: timestamp("credential_verified_at", { withTimezone: true }),
  credentialVerifiedBy: uuid("credential_verified_by").references((): AnyPgColumn => users.id),
  createdAt: createdAt(),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Launch waitlist. System access only: the restricted app role has no grant on this table. */
export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  kind: text("kind", { enum: ["nonprofit", "small_business", "other"] }).notNull().default("other"),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  ein: text("ein"),
  /** Public profile (city, state, website, subsection) — not client-confidential. */
  profile: jsonb("profile").notNull().default({}),
  /** Prior-year figures from public filings. */
  publicFilings: jsonb("public_filings").notNull().default([]),
  createdAt: createdAt(),
});

export const orgKeys = pgTable("org_keys", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id),
  wrappedKey: text("wrapped_key").notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const engagements = pgTable(
  "engagements",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    product: text("product").notNull(),
    period: text("period").notNull(),
    status: text("status").notNull(),
    intakeEnc: text("intake_enc").notNull(),
    /** Price is not client-confidential and is needed for queue views. */
    quote: jsonb("quote").notNull(),
    dueDate: text("due_date"),
    extendedDueDate: text("extended_due_date"),
    assignedReviewerId: uuid("assigned_reviewer_id").references(() => users.id),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    /** Active reviewer time in seconds, accumulated from the review timer and manual entries. */
    reviewSeconds: integer("review_seconds").notNull().default(0),
    /** Set while the review timer is running. */
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    /** E-file record after delivery: submission ID and IRS acknowledgement. */
    filing: jsonb("filing").$type<Filing>(),
    /** Manual invoice record (pilot); no payment processor yet. */
    invoice: jsonb("invoice").$type<Invoice>(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("engagements_id_org").on(t.id, t.orgId),
    unique("engagements_org_product_period").on(t.orgId, t.product, t.period),
    index("engagements_status_idx").on(t.status),
  ],
);

/** Child rows reference (engagement_id, org_id) so they can never point across tenants. */
const engagementChild = <T extends { engagementId: any; orgId: any }>(t: T, name: string) =>
  foreignKey({ name, columns: [t.engagementId, t.orgId], foreignColumns: [engagements.id, engagements.orgId] });

export const documents = pgTable(
  "documents",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    contentEnc: text("content_enc").notNull(),
    parsedEnc: text("parsed_enc").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [engagementChild(t, "documents_engagement_fk"), index("documents_engagement_idx").on(t.engagementId)],
);

export const drafts = pgTable(
  "drafts",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    version: integer("version").notNull(),
    snapshotEnc: text("snapshot_enc").notNull(),
    overridesEnc: text("overrides_enc").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [engagementChild(t, "drafts_engagement_fk"), unique("drafts_engagement_version").on(t.engagementId, t.version)],
);

/**
 * Payroll records live at the organization level, outside any engagement: employees are
 * ongoing, and schedules and timesheets accumulate between pay runs. Only members read
 * them. A pay run copies what it needs into engagement documents, which is how staff see it.
 */
export const employees = pgTable(
  "employees",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    active: boolean("active").notNull().default(true),
    /** EmployeeProfile: name, pay, W-4/HW-4 elections, payment details. */
    profileEnc: text("profile_enc").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("employees_id_org").on(t.id, t.orgId), index("employees_org_idx").on(t.orgId)],
);

const employeeChild = <T extends { employeeId: any; orgId: any }>(t: T, name: string) =>
  foreignKey({ name, columns: [t.employeeId, t.orgId], foreignColumns: [employees.id, employees.orgId] });

/** Planned work: the schedule. */
export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    date: text("date").notNull(),
    /** HH:MM, local to the organization. A shift ending before it starts runs past midnight. */
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [employeeChild(t, "shifts_employee_fk"), index("shifts_org_date_idx").on(t.orgId, t.date)],
);

/** Work done: the timesheet. One row per employee per day. */
export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    date: text("date").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    source: text("source", { enum: ["manual", "schedule"] }).notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [employeeChild(t, "time_entries_employee_fk"), unique("time_entries_employee_date").on(t.employeeId, t.date), index("time_entries_org_date_idx").on(t.orgId, t.date)],
);

/** Append-only audit trail, including every staff read of client data. */
export const events = pgTable(
  "events",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type").notNull(),
    payloadEnc: text("payload_enc"),
    createdAt: createdAt(),
  },
  (t) => [engagementChild(t, "events_engagement_fk"), index("events_engagement_idx").on(t.engagementId)],
);
