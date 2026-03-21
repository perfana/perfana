-- Migration: Add organization scoping to API keys
-- RBAC Phase 2: API keys must be scoped to an organization
--
-- Adds:
-- - organization_id: The organization this API key belongs to
-- - created_by: User who created the API key
-- - updated_by: User who last modified the API key
--
-- All fields are nullable initially for backward compatibility.
-- Existing API keys without organization will only work for global admins.

-- Add organization and ownership columns
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS organization_id UUID,
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);

-- Add foreign key constraint
ALTER TABLE api_keys
ADD CONSTRAINT fk_api_keys_organization
FOREIGN KEY (organization_id) REFERENCES organizations(id)
ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id
  ON api_keys(organization_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by
  ON api_keys(created_by);

-- Add comments
COMMENT ON COLUMN api_keys.organization_id IS
  'Organization this API key belongs to. NULL only allowed for legacy keys (global admin only).';

COMMENT ON COLUMN api_keys.created_by IS
  'User ID (Keycloak sub) who created this API key';

COMMENT ON COLUMN api_keys.updated_by IS
  'User ID (Keycloak sub) who last modified this API key';
