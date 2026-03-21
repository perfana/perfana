-- Migration: Add backend_url to pyroscope_instances
-- Date: 2025-12-09
-- Description: Adds backend_url field for API access, separate from frontend URL used for iframe display

-- Add backend_url column (nullable for now)
ALTER TABLE pyroscope_instances
ADD COLUMN IF NOT EXISTS backend_url TEXT;

-- Add comment to the new column
COMMENT ON COLUMN pyroscope_instances.backend_url IS 'Backend API URL for programmatic access (e.g., http://localhost:4040)';

-- Update existing records to use the frontend URL as backend URL for standalone instances
UPDATE pyroscope_instances
SET backend_url = pyroscope_url
WHERE pyroscope_stand_alone = true AND backend_url IS NULL;

-- For Grafana-embedded instances, set backend_url to null (will need to be configured manually)
-- Users should update these with the actual Pyroscope API URL

-- Log completion
SELECT 'Successfully added backend_url to pyroscope_instances table' as status;
