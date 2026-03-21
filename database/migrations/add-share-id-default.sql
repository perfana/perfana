-- Add default value for share_id column
-- The entity uses @Generated('uuid') but the database column doesn't have a default

ALTER TABLE generated_reports
ALTER COLUMN share_id SET DEFAULT uuid_generate_v4();

-- Log successful migration
SELECT 'Added default uuid_generate_v4() to share_id column' as status;
