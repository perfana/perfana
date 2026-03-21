# Real-World Integration Tests

This directory contains integration tests that use actual production data to validate the Node.js pipeline implementations against real-world scenarios.

## MetricsPipeline Real-World Test

### Overview
The `metrics-pipeline-test.integration.ts` test validates the MetricsPipeline implementation using real production data from test run `MyAfterburner-acc-loadTest-00002`.

### Test Strategy
1. **Data Backup**: Backs up existing metrics data for the test run
2. **Data Clearing**: Removes existing metrics to start with clean slate
3. **Pipeline Execution**: Runs the MetricsPipeline with mocked Grafana API responses
4. **Data Validation**: Verifies the structure and characteristics of generated data
5. **Data Restoration**: Restores original data after testing

### Prerequisites
- Access to the production Perfana database
- Test run `MyAfterburner-acc-loadTest-00002` must exist with:
  - Valid test run record in `test_runs` table
  - Panel data in `ds_panels` table (169 panels expected)
  - Original metrics data in `ds_metrics` table (12,180 records expected)

### Running the Test

#### Option 1: Using npm script
```bash
npm run test:real-world
```

#### Option 2: Using the helper script (recommended)
```bash
./scripts/run-real-world-test.sh
```

The helper script provides:
- Database connectivity validation
- Test data availability checks
- User confirmation prompts
- Progress monitoring
- Data restoration verification

#### Option 3: Direct vitest execution
```bash
vitest run src/test/integration/real-world --config vitest.integration.config.ts
```

### Expected Results
- **Test Run Data**: 1 test run record
- **Panel Data**: 169 panel documents
- **Metrics Generation**: Successfully processes all panels and generates metrics
- **Data Structure**: Validates proper PostgreSQL schema compliance
- **Data Restoration**: Original 12,180 metrics records restored

### Test Configuration
- **Test Run ID**: `MyAfterburner-acc-loadTest-00002`
- **Time Range**: 2025-09-18 07:18:23 UTC to 07:24:31 UTC
- **Environment**: acc (acceptance)
- **Workload**: loadTest
- **Duration**: ~6 minutes

### Grafana API Mocking
The test uses sophisticated mocking to simulate Grafana API responses:
- Realistic time series data generation
- ERROR metric handling (mostly null values)
- Regular metric value generation
- Proper response structure matching Grafana API format

### Safety Features
- **Non-Destructive**: Original data is always backed up and restored
- **Isolated**: Test runs in its own transaction scope
- **Verified**: Data restoration is verified after each test run
- **Interruptible**: Test can be safely interrupted without data loss

### Troubleshooting

#### Database Connection Issues
```bash
export DATABASE_URL="postgresql://username:password@host:port/database"
```

#### Missing Test Data
Verify the test run exists:
```sql
SELECT * FROM test_runs WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';
SELECT COUNT(*) FROM ds_panels WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';
SELECT COUNT(*) FROM ds_metrics WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';
```

#### Test Timeout
The test has a 2-minute timeout for pipeline execution. If it times out:
- Check Grafana API mock responses
- Verify database performance
- Check for any hanging transactions

### Data Validation
The test validates:
- **Structural Integrity**: All required fields present and correct types
- **Time Range Consistency**: Generated timestamps match test run period
- **Metric Variety**: Multiple metric names and panel IDs processed
- **Benchmark Classification**: Proper handling of benchmark vs non-benchmark panels
- **Error Handling**: Proper processing of panels with and without errors

### Development Usage
This test is invaluable for:
- **Regression Testing**: Ensuring changes don't break existing functionality
- **Performance Validation**: Comparing pipeline performance
- **Data Quality Assurance**: Verifying output data matches expected patterns
- **Integration Verification**: End-to-end validation of the complete pipeline

### Contributing
When modifying this test:
1. Always test data backup/restore functionality
2. Update expected counts if database changes
3. Verify mock responses match actual Grafana API behavior
4. Test both success and failure scenarios
5. Document any new validation criteria