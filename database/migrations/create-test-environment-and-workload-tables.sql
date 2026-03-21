-- Migration: Create test environment and workload tables
-- These tables store the hierarchy: System → Environment → Workload
--
-- system_under_test_test_environments: Test environments for each system (dev, acc, prod, etc.)
-- system_under_test_workloads: Workloads/test types for each environment (load, stress, etc.)

-- Create test environments table
CREATE TABLE IF NOT EXISTS system_under_test_test_environments (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    tracing_service VARCHAR(255),
    pyroscope_application VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT application_test_environments_pkey PRIMARY KEY (id),
    CONSTRAINT system_under_test_test_environments_system_under_test_id_name_k
        UNIQUE (system_under_test_id, name)
);

-- Create workloads table
CREATE TABLE IF NOT EXISTS system_under_test_workloads (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_test_environment_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    config JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT application_test_types_pkey PRIMARY KEY (id),
    CONSTRAINT application_test_types_application_test_environment_id_name_key
        UNIQUE (system_under_test_test_environment_id, name)
);

-- Add foreign key constraints
ALTER TABLE system_under_test_test_environments
    ADD CONSTRAINT system_under_test_test_environments_system_under_test_id_fkey
    FOREIGN KEY (system_under_test_id)
    REFERENCES systems_under_test(id)
    ON DELETE CASCADE;

ALTER TABLE system_under_test_workloads
    ADD CONSTRAINT system_under_test_test_types_system_under_test_test_environment
    FOREIGN KEY (system_under_test_test_environment_id)
    REFERENCES system_under_test_test_environments(id)
    ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_test_environments_system_id
    ON system_under_test_test_environments(system_under_test_id);

CREATE INDEX IF NOT EXISTS idx_workloads_environment_id
    ON system_under_test_workloads(system_under_test_test_environment_id);

-- Add comments
COMMENT ON TABLE system_under_test_test_environments IS
    'Test environments for each system under test (e.g., dev, acc, prod)';

COMMENT ON TABLE system_under_test_workloads IS
    'Workloads/test types for each environment (e.g., load, stress, endurance)';
