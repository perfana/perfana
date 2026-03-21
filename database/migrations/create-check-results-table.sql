-- Migration: Create check_results table
-- Stores benchmark check results from various sources (Grafana, Dynatrace, etc.)

CREATE TABLE IF NOT EXISTS check_results (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id UUID NOT NULL,
    test_environment VARCHAR(255) NOT NULL,
    workload VARCHAR(255) NOT NULL,
    test_run_id VARCHAR(255) NOT NULL,
    source VARCHAR(50) DEFAULT 'grafana' NOT NULL,
    grafana_instance VARCHAR(255),
    dashboard_label VARCHAR(500),
    dashboard_uid VARCHAR(255),
    panel_title VARCHAR(500),
    panel_id INTEGER,
    panel_type VARCHAR(100),
    panel_description TEXT,
    panel_y_axes_format VARCHAR(100),
    dynatrace_entity_id VARCHAR(255),
    dynatrace_metric_key VARCHAR(255),
    dynatrace_dimension_filters JSONB DEFAULT '{}'::jsonb,
    metric_name VARCHAR(255),
    metric_unit VARCHAR(50),
    generic_check_id VARCHAR(500),
    benchmark_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    message TEXT,
    average_all BOOLEAN DEFAULT false NOT NULL,
    evaluate_type VARCHAR(100) NOT NULL,
    exclude_ramp_up_time BOOLEAN DEFAULT true NOT NULL,
    ramp_up INTEGER,
    match_pattern TEXT,
    requirement JSONB DEFAULT '{}'::jsonb,
    benchmark JSONB DEFAULT '{}'::jsonb,
    panel_average NUMERIC,
    meets_requirement BOOLEAN,
    is_artificial BOOLEAN DEFAULT false,
    targets JSONB DEFAULT '[]'::jsonb,
    validate_with_default_if_no_data BOOLEAN DEFAULT false,
    validate_with_default_if_no_data_value NUMERIC,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    tags TEXT[],
    application_dashboard_id UUID,
    CONSTRAINT check_results_pkey PRIMARY KEY (id),
    CONSTRAINT check_results_source_check CHECK (
        source IN ('grafana', 'dynatrace', 'timescaledb', 'influxdb', 'prometheus', 'custom')
    )
);

-- Add foreign key constraint
ALTER TABLE check_results
    ADD CONSTRAINT check_results_system_under_test_id_fkey
    FOREIGN KEY (system_under_test_id)
    REFERENCES systems_under_test(id)
    ON DELETE CASCADE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_check_results_test_run_id ON check_results(test_run_id);
CREATE INDEX IF NOT EXISTS idx_check_results_system_under_test_id ON check_results(system_under_test_id);
CREATE INDEX IF NOT EXISTS idx_check_results_test_env ON check_results(test_environment);
CREATE INDEX IF NOT EXISTS idx_check_results_workload ON check_results(workload);
CREATE INDEX IF NOT EXISTS idx_check_results_benchmark_id ON check_results(benchmark_id);
CREATE INDEX IF NOT EXISTS idx_check_results_source ON check_results(source);
CREATE INDEX IF NOT EXISTS idx_check_results_status ON check_results(status);
CREATE INDEX IF NOT EXISTS idx_check_results_meets_requirement ON check_results(meets_requirement);
CREATE INDEX IF NOT EXISTS idx_check_results_evaluate_type ON check_results(evaluate_type);
CREATE INDEX IF NOT EXISTS idx_check_results_dashboard_uid ON check_results(dashboard_uid);
CREATE INDEX IF NOT EXISTS idx_check_results_metric_name ON check_results(metric_name);
CREATE INDEX IF NOT EXISTS idx_check_results_dynatrace_entity ON check_results(dynatrace_entity_id);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_check_results_sut_source_env_workload_testrun
    ON check_results(system_under_test_id, source, test_environment, workload, test_run_id);

-- GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_check_results_requirement_gin ON check_results USING GIN (requirement);
CREATE INDEX IF NOT EXISTS idx_check_results_benchmark_gin ON check_results USING GIN (benchmark);
CREATE INDEX IF NOT EXISTS idx_check_results_targets_gin ON check_results USING GIN (targets);
CREATE INDEX IF NOT EXISTS idx_check_results_metadata_gin ON check_results USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_check_results_dynatrace_filters_gin ON check_results USING GIN (dynatrace_dimension_filters);

-- Add comment
COMMENT ON TABLE check_results IS
    'Benchmark check results from various sources (Grafana, Dynatrace, InfluxDB, etc.)';
