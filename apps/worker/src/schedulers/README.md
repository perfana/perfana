# Worker Schedulers

This directory contains scheduled tasks for the Perfana worker application.

## IncrementalCollectionScheduler

The `IncrementalCollectionScheduler` enables real-time metrics visibility during test execution by polling for in-progress test runs and triggering incremental metric collection.

### How It Works

1. **Scheduled Execution**: Runs every 60 seconds (configurable via `@Cron` decorator)

2. **In-Progress Detection**: Queries for test runs where:
   - `endTime` updated within heartbeat threshold (default: 30 seconds)
   - `completed = false` (analysis hasn't started)
   - `isStale = false` (not marked as stale)

3. **Dashboard Grouping**: For each in-progress test run:
   - Fetches associated `ApplicationDashboards` (by `systemUnderTestId` + `testEnvironment`)
   - Groups dashboards by source:
     - Grafana: `grafana:{instanceId}`
     - Dynatrace: `dynatrace:{configId}` (future)
     - Performance Test: `performance_test:null` (future)

4. **Job Enqueueing**: Creates one `metrics-collection` job per unique source with payload:
   ```typescript
   {
     testRunId: string,           // Test run UUID
     sourceType: 'grafana' | 'dynatrace' | 'performance_test',
     sourceId: string | null,     // Grafana instance ID, Dynatrace config ID, or null
     applicationDashboardIds: string[],
     fromTime: string,            // ISO datetime (last collection or test start)
     toTime: string,              // ISO datetime (now)
     attempt: 1,
     maxAttempts: 5
   }
   ```

5. **Job Processing**: The `metrics-collection` worker (in `workers/metrics.ts`) will:
   - Check if this is incremental mode (vs. full analysis)
   - Fetch metrics only for the specified time range
   - Update `ds_metric_collection_status` with collected ranges
   - Publish real-time updates to Redis for live dashboard updates

### Configuration

Environment variables (loaded via `config/incremental-collection.config.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `INCREMENTAL_COLLECTION_ENABLED` | `true` | Enable/disable incremental collection |
| `INCREMENTAL_COLLECTION_INTERVAL_SECONDS` | `60` | Polling interval in seconds |
| `INCREMENTAL_COLLECTION_MAX_RETRIES` | `5` | Maximum retry attempts for failed collections |
| `INCREMENTAL_COLLECTION_HEARTBEAT_THRESHOLD_SECONDS` | `30` | Time window to consider a test run "in progress" |
| `INCREMENTAL_COLLECTION_BATCH_SIZE` | `20` | Panels processed per batch (not used by scheduler) |

### Benefits

- **Real-time Visibility**: Users see metrics as soon as they're available during test execution
- **Reduced Time-to-Insight**: No need to wait for test completion to see results
- **Early Issue Detection**: Performance problems can be identified and addressed mid-test
- **Progressive Loading**: Large test runs load metrics incrementally instead of all at once

### Architecture Integration

```
┌─────────────────────────────────────────────────────────────┐
│                  IncrementalCollectionScheduler              │
│                    (@Cron every minute)                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                    1. Find in-progress test runs
                    2. Group dashboards by source
                             │
                             ▼
                ┌────────────────────────┐
                │  perfana-analyze Queue │
                │  (BullMQ)              │
                └────────────┬───────────┘
                             │
                    metrics-collection jobs
                             │
                             ▼
                ┌────────────────────────┐
                │  metrics.ts worker     │
                │  - Fetch metrics       │
                │  - Update status       │
                │  - Publish to Redis    │
                └────────────┬───────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │  Frontend receives     │
                │  real-time updates     │
                └────────────────────────┘
```

### Implementation Notes

1. **Queue Initialization**: The scheduler lazily initializes the BullMQ queue connection on first execution
2. **Overlap Prevention**: Uses `isRunning` flag to prevent concurrent executions
3. **Error Handling**: Catches and logs errors without crashing the scheduler
4. **Cleanup**: Implements `onModuleDestroy()` to close queue connection gracefully
5. **Database Access**: Uses `WorkerDatabaseService` for TypeORM-based database operations
6. **Heartbeat Logic**: Test runs "heartbeat" by updating `endTime` periodically during execution

### Future Enhancements

- [ ] Support for Dynatrace source grouping
- [ ] Support for performance test metrics source
- [ ] Adaptive polling interval based on active test count
- [ ] Configurable collection strategies (full vs. incremental)
- [ ] Metrics collection status tracking and deduplication
- [ ] Rate limiting to prevent overwhelming data sources
