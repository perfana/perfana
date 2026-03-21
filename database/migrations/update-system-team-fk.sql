-- Update foreign key constraint on systems_under_test to SET NULL on team deletion
-- This allows teams to be deleted without deleting their systems

-- Drop the existing constraint
ALTER TABLE systems_under_test
DROP CONSTRAINT IF EXISTS "FK_e59618bddfe1560db0cbe22afc5";

-- Add the new constraint with ON DELETE SET NULL
ALTER TABLE systems_under_test
ADD CONSTRAINT "FK_e59618bddfe1560db0cbe22afc5"
FOREIGN KEY (team_id)
REFERENCES teams(id)
ON DELETE SET NULL;
