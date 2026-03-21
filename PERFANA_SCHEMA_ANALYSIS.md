# Perfana MongoDB Schema Analysis & PostgreSQL Design

This document analyzes the existing MongoDB collections in Perfana and provides guidance for designing the PostgreSQL schema for the new stack.

## Business Domain Overview

Perfana is a **performance engineering platform** that automates performance testing analysis and provides collaborative workflows for performance teams. It solves several key problems:

1. **Automated Performance Analysis**: Compares test results against baselines and SLOs
2. **Performance Regression Detection**: Identifies when performance degrades between releases
3. **Multi-tool Integration**: Unifies data from Grafana, Dynatrace, and other monitoring tools
4. **Collaborative Analysis**: Enables teams to discuss and annotate performance findings
5. **Historical Tracking**: Maintains long-term performance trends and patterns
6. **Standardization**: Provides consistent performance testing practices across organizations

## Core Data Model & Relationships

### Hierarchical Organization Structure
```
Organizations (Multi-tenancy)
├── Teams (Access control & resource organization)
│   └── Applications (Systems under test)
│       └── Test Environments (dev, staging, prod)
│           └── Test Types (load, stress, endurance)
│               └── Test Runs (Individual test executions)
```

### Key Entity Relationships
```
TestRuns (1) ←→ (M) CheckResults (Performance checks)
TestRuns (1) ←→ (M) CompareResults (Baseline comparisons)  
TestRuns (1) ←→ (M) Snapshots (Dashboard snapshots)
TestRuns (1) ←→ (M) Comments (Collaborative analysis)
TestRuns (M) ←→ (M) Benchmarks (Performance thresholds)
Applications (M) ←→ (M) GrafanaDashboards (Monitoring dashboards)
```

## MongoDB Collections Analysis

### 1. Core Organization & User Management

#### Organizations
- **Purpose**: Multi-tenancy support
- **Key Fields**: `name` (unique), `description`
- **Schema Notes**: Simple flat structure, referenced by name

#### Teams  
- **Purpose**: Team-based access control
- **Key Fields**: `organisation`, `name`, `description`
- **Relationships**: References organisations by name
- **Schema Notes**: Alphanumeric name validation

### 2. Application Management

#### Applications
- **Purpose**: Central registry for systems under test
- **Key Fields**: 
  - Basic: `name` (unique), `description`, `team`
  - Integrations: `tracingService`, `pyroscopeApplication`, `dynatraceEntities`
  - Structure: `testEnvironments` (nested array)
- **Complex Nested Data**:
  - Test environments with their own configurations
  - Test types within environments with thresholds
  - Adapt mode settings for automated analysis
- **Schema Challenge**: Heavily nested document structure

#### Profiles
- **Purpose**: Reusable test configuration templates  
- **Key Fields**: `name` (unique), `description`, `tags`, `readOnly`
- **Schema Notes**: Simple reference data structure

### 3. Test Execution & Results

#### TestRuns (Core Entity)
- **Purpose**: Central record of all performance test executions
- **Key Fields**:
  - Identifiers: `application`, `testType`, `testEnvironment`, `testRunId`
  - Timing: `start`, `end`, `duration`, `plannedDuration`, `rampUp`
  - Status: `completed`, `abort`, `status` (nested processing states)
  - Results: `consolidatedResult` (nested overall/requirement/benchmark results)
  - Metadata: `annotations`, `tags`, `applicationRelease`, `CIBuildResultsUrl`
  - Arrays: `alerts`, `events`, `variables`, `deepLinks`, `reportComparisons`
- **Schema Challenges**: 
  - Very large nested documents with complex status objects
  - Multiple arrays of complex nested objects
  - Dynamic variables and metadata

#### TestRunConfigs
- **Purpose**: Key-value configuration storage for test runs
- **Key Fields**: Test identifiers + `key`, `value`, `tags`
- **Schema Notes**: Classic EAV (Entity-Attribute-Value) pattern

