-- Tenant isolation.
-- Application requests touching client data run as plainfirm_app (SET LOCAL ROLE) with
-- app.user_id / app.staff_user_id set per transaction. plainfirm_app does not own the
-- tables, so the policies below always apply to it. Tenancy is derived from the
-- memberships table, never from a client-supplied org id. Staff (reviewers) see queue
-- metadata, but read documents, drafts, and events only for engagements assigned to them.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plainfirm_app') THEN
    CREATE ROLE plainfirm_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT plainfirm_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO plainfirm_app;
--> statement-breakpoint
GRANT SELECT (id, role, name, credentials) ON users TO plainfirm_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON organizations TO plainfirm_app;
--> statement-breakpoint
GRANT SELECT ON org_keys, memberships TO plainfirm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON engagements TO plainfirm_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON documents, drafts, events TO plainfirm_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
-- Staff identity is honored only if the users table agrees the account is staff.
CREATE OR REPLACE FUNCTION app_staff() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT u.id FROM users u
  WHERE u.id = nullif(current_setting('app.staff_user_id', true), '')::uuid
    AND u.role IN ('reviewer', 'admin')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION is_member(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = org AND m.user_id = app_user())
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION staff_assigned(eng uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_staff() IS NOT NULL AND EXISTS (
    SELECT 1 FROM engagements e WHERE e.id = eng AND e.assigned_reviewer_id = app_staff()
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION staff_assigned_org(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_staff() IS NOT NULL AND EXISTS (
    SELECT 1 FROM engagements e WHERE e.org_id = org AND e.assigned_reviewer_id = app_staff()
  )
$$;
--> statement-breakpoint

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_read ON organizations FOR SELECT TO plainfirm_app
  USING (is_member(id) OR app_staff() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE TO plainfirm_app
  USING (is_member(id)) WITH CHECK (is_member(id));
--> statement-breakpoint

ALTER TABLE org_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_keys_read ON org_keys FOR SELECT TO plainfirm_app
  USING (is_member(org_id) OR staff_assigned_org(org_id));
--> statement-breakpoint

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_read ON memberships FOR SELECT TO plainfirm_app
  USING (user_id = app_user());
--> statement-breakpoint

ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY engagements_read ON engagements FOR SELECT TO plainfirm_app
  USING (is_member(org_id) OR app_staff() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY engagements_insert ON engagements FOR INSERT TO plainfirm_app
  WITH CHECK (is_member(org_id) AND assigned_reviewer_id IS NULL);
--> statement-breakpoint
CREATE POLICY engagements_update ON engagements FOR UPDATE TO plainfirm_app
  USING (is_member(org_id) OR assigned_reviewer_id = app_staff())
  WITH CHECK (is_member(org_id) OR assigned_reviewer_id = app_staff());
--> statement-breakpoint

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_access ON documents FOR ALL TO plainfirm_app
  USING (is_member(org_id) OR staff_assigned(engagement_id))
  WITH CHECK (is_member(org_id) OR staff_assigned(engagement_id));
--> statement-breakpoint

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY drafts_access ON drafts FOR ALL TO plainfirm_app
  USING (is_member(org_id) OR staff_assigned(engagement_id))
  WITH CHECK (is_member(org_id) OR staff_assigned(engagement_id));
--> statement-breakpoint

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY events_access ON events FOR ALL TO plainfirm_app
  USING (is_member(org_id) OR staff_assigned(engagement_id))
  WITH CHECK (is_member(org_id) OR staff_assigned(engagement_id));
