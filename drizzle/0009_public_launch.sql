-- Public launch: recorded acceptance of the site terms and privacy policy, and an abuse throttle.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_version" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;
--> statement-breakpoint
-- No grant to easier_app: only system (server) code reads or writes it.
CREATE TABLE IF NOT EXISTS "throttle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "throttle_events_key_created" ON "throttle_events" ("key", "created_at");