#### CheckResults  
- **Purpose**: Individual performance metric check results
- **Key Fields**:
  - Context: Test identifiers, Grafana dashboard/panel references
  - Configuration: `evaluateType`, thresholds, patterns
  - Results: `panelAverage`, `meetsRequirement`, `targets` array
- **Schema Notes**: One record per metric check per test run

### 4. Monitoring & Dashboard Integration

#### Grafanas
- **Purpose**: Multi-Grafana instance management
- **Key Fields**: `label` (unique), connection URLs, authentication, feature flags
- **Schema Notes**: Reference data for external system connections

#### GrafanaDashboards
- **Purpose**: Cached Grafana dashboard metadata  
- **Key Fields**: 
  - Metadata: `grafana`, `id`, `uid`, `name`, `updated`
  - Structure: `panels` (array with detailed panel metadata)
  - Variables: `templatingVariables`
- **Schema Challenges**: Large nested arrays of panel objects

#### ApplicationDashboards
- **Purpose**: Application-specific dashboard configurations
- **Key Fields**: Application context + dashboard references + variable substitutions
- **Schema Notes**: Many-to-many relationship with complex configuration

### 5. Performance Analysis & Benchmarking

#### Benchmarks
- **Purpose**: Performance benchmark definitions and thresholds
- **Key Fields**:
  - Context: Application/test identifiers, dashboard references
  - Configuration: `panel` (complex nested evaluation rules)
  - Thresholds: SLOs and regression detection rules
- **Schema Challenges**: Deeply nested panel configuration objects

#### CompareResults
- **Purpose**: Test-to-test comparison results
- **Key Fields**: Test context + comparison logic + detailed results + target arrays
- **Schema Notes**: Links two test runs with detailed delta analysis

### 6. Data Science & Analytics

#### DsMetrics
- **Purpose**: Time-series metric data storage for analysis
- **Key Fields**: Dashboard/panel context + `data` array of time-series points
- **Schema Challenges**: Large time-series data arrays

#### Ds* Collections (20+ collections)
- **Purpose**: Statistical analysis, change point detection, control groups
- **Pattern**: All prefixed with 'ds' (data science)
- **Schema Notes**: Complex statistical analysis data structures

### 7. Collaborative Features

#### Comments (testRunComments)
- **Purpose**: Team collaboration on performance analysis
- **Key Fields**: Test context + dashboard location + content + social features
- **Schema Notes**: Nested replies array, social interaction tracking

#### Notifications
- **Purpose**: System-generated notifications
- **Key Fields**: Test context + message + tracking arrays
- **Schema Notes**: Simple notification log with view tracking

### 8. System & Configuration

#### Configuration
- **Purpose**: System configuration key-value store
- **Key Fields**: `type`, `key`, `value`
- **Schema Notes**: Classic configuration table pattern

#### ApiKeys, Licenses, Versions
- **Purpose**: System management
- **Schema Notes**: Simple reference/configuration tables

## PostgreSQL Schema Design Recommendations

### 1. Normalize the Hierarchy

**Organizations Table**
```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Teams Table**  
```sql
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);
```

### 2. Break Down Complex Nested Structures

**Applications Table**
```sql
CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    tracing_service VARCHAR(255),
    pyroscope_application VARCHAR(255),
    pyroscope_profiler VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Application Test Environments (Normalized)**
```sql
CREATE TABLE application_test_environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    tracing_service VARCHAR(255),
    pyroscope_application VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(application_id, name)
);

CREATE TABLE application_test_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_test_environment_id UUID NOT NULL REFERENCES application_test_environments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    config JSONB, -- For complex nested configurations
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(application_test_environment_id, name)
);
```

### 3. Handle Time-Series and Complex Data

