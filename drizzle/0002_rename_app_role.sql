-- Brand rename: the restricted application role becomes easier_app.
-- Grants, memberships, and row-level security policies follow the role through the rename.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plainfirm_app')
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'easier_app') THEN
    ALTER ROLE plainfirm_app RENAME TO easier_app;
  END IF;
END $$;
