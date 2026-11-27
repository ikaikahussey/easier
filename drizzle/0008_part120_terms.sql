-- Part 120 terms acceptance: which text the employer accepted, who signed, and when.
ALTER TABLE "p120_programs" ADD COLUMN IF NOT EXISTS "terms_version" text;
--> statement-breakpoint
ALTER TABLE "p120_programs" ADD COLUMN IF NOT EXISTS "terms_hash" text;
--> statement-breakpoint
ALTER TABLE "p120_programs" ADD COLUMN IF NOT EXISTS "terms_signer" text;
--> statement-breakpoint
ALTER TABLE "p120_programs" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "p120_programs" ADD COLUMN IF NOT EXISTS "terms_accepted_by" uuid REFERENCES "users"("id");