**TestRuns Table (Core Entity)**
```sql
CREATE TABLE test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id),
    test_environment VARCHAR(255) NOT NULL,
    test_type VARCHAR(255) NOT NULL,
    test_run_id VARCHAR(255) NOT NULL,
    
    -- Timing
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    duration INTEGER,
    planned_duration INTEGER,
    ramp_up INTEGER,
    
    -- Status
    completed BOOLEAN DEFAULT FALSE,
    abort BOOLEAN DEFAULT FALSE,
    status JSONB, -- Complex nested status object
    
    -- Results  
    consolidated_result JSONB, -- Complex nested results
    
    -- Metadata
    annotations TEXT[],
    tags TEXT[],
    application_release VARCHAR(255),
    ci_build_results_url VARCHAR(255),
    
    -- Processing
    expires TIMESTAMP WITH TIME ZONE,
    expired BOOLEAN DEFAULT FALSE,
    valid BOOLEAN DEFAULT TRUE,
    reasons_not_valid TEXT[],
    
    -- Flexible JSON for complex nested data
    adapt_config JSONB,
    variables JSONB,
    deep_links JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(application_id, test_environment, test_type, test_run_id)
);

-- Separate tables for arrays that need querying
CREATE TABLE test_run_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    level VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE test_run_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
    test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 4. Time-Series Data Strategy

For collections like `dsMetrics` with large time-series arrays:

**Option 1: TimescaleDB Extension**
```sql
CREATE TABLE ds_metrics (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    panel_id VARCHAR(255) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION,
    is_ramp_up BOOLEAN DEFAULT FALSE,
    timestep INTEGER
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('ds_metrics', 'time');
```

**Option 2: JSONB Storage** (for simpler setup)
```sql
CREATE TABLE ds_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    application_dashboard_id UUID,
    panel_id VARCHAR(255) NOT NULL,
    benchmark_id UUID,
    dashboard_label VARCHAR(255),
    dashboard_uid VARCHAR(255),
    panel_title VARCHAR(255),
    data JSONB NOT NULL, -- Time-series array
    error TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for time-series queries
CREATE INDEX idx_ds_metrics_data_time ON ds_metrics USING GIN ((data->'time'));
```

### 5. Key Design Patterns

#### Use UUIDs for Primary Keys
- Enables distributed systems and replication
- Avoids sequence conflicts in multi-instance deployments

#### JSONB for Complex Nested Data
- Store complex configurations and nested objects as JSONB
- Provides flexibility while maintaining queryability
- Use GIN indexes for JSONB query performance

#### Separate Tables for Queryable Arrays
- Extract frequently queried arrays into separate tables
- Keep simple arrays as PostgreSQL arrays or JSONB

#### Proper Foreign Key Constraints  
- Maintain referential integrity
- Use CASCADE deletes where appropriate

#### Audit Fields
- Add `created_at`, `updated_at`, `created_by`, `updated_by` consistently
- Consider using triggers for automatic timestamp updates

### 6. Migration Considerations

#### Data Volume Planning
- Estimate size of time-series data (`dsMetrics`, `snapshots`)
- Plan partitioning strategy for large tables
- Consider archiving strategies for historical data

#### Complex Data Migration
- Build transformation logic for nested MongoDB documents
- Plan for data validation during migration
- Create staging tables for data transformation

#### Index Strategy
- B-tree indexes for exact matches and ranges
- GIN indexes for JSONB and array columns  
- Composite indexes for common query patterns

#### Performance Optimization
- Use ANALYZE to update table statistics after migration
- Monitor slow queries and add indexes as needed
- Consider materialized views for complex aggregations

## Data Science Collections Deep Analysis

### Architecture & Purpose
The `ds*` collections support a **sophisticated FastAPI-based data science service** that implements the **ADAPT (Automated Data Analysis for Performance Testing)** algorithm. This service:

- Processes performance metrics from Grafana dashboards
- Detects performance regressions using statistical analysis
- Manages historical baselines and control groups
- Performs changepoint detection for performance regime shifts
- Provides automated pass/fail conclusions for test runs

### Key Characteristics

#### Processing Model: **Batch-Oriented with Async Execution**
- **Event-Driven**: Triggered by test completion via API calls
- **Pipeline-Based**: Sequential processing stages with dependencies
- **Celery Workers**: Compute-intensive statistical operations
- **MongoDB Aggregations**: Heavy use of aggregation pipelines

#### Data Flow Pipeline:
```
Test Run → Panels → Metrics → Statistics → Control Groups → ADAPT Analysis → Conclusions
```

#### Collection Usage Patterns:

**Core Data Collections:**
- `dsPanels` - Grafana panel configurations (reference data)
- `dsMetrics` - Raw time-series performance metrics (high volume)
- `dsMetricStatistics` - Aggregated statistical summaries (computed data)

**Analysis Collections:**
- `dsControlGroups` - Historical baselines for comparison
- `dsControlGroupStatistics` - Statistical summaries for control groups
- `dsTrackedDifferences` - Performance differences tracking
- `dsChangepoints` - Performance regime change detection

**ADAPT Algorithm Collections:**
- `dsAdaptInput`, `dsAdaptResults`, `dsAdaptTrackedResults`, `dsAdaptConclusion`

### PostgreSQL Schema Recommendations for DS Collections

#### 1. Time-Series Strategy: **TimescaleDB Required**

```sql
-- High-volume time-series data requires TimescaleDB
CREATE TABLE ds_metrics (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    application_dashboard_id UUID NOT NULL,
    panel_id VARCHAR(255) NOT NULL,
    benchmark_id UUID REFERENCES benchmarks(id),
    
    -- Metadata
    dashboard_label VARCHAR(255),
    dashboard_uid VARCHAR(255), 
    panel_title VARCHAR(255),
    
    -- Time-series data points
    metric_name VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    is_ramp_up BOOLEAN DEFAULT FALSE,
    timestep INTEGER,
    
    -- Processing metadata
    error TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (time, test_run_id, panel_id, metric_name)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('ds_metrics', 'time', chunk_time_interval => INTERVAL '1 day');
```

#### 2. Statistical Aggregations: **Materialized Views + JSONB**

```sql
-- Replace MongoDB aggregation pipelines with materialized views
CREATE TABLE ds_metric_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    application_dashboard_id UUID NOT NULL,
    panel_id VARCHAR(255) NOT NULL,
    benchmark_id UUID REFERENCES benchmarks(id),
    
    -- Basic statistics
    count BIGINT,
    mean DOUBLE PRECISION,
    median DOUBLE PRECISION,
    min_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION,
    std_dev DOUBLE PRECISION,
    
    -- Percentiles (stored as JSONB for flexibility)
    percentiles JSONB, -- {p10: 1.2, p25: 1.5, p75: 2.1, p90: 2.5, p95: 2.8, p99: 3.2}
    
    -- Derived statistics
    iqr DOUBLE PRECISION, -- Interquartile Range (p75 - p25)
    idr DOUBLE PRECISION, -- Interdecile Range (p90 - p10)
    
    -- Data quality metrics
    missing_percentage DOUBLE PRECISION,
    constant_value BOOLEAN,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(test_run_id, application_dashboard_id, panel_id, benchmark_id)
);

-- Materialized view for real-time statistics computation
CREATE MATERIALIZED VIEW ds_metric_statistics_live AS
SELECT 
    test_run_id,
    application_dashboard_id,
    panel_id,
    benchmark_id,
    COUNT(*) as count,
    AVG(value) as mean,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) as median,
    MIN(value) as min_value,
    MAX(value) as max_value,
    STDDEV(value) as std_dev,
    jsonb_build_object(
        'p10', PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY value),
        'p25', PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY value),
        'p75', PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value),
        'p90', PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY value),
        'p95', PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value),
        'p99', PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value)
    ) as percentiles
