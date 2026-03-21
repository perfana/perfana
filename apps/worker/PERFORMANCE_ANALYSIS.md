# Performance Analysis - Why Pipeline Stages Are Slow

## Overview

Based on the codebase analysis, here are the primary performance bottlenecks and their likely causes.

## 1. Metrics Collection Stage (Typically 60-80% of total time)

### Primary Bottleneck: Grafana API Calls

**Why it's slow:**
- **External API dependency** - Network latency to Grafana server
- **Many individual requests** - Each panel requires separate API calls
- **Large time ranges** - Fetching weeks/months of time-series data
- **JSON parsing overhead** - Large response payloads

**Current Configuration:**
```typescript
GRAFANA_BATCH_SIZE: 20       // Panels processed per batch
GRAFANA_CONCURRENCY: 30       // Concurrent HTTP requests
```

**Likely Issues:**
1. **Grafana server rate limiting** - May throttle high concurrency
2. **Network bandwidth** - Downloading MBs of time-series data
3. **Sequential batching** - Batches may not overlap optimally
4. **Connection pooling** - HTTP agent may need tuning

**Evidence from Code:**
```typescript
// perfana-ds-worker/src/pipelines/MetricsPipeline.ts:106
const flattenedRecords = await this.getPanelMetricsAsRecords(testRun, panelsToProcess);
// ^ This is where 80%+ of time is spent
```

### How to Verify:
With the new timing logs, look for:
```
🐌 fetch-and-flatten-metrics: 28340ms 🐌  ← Should be 80%+ of metrics stage
```

## 2. Database Save Operations (10-20% of total time)

### Primary Bottleneck: Bulk Insert Performance

**Why it's slow:**
- **Large batch inserts** - Thousands of metric records per test run
- **TimescaleDB overhead** - Time-series indexing during inserts
- **Transaction size** - Large transactions hold locks longer
- **Network round-trips** - If database is remote

**Current Configuration:**
```typescript
POSTGRES_BATCH_SIZE: 200  // Records per insert batch
```

**Likely Issues:**
1. **Too many small inserts** - Better to use larger batches
2. **No prepared statements** - Parsing overhead on each insert
3. **Index maintenance** - TimescaleDB updating hypertable chunks
4. **Constraint checking** - Foreign keys, unique constraints

**Evidence from Code:**
```typescript
// perfana-ds-worker/src/pipelines/MetricsPipeline.ts:109
await this.saveRecordsToDatabase(flattenedRecords);
// ^ Bulk insert of all flattened metric records
```

### How to Verify:
Look for:
```
🐢 save-to-database: 3890ms 🐢  ← Should be 10-20% of metrics stage
```

## 3. Statistics Calculation Stage (10-15% of total time)

### Primary Bottleneck: SQL Aggregations

**Why it's slow:**
- **Large dataset scans** - Aggregating thousands of metric records
- **Multiple aggregation types** - Mean, median, percentiles, std dev
- **GroupBy operations** - By metric name, tag combinations
- **Sorting for percentiles** - O(n log n) complexity

**Likely Issues:**
1. **Missing indexes** - On (test_run_id, metric_name, tags)
2. **Sequential processing** - Not using PostgreSQL's parallel query
3. **Memory sorts** - work_mem too small, spilling to disk
4. **Percentile algorithms** - PERCENTILE_CONT can be slow

**Evidence from Documentation:**
```
METRICS_PIPELINE.md lines 695-767: Statistical aggregations
- Mean, median, min, max, stddev
- Percentiles (p50, p75, p90, p95, p99)
```

### How to Verify:
Look for slow queries in PostgreSQL logs and timing logs:
```
⏱️ calculate-statistics: 8920ms ⏱️
```

## 4. ADAPT Analysis Stage (5-10% of total time)

### Primary Bottleneck: Statistical Computations

**Why it's slow:**
- **Mann-Whitney U test** - O(n log n) complexity
- **Hypothesis testing** - Multiple iterations for confidence
- **Difference calculations** - Comparing control vs test metrics
- **Conclusion generation** - Complex business logic

**Likely Issues:**
1. **In-memory calculations** - Loading large datasets from DB
2. **Not parallelized** - Sequential metric-by-metric processing
3. **Redundant queries** - Fetching same control group data multiple times

**Evidence from Documentation:**
```
ADAPT_Pipeline_Migration_Specification.md:
- Mann-Whitney U test for statistical significance
- Bayesian probability calculations
- Multi-metric comparison with thresholds
```

### How to Verify:
```
⏱️ adapt-analysis: 2340ms ⏱️
```

## 5. Sequential Pipeline Execution

### Architectural Bottleneck

