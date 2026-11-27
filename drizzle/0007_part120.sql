-- Part 120 Compliance Desk: program settings, sealed records, and an append-only log.
-- Only members of the employer's organization can read or write these tables. Staff get no
-- policy at all: a service agent may not act as the designated employer representative
-- (49 CFR 40.355), and test records are confidential (49 CFR part 40, subpart P).
CREATE TABLE IF NOT EXISTS "p120_programs" (
  "org_id" uuid PRIMARY KEY NOT NULL REFERENCES "organizations"("id"),
  "operation" text NOT NULL,
  "registration_kind" text NOT NULL,
  "registration_ref" text NOT NULL,
  "der_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "time_zone" text NOT NULL,
  "mis_notified" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "p120_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "p120_programs"("org_id"),
  "kind" text NOT NULL,
  "data_enc" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "p120_records_org_kind_idx" ON "p120_records" ("org_id", "kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "p120_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "p120_programs"("org_id"),
  "actor_id" uuid REFERENCES "users"("id"),
  "type" text NOT NULL,
  "payload_enc" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "p120_log_org_idx" ON "p120_log" ("org_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION is_member_user(org uuid, usr uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = org AND m.user_id = usr)
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "p120_programs", "p120_records" TO easier_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "p120_log" TO easier_app;
--> statement-breakpoint
ALTER TABLE "p120_programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p120_programs_member ON "p120_programs" FOR ALL TO easier_app
  USING (is_member(org_id)) WITH CHECK (is_member(org_id) AND is_member_user(org_id, der_user_id));
--> statement-breakpoint
ALTER TABLE "p120_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p120_records_member ON "p120_records" FOR ALL TO easier_app
  USING (is_member(org_id)) WITH CHECK (is_member(org_id));
--> statement-breakpoint
ALTER TABLE "p120_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY p120_log_member ON "p120_log" FOR ALL TO easier_app
  USING (is_member(org_id)) WITH CHECK (is_member(org_id) AND actor_id = app_user());