FROM ds_metrics
WHERE value IS NOT NULL
GROUP BY test_run_id, application_dashboard_id, panel_id, benchmark_id;
```

#### 3. ADAPT Algorithm Collections: **JSONB-Heavy Design**

```sql
-- Control groups for historical baseline management
CREATE TABLE ds_control_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_dashboard_id UUID NOT NULL,
    panel_id VARCHAR(255) NOT NULL,
    benchmark_id UUID REFERENCES benchmarks(id),
    
    -- Control group definition
    test_run_ids UUID[] NOT NULL, -- Array of test run IDs in this control group
    group_config JSONB, -- Configuration for this control group
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(application_dashboard_id, panel_id, benchmark_id)
);

-- Control group statistics (aggregated from control group test runs)
CREATE TABLE ds_control_group_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    control_group_id UUID NOT NULL REFERENCES ds_control_groups(id) ON DELETE CASCADE,
    
    -- Statistical summary of control group
    statistics JSONB NOT NULL, -- Same structure as ds_metric_statistics
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(control_group_id)
);

-- ADAPT analysis results
CREATE TABLE ds_adapt_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    application_dashboard_id UUID NOT NULL,
    panel_id VARCHAR(255) NOT NULL,
    benchmark_id UUID REFERENCES benchmarks(id),
    control_group_id UUID REFERENCES ds_control_groups(id),
    
    -- ADAPT algorithm results
    adapt_results JSONB NOT NULL, -- Complex nested ADAPT analysis data
    
    -- Conclusions
    conclusion VARCHAR(50), -- PASSED, REGRESSION, IMPROVEMENT
    conclusion_details JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(test_run_id, application_dashboard_id, panel_id, benchmark_id)
);
```

#### 4. Performance Optimization for DS Collections

```sql
-- Indexes for time-series queries
CREATE INDEX idx_ds_metrics_test_run_time ON ds_metrics (test_run_id, time DESC);
CREATE INDEX idx_ds_metrics_panel_time ON ds_metrics (application_dashboard_id, panel_id, time DESC);

