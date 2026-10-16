-- Pilot operations: reviewer credentials, reviewer time, filing status, invoices.
--
-- Credentials are staff records managed through system code. The restricted role may read
-- only the two columns the approval gate checks.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_type" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_number" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_jurisdiction" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ptin" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "efin" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_verified_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
GRANT SELECT ("credential_type", "credential_verified_at") ON "users" TO easier_app;
--> statement-breakpoint

-- Engagement metadata (not client-confidential; staff queue views read it).
-- review_seconds accumulates active review time; review_started_at is set while a timer runs.
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "review_seconds" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "review_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "filing" jsonb;
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "invoice" jsonb;
