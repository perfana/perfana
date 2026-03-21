-- Add restrict_to_team_members toggle to teams table
-- When true, only direct team members can view the team's SUTs and test runs
-- Default false preserves current open behavior (all org members can view)
ALTER TABLE teams ADD COLUMN restrict_to_team_members BOOLEAN NOT NULL DEFAULT false;
