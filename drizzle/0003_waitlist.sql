-- Launch waitlist. No grant to easier_app: only system (server) code reads or writes it.
CREATE TABLE IF NOT EXISTS "waitlist" (
  "email" text PRIMARY KEY NOT NULL,
  "kind" text DEFAULT 'other' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
