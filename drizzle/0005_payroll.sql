-- Easier Payroll: employees, schedule (shifts), and timesheet (time entries) at the organization level.
-- Members read and write their own organization's rows; staff never read these tables directly.
-- A pay run copies the roster and timesheet into engagement documents, which carry their own policies.
CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "active" boolean DEFAULT true NOT NULL,
  "profile_enc" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "employees_id_org" UNIQUE("id", "org_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_org_idx" ON "employees" ("org_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "date" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "break_minutes" integer DEFAULT 0 NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shifts_employee_fk" FOREIGN KEY ("employee_id", "org_id") REFERENCES "employees"("id", "org_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_org_date_idx" ON "shifts" ("org_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "date" text NOT NULL,
  "minutes" integer NOT NULL,
  "note" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "time_entries_employee_fk" FOREIGN KEY ("employee_id", "org_id") REFERENCES "employees"("id", "org_id"),
  CONSTRAINT "time_entries_employee_date" UNIQUE("employee_id", "date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_date_idx" ON "time_entries" ("org_id", "date");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "employees", "shifts", "time_entries" TO easier_app;
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employees_access ON "employees" FOR ALL TO easier_app
  USING (is_member(org_id)) WITH CHECK (is_member(org_id));
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shifts_access ON "shifts" FOR ALL TO easier_app
  USING (is_member(org_id)) WITH CHECK (is_member(org_id));
--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entries_access ON "time_entries" FOR ALL TO easier_app
  USING (is_member(org_id)) WITH CHECK (is_member(org_id));
