import { sql } from "drizzle-orm";
import {
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

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["client", "reviewer", "admin"] }).notNull().default("client"),
  credentials: text("credentials"),
  createdAt: createdAt(),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
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