-- Indexes for JSONB queries  
CREATE INDEX idx_ds_metric_stats_percentiles ON ds_metric_statistics USING GIN (percentiles);
CREATE INDEX idx_adapt_results_conclusion ON ds_adapt_results USING GIN (adapt_results);

-- Composite indexes for common access patterns
CREATE INDEX idx_ds_metrics_composite ON ds_metrics (application_dashboard_id, panel_id, benchmark_id, time DESC);
```

### Migration Strategy for DS Collections

#### Phase 1: Data Pipeline Setup
1. **Set up TimescaleDB extension** for time-series data
2. **Create base tables** with proper indexing
3. **Implement materialized view refresh logic** for statistics

#### Phase 2: Algorithm Migration  
1. **Port MongoDB aggregation pipelines** to PostgreSQL queries/functions
2. **Implement statistical functions** in PostgreSQL (percentiles, etc.)
3. **Create stored procedures** for complex ADAPT calculations

#### Phase 3: Service Integration
1. **Update FastAPI service** to use PostgreSQL
2. **Replace PyMongo** with SQLAlchemy/asyncpg
3. **Test statistical accuracy** against MongoDB implementation

#### Performance Considerations
- **TimescaleDB chunk sizing** for optimal query performance
- **Materialized view refresh strategy** (incremental vs full)
- **Connection pooling** for high-concurrency statistical queries
- **JSONB query optimization** with proper GIN indexes

### Critical Migration Challenges

1. **MongoDB Aggregation Complexity**: The DS service uses sophisticated aggregation pipelines that will require careful porting to PostgreSQL
2. **Statistical Function Parity**: Ensuring PostgreSQL percentile calculations match MongoDB's `$percentile` operator
3. **Performance Requirements**: Time-series queries must maintain sub-second response times
4. **Data Volume**: `dsMetrics` likely contains millions of time-series points requiring careful partitioning

This analysis shows the DS collections are **mission-critical** for Perfana's core value proposition and require **specialized PostgreSQL design patterns** to maintain performance and functionality.

## Additional Architecture Insights

### Enterprise Standardization Pattern

Perfana provides **organizational standardization** through "generic" collections that enable enterprise-wide governance:

- **`genericChecks`** - Reusable performance check definitions
- **`genericReportPanels`** - Standardized report panel configurations  
- **`genericDeeplinks`** - Standard integration links to external tools
- **`goldenPathMetricClassification`** - Standardized metric classification schemes (not Google SRE Golden Signals)

**Business Problem**: Prevents configuration drift across teams, ensures consistent performance testing practices, and provides centralized governance for large organizations.

**PostgreSQL Pattern**: Template/instance relationships with inheritance tracking:

```sql
-- Generic template collections
CREATE TABLE generic_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    check_definition JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Instance collections that reference templates
CREATE TABLE checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id),
    generic_check_id UUID REFERENCES generic_checks(id), -- Optional template link
    check_configuration JSONB NOT NULL,
    is_customized BOOLEAN DEFAULT FALSE, -- Deviation tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Multi-Source Data Architecture

