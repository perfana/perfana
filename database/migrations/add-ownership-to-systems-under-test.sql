-- Migration: Add ownership and organization tracking to systems_under_test
-- RBAC Phase 2: Organization-based multi-tenant authorization
--
-- Adds:
-- - organization_id: Organization this system belongs to
-- - created_by: User who created the system (Keycloak sub or api-key:{id})
-- - updated_by: User who last modified the system
--
-- All fields are nullable initially for backward compatibility with existing data.
-- A future migration will populate organization_id from team relationships and
-- make it required.

-- Add ownership columns (nullable for backward compatibility)
ALTER TABLE systems_under_test
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS organization_id UUID;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_systems_under_test_organization_id
  ON systems_under_test(organization_id);

CREATE INDEX IF NOT EXISTS idx_systems_under_test_created_by
  ON systems_under_test(created_by);

CREATE INDEX IF NOT EXISTS idx_systems_under_test_org_created
  ON systems_under_test(organization_id, created_at DESC);

-- Add comment explaining the columns
COMMENT ON COLUMN systems_under_test.organization_id IS
  'Organization this system belongs to. Nullable for backward compatibility. Will be required after data migration.';

COMMENT ON COLUMN systems_under_test.created_by IS
  'User ID (Keycloak sub) or API key identifier (api-key:{id}) who created this system';

COMMENT ON COLUMN systems_under_test.updated_by IS
  'User ID (Keycloak sub) or API key identifier (api-key:{id}) who last modified this system';
