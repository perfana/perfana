-- Add is_adhoc column to report_templates table
-- This column distinguishes between regular templates (created via template management UI)
-- and ad-hoc templates (created when generating ad-hoc reports with save_as_template option)

ALTER TABLE report_templates
ADD COLUMN IF NOT EXISTS is_adhoc BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_report_templates_is_adhoc ON report_templates(is_adhoc);

-- Log successful migration
SELECT 'Added is_adhoc column to report_templates' as status;