Perfana uses a **hybrid data integration approach**:

1. **Grafana as Unified Proxy**: Grafana API serves as proxy to underlying data sources (InfluxDB, Prometheus, etc.)
2. **Real-time Visualization**: Teams monitor live performance during test execution via Grafana dashboards  
3. **Historical Analysis**: Data extracted via Grafana API and stored in Perfana's TimescaleDB for deep analysis
4. **Multi-Source Support**: Direct integration with other sources like Dynatrace alongside Grafana

**Data Flow**:
```
Test Execution → DataSources (InfluxDB/Prometheus) → Grafana (proxy + visualization) 
                                                      ↓
                                              Perfana queries Grafana API
                                                      ↓  
                                              TimescaleDB storage
                                                      ↓
                                              perfana-ds analysis (ADAPT)
```

### Generic Query Architecture

A **datasource-agnostic query system** supports multiple monitoring tools:

```sql
-- Generic queries table for all data sources  
CREATE TABLE ds_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Source identification
    source_type VARCHAR(100) NOT NULL, -- 'grafana', 'dynatrace', 'influxdb'
    source_instance VARCHAR(255) NOT NULL,
    
    -- Query definition
    query_name VARCHAR(255),
    query_hash VARCHAR(64) NOT NULL, -- Deduplication
    query_definition JSONB NOT NULL, -- Source-specific query structure
    query_parameters JSONB, -- Dynamic parameters
    
    -- Target reference
    target_reference JSONB, -- What this queries (dashboard/panel/entity)
    
    -- Execution metadata
    expected_metrics TEXT[],
    execution_timeout INTEGER DEFAULT 120,
    avg_execution_time_ms INTEGER,
    success_rate DECIMAL(5,2),
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(source_type, source_instance, query_hash)
);

-- Track query executions
CREATE TABLE ds_query_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID NOT NULL REFERENCES ds_queries(id) ON DELETE CASCADE,
    test_run_id UUID REFERENCES test_runs(id),
    
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    execution_parameters JSONB,
    status VARCHAR(50) NOT NULL, -- 'success', 'failed', 'timeout'
    execution_time_ms INTEGER,
    rows_returned INTEGER,
    error_message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Generic Metrics Storage

**Datasource-agnostic metrics table** supporting all monitoring tools:

```sql  
CREATE TABLE ds_metrics (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    query_execution_id UUID NOT NULL REFERENCES ds_query_executions(id),
    
    -- Generic source identification
    source_type VARCHAR(100) NOT NULL,
    source_instance VARCHAR(255) NOT NULL,
    
    -- Metric data
    metric_name VARCHAR(255) NOT NULL,
    metric_path VARCHAR(500), -- Hierarchical metric path
    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(50),
    dimensions JSONB, -- Tags/labels for filtering
    
    -- Test context
    is_ramp_up BOOLEAN DEFAULT FALSE,
    timestep INTEGER,
    
    -- Collection metadata
    collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (time, test_run_id, query_execution_id, metric_name)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('ds_metrics', 'time', chunk_time_interval => INTERVAL '1 day');
```

**Source-Specific Examples**:

Grafana:
```json
{
  "dashboard_uid": "abc123",
  "panel_id": "42", 
  "datasource_type": "influxdb",
  "datasource_name": "production"
}
```

Dynatrace:
```json
{
  "entity_id": "HOST-12345",
  "metric_key": "builtin:host.cpu.usage",
  "dimension_filters": {"dt.entity.host": "HOST-12345"}
}
```

### Benchmark-Driven Analysis Architecture  

**Benchmarks are evaluation criteria** tied to queries, analyzed after each test:

```sql
-- Many-to-many relationship between queries and benchmarks
CREATE TABLE ds_query_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID NOT NULL REFERENCES ds_queries(id) ON DELETE CASCADE,
    benchmark_id UUID NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
    
    benchmark_parameters JSONB, -- Override base query parameters
    metric_selector VARCHAR(255), -- Which metric to evaluate
    aggregation_method VARCHAR(100) DEFAULT 'avg',
    exclude_ramp_up BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(query_id, benchmark_id)
);

