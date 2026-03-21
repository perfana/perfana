-- Migration: Create pyroscope_instances table
-- Date: 2025-12-09
-- Description: Creates pyroscope_instances table for storing Pyroscope profiling server configurations

-- Create pyroscope_instances table
CREATE TABLE IF NOT EXISTS pyroscope_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(255) NOT NULL,
    pyroscope_url TEXT NOT NULL,
    pyroscope_stand_alone BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create index on label for faster queries
CREATE INDEX IF NOT EXISTS idx_pyroscope_instances_label ON pyroscope_instances(label);

-- Create index on pyroscope_stand_alone for filtering
CREATE INDEX IF NOT EXISTS idx_pyroscope_instances_stand_alone ON pyroscope_instances(pyroscope_stand_alone);

-- Add comment to table
COMMENT ON TABLE pyroscope_instances IS 'Stores Pyroscope profiling server instance configurations';

-- Add column comments
COMMENT ON COLUMN pyroscope_instances.id IS 'Unique identifier for the Pyroscope instance';
COMMENT ON COLUMN pyroscope_instances.label IS 'Friendly name/label for the Pyroscope instance';
COMMENT ON COLUMN pyroscope_instances.pyroscope_url IS 'URL to the Pyroscope server';
COMMENT ON COLUMN pyroscope_instances.pyroscope_stand_alone IS 'Whether this is a standalone Pyroscope instance';
COMMENT ON COLUMN pyroscope_instances.created_at IS 'Timestamp when the instance was created';
COMMENT ON COLUMN pyroscope_instances.updated_at IS 'Timestamp when the instance was last updated';

-- Log completion
SELECT 'Successfully created pyroscope_instances table' as status;