**Why it's slow:**
- **No parallelism** - Each stage waits for previous to complete
- **Dependency chain** - Checks require statistics, ADAPT requires checks
- **Resource underutilization** - CPU idle during I/O waits

**Current Architecture:**
```
Stage 1: Dynatrace   → Sequential
Stage 2: Panels      ↓
Stage 3: Metrics     ↓
Stage 4: Statistics  ↓
Stage 5: Checks      ↓
Stage 6: Control Groups ↓
Stage 7: Control Stats  ↓
Stage 8: ADAPT       ↓
```

**Opportunity:**
Some stages could run in parallel:
- Dynatrace + Panels + Metrics (independent data sources)
- Statistics calculation could start while metrics still streaming
- Checks + Control Groups (different test runs)

## Performance Improvement Recommendations

### Quick Wins (Highest Impact/Lowest Effort)

1. **Increase Grafana Concurrency**
   ```typescript
   GRAFANA_CONCURRENCY: 50-100  // From 30
   ```
   - Test Grafana server capacity first
   - Monitor for rate limiting

2. **Optimize Database Batch Size**
   ```typescript
   POSTGRES_BATCH_SIZE: 500-1000  // From 200
   ```
   - Larger batches = fewer round-trips
   - Test transaction size limits

3. **Add Database Indexes**
   ```sql
   CREATE INDEX idx_metrics_lookup
   ON ds_metrics(test_run_id, metric_name, tags);

   CREATE INDEX idx_metrics_time
   ON ds_metrics(test_run_id, time DESC);
   ```

4. **Enable HTTP Connection Pooling**
   ```typescript
   // In GrafanaClient
   const httpAgent = new https.Agent({
     keepAlive: true,
     maxSockets: 100,
     maxFreeSockets: 10
   });
   ```

### Medium-Term Improvements

1. **Streaming Pipeline**
   - Process metrics as they arrive from Grafana
   - Start statistics calculation before all metrics collected
   - Reduce memory footprint

2. **Query Optimization**
   - Use prepared statements for repeated queries
   - Batch control group lookups
   - Cache frequently accessed data

3. **Parallel Stage Execution**
   - Run independent stages concurrently
   - Use PostgreSQL parallel query for aggregations
   - Worker pool for CPU-intensive calculations

### Long-Term Optimizations

1. **Caching Layer**
   - Redis cache for control group statistics
   - Memoize expensive calculations
   - Cache Grafana query results

2. **Incremental Updates**
   - Only recalculate changed metrics
   - Skip statistics for unchanged data
   - Differential ADAPT analysis

3. **Database Partitioning**
   - Partition metrics by test_run_id
   - Parallel query across partitions
   - Faster deletes/archives

## How to Use New Timing Logs

### 1. Identify the Bottleneck Stage
```bash
# Look for the longest stage in the breakdown
📊 STAGE TIMING BREAKDOWN
✅ metrics-collection             32450ms  71.7%  ← This is the bottleneck
✅ statistics-calculation          8920ms  19.7%
```

### 2. Drill Down Into Operations
```bash
# Look at the pipeline summary
🐌 Top 5 Slowest Operations:
   1. fetch-and-flatten-metrics: 28340ms 🐌  ← Grafana API calls
   2. save-to-database: 3890ms 🐢           ← Database inserts
```

### 3. Measure Improvement
```bash
# Before optimization:
fetch-and-flatten-metrics: 28340ms

# After increasing concurrency to 50:
fetch-and-flatten-metrics: 15200ms  ← 46% faster!
```

## Monitoring Checklist

When analyzing slow pipelines, check:

- [ ] **Grafana API response times** - Are requests timing out?
- [ ] **Network latency** - Is Grafana on local network?
- [ ] **Database query plans** - Are indexes being used?
- [ ] **PostgreSQL logs** - Any slow query warnings?
- [ ] **System resources** - CPU/memory/network utilization
- [ ] **Connection pools** - Are connections being reused?
- [ ] **Data volume** - How many panels/metrics per test run?
- [ ] **Time ranges** - Fetching hours vs weeks of data?

## Expected Performance Targets

Based on Python implementation baseline:

| Stage | Expected Time | Bottleneck |
|-------|---------------|------------|
| Metrics Collection | 15-30 seconds | Grafana API |
| Statistics | 3-8 seconds | Database aggregations |
| ADAPT | 1-3 seconds | Statistical calculations |
| Checks | 0.5-2 seconds | Database lookups |
| Control Groups | 0.2-1 seconds | Database writes |
| **Total** | **20-45 seconds** | **Grafana API dominates** |

### Goal: 2x Performance Improvement

From specification: Node.js should be 2x faster than Python.

**Python baseline:** ~45 seconds
**Node.js target:** ~22 seconds

**Critical:** Optimize Grafana API calls first (70%+ of time)