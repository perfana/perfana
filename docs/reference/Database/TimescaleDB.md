---
tags:
  - database
  - timescaledb
---

# TimescaleDB

Perfana uses the TimescaleDB extension for PostgreSQL to optimize time-series metric storage and queries.

## Hypertables

### ds_metrics

The primary time-series table, converted to a TimescaleDB hypertable for automatic partitioning.

```sql
CREATE TABLE ds_metrics (
  id UUID PRIMARY KEY,
  test_run_id UUID NOT NULL,
  application_dashboard_id UUID,
  panel_id TEXT,
  metric_name TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  source TEXT, -- 'grafana', 'dynatrace', 'performance_test'
  organization_id UUID NOT NULL
);

-- Convert to hypertable (partitioned by timestamp)
SELECT create_hypertable('ds_metrics', 'timestamp');
```

**Scale**: Millions of rows per test run — each metric/timestamp combination is a row.

## Why TimescaleDB?

1. **Automatic partitioning** — Time-based chunks for efficient queries
2. **Compression** — Older chunks compressed for storage savings
3. **Continuous aggregates** — Materialized views for pre-computed statistics
4. **Standard SQL** — Full PostgreSQL compatibility, no query language changes
5. **Retention policies** — Automatic deletion of old data

## Query Patterns

### Time-range queries (optimized by hypertable chunking)
```sql
SELECT metric_name, timestamp, value
FROM ds_metrics
WHERE test_run_id = $1
  AND timestamp BETWEEN $2 AND $3
ORDER BY timestamp;
```

### Aggregations (used by StatisticsPipeline)
```sql
SELECT metric_name,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY value) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY value) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY value) AS p99,
  MIN(value), MAX(value), AVG(value), STDDEV(value)
FROM ds_metrics
WHERE test_run_id = $1
GROUP BY metric_name;
```

## Related Tables

| Table | Purpose |
|---|---|
| `ds_metric_statistics` | Pre-computed aggregations (regular table) |
| `ds_metric_collection_status` | Tracks incremental collection completeness |

## Related

- [[Schema Overview]] — Full database schema
- [[Worker Overview]] — Pipeline that populates ds_metrics
- [[Data Flow]] — Metric collection flow