-- Updated benchmarks supporting both evaluation types
CREATE TABLE benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id),
    test_environment VARCHAR(255) NOT NULL,
    test_type VARCHAR(255) NOT NULL,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Evaluation types
    has_absolute_check BOOLEAN DEFAULT TRUE,  -- SLO compliance
    has_comparison_check BOOLEAN DEFAULT TRUE, -- Regression detection
    
    -- Absolute check (SLO)
    requirement JSONB, -- {"operator": "lt", "value": 500}
    
    -- Comparison check (regression)
    benchmark_threshold JSONB, -- {"operator": "lt", "percentage": 10}
    comparison_strategy VARCHAR(100) DEFAULT 'previous',
    
    evaluation_config JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Dual Evaluation Results Pattern

**Current implementation splits evaluation results** by check type:

#### CheckResults (Absolute Thresholds - SLO Compliance)
```sql
CREATE TABLE check_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    benchmark_id UUID NOT NULL REFERENCES benchmarks(id),
    query_execution_id UUID REFERENCES ds_query_executions(id),
    
    -- Check configuration
    check_type VARCHAR(100) NOT NULL,
    evaluate_type VARCHAR(100) NOT NULL, -- avg, max, p95
    exclude_ramp_up_time BOOLEAN DEFAULT TRUE,
    
    -- Source context (backwards compatibility + new generic)
    grafana VARCHAR(255), -- Legacy Grafana-specific fields
    dashboard_label VARCHAR(255),
    dashboard_uid VARCHAR(255), 
    panel_title VARCHAR(255),
    panel_id VARCHAR(255),
    
    source_type VARCHAR(100), -- Generic source identification
    source_instance VARCHAR(255),
    source_reference JSONB,
    
    -- Thresholds and results
    requirement JSONB NOT NULL, -- SLO threshold
    panel_average DOUBLE PRECISION NOT NULL, -- Evaluated value
    meets_requirement BOOLEAN NOT NULL, -- Pass/fail
    targets JSONB, -- Individual metric results
    
    status VARCHAR(100),
    message TEXT,
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(test_run_id, benchmark_id)
);
```

