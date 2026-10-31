-- Self-service sign-up: email verification timestamp. Existing accounts (created only through
-- emailed links) are verified by definition.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