#### CompareResults (Relative Comparisons - Regression Detection)  
```sql  
CREATE TABLE compare_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_run_id UUID NOT NULL REFERENCES test_runs(id),
    baseline_test_run_id UUID NOT NULL REFERENCES test_runs(id),
    benchmark_id UUID NOT NULL REFERENCES benchmarks(id),
    query_execution_id UUID REFERENCES ds_query_executions(id),
    
    label VARCHAR(255), -- Comparison identifier
    
    -- Source context
    source_type VARCHAR(100),
    source_instance VARCHAR(255),
    source_reference JSONB,
    
    -- Panel/metric context
    panel_title VARCHAR(255),
    panel_id VARCHAR(255),
    panel_type VARCHAR(100),
    
    -- Evaluation config
    evaluate_type VARCHAR(100) NOT NULL,
    exclude_ramp_up_time BOOLEAN DEFAULT TRUE,
    
    -- Comparison values
    panel_average DOUBLE PRECISION NOT NULL, -- Current test
    benchmark_baseline_test_run_panel_average DOUBLE PRECISION NOT NULL, -- Baseline
    
    -- Calculated differences
    panel_average_delta DOUBLE PRECISION,
    panel_average_delta_percentage DOUBLE PRECISION,
    
    -- Results
    benchmark_baseline_test_run_ok BOOLEAN NOT NULL, -- Pass/fail
    status VARCHAR(100),
    message TEXT,
    targets JSONB, -- Detailed target comparisons
    
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(test_run_id, baseline_test_run_id, benchmark_id)
);
```

### Test Evaluation Workflow

**Complete post-test analysis pipeline**:

1. **Query Execution**: Execute all queries linked to benchmarks for the test context
2. **Metric Collection**: Store time-series data in `ds_metrics` 
3. **Absolute Evaluation**: Generate `check_results` for SLO compliance
4. **Relative Evaluation**: Generate `compare_results` for regression detection
5. **ADAPT Analysis**: Statistical analysis via perfana-ds service
6. **Consolidated Status**: Overall test pass/fail determination

```sql
-- Consolidated test status from both result types
CREATE VIEW test_run_evaluation_summary AS
SELECT 
    tr.id as test_run_id,
    -- Absolute checks
    COUNT(cr.id) as total_checks,
    COUNT(CASE WHEN cr.meets_requirement THEN 1 END) as checks_passed,
    
    -- Comparisons
    COUNT(comp.id) as total_comparisons,  
    COUNT(CASE WHEN comp.benchmark_baseline_test_run_ok THEN 1 END) as comparisons_passed,
    
    -- Overall result logic
    CASE 
        WHEN COUNT(CASE WHEN NOT cr.meets_requirement THEN 1 END) > 0 THEN 'SLO_FAILED'
        WHEN COUNT(CASE WHEN NOT comp.benchmark_baseline_test_run_ok THEN 1 END) > 0 THEN 'REGRESSION_DETECTED'  
        ELSE 'PASSED'
    END as overall_result
FROM test_runs tr
LEFT JOIN check_results cr ON tr.id = cr.test_run_id
LEFT JOIN compare_results comp ON tr.id = comp.test_run_id  
GROUP BY tr.id;
```

## Updated Migration Strategy

### Phase 1: Core Infrastructure
1. **TimescaleDB setup** for time-series data
2. **Generic query architecture** supporting multiple data sources
3. **Benchmark management system** with dual evaluation types

### Phase 2: Data Collection Pipeline  
1. **Multi-source query execution engine**
2. **Generic metrics storage** with proper indexing
3. **Evaluation pipeline** for both absolute and relative checks

### Phase 3: Enterprise Features
1. **Generic template system** for organizational standardization
2. **Governance and inheritance tracking**  
3. **Advanced reporting and analytics**

### Phase 4: Statistical Analysis
1. **ADAPT algorithm migration** from MongoDB aggregations
2. **Advanced analytics** with materialized views
3. **Performance optimization** and scaling

The complete architecture reveals Perfana as a **sophisticated enterprise performance engineering platform** that unifies multiple monitoring tools, provides automated analysis, and enables organizational standardization of performance testing practices.