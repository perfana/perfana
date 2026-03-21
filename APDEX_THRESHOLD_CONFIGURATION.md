# Apdex Threshold Configuration Implementation

## Overview

This document outlines the implementation of configurable Apdex thresholds with scope hierarchy:
- **Test-level**: Default threshold for all transactions in a test run
- **Transaction-level**: Override threshold for specific transactions (takes precedence)

## Database Schema Changes

### 1. Add Test-Level Threshold Column

```sql
-- Add apdex_threshold column to test_runs table
-- Default to 500ms (industry standard for web applications)
ALTER TABLE test_runs
ADD COLUMN apdex_threshold INTEGER DEFAULT 500
CHECK (apdex_threshold > 0 AND apdex_threshold <= 60000);

COMMENT ON COLUMN test_runs.apdex_threshold IS 'Default Apdex threshold in milliseconds for all transactions in this test run. Default: 500ms';
```

### 2. Create Transaction-Level Threshold Table

```sql
-- Create table for transaction-specific Apdex thresholds
CREATE TABLE IF NOT EXISTS transaction_apdex_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id TEXT NOT NULL,
  transaction_name TEXT NOT NULL,
  apdex_threshold INTEGER NOT NULL CHECK (apdex_threshold > 0 AND apdex_threshold <= 60000),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint: one threshold per transaction per test run
  CONSTRAINT unique_transaction_threshold UNIQUE (test_run_id, transaction_name),

  -- Foreign key to transactions table (informational)
  -- Note: We can't enforce this strictly since transactions are raw data
  CONSTRAINT check_test_run_exists CHECK (
    EXISTS (SELECT 1 FROM test_runs WHERE test_run_id = transaction_apdex_thresholds.test_run_id)
  )
);

CREATE INDEX idx_transaction_apdex_test_run ON transaction_apdex_thresholds(test_run_id);
CREATE INDEX idx_transaction_apdex_transaction ON transaction_apdex_thresholds(transaction_name);

COMMENT ON TABLE transaction_apdex_thresholds IS 'Transaction-specific Apdex thresholds that override test-level defaults';
COMMENT ON COLUMN transaction_apdex_thresholds.apdex_threshold IS 'Override Apdex threshold in milliseconds for this specific transaction';
```

### 3. Update Trigger for Updated At

```sql
-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_transaction_apdex_threshold_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_transaction_apdex_threshold_modtime
  BEFORE UPDATE ON transaction_apdex_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION update_transaction_apdex_threshold_timestamp();
```

## Backend Implementation

### 1. Updated Transaction Stats Query

The query now:
- Retrieves test-level default threshold from `test_runs` table
- LEFT JOINs with `transaction_apdex_thresholds` to get transaction-specific overrides
- Uses `COALESCE` to apply transaction-level threshold if exists, otherwise test-level
- Calculates Apdex dynamically based on the selected threshold
- Returns the active threshold value for each transaction

```sql
WITH transaction_stats AS (
  SELECT
    t.transaction_name,
    COUNT(*) as total_count,
    COUNT(CASE WHEN t.success THEN 1 END) as passed_count,
    COUNT(CASE WHEN NOT t.success THEN 1 END) as failed_count,
    ROUND(AVG(t.response_time)::numeric, 2) as avg_response_time,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) as p95_response_time,
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY t.response_time)::numeric, 2) as p99_response_time,
    ROUND((AVG(t.response_time) * COUNT(*))::numeric, 2) as impact_score,
    -- Get threshold: transaction-specific OR test-level default
    COALESCE(tat.apdex_threshold, tr.apdex_threshold, 500) as active_threshold
  FROM transactions t
  LEFT JOIN test_runs tr ON tr.test_run_id = t.test_run_id
  LEFT JOIN transaction_apdex_thresholds tat
    ON tat.test_run_id = t.test_run_id
    AND tat.transaction_name = t.transaction_name
  WHERE t.test_run_id = $1
  GROUP BY t.transaction_name, tat.apdex_threshold, tr.apdex_threshold
)
SELECT
  *,
  RANK() OVER (ORDER BY impact_score DESC) as ranking,
  -- Calculate Apdex using active_threshold
  ROUND(
    (
      COUNT(CASE WHEN response_time <= active_threshold THEN 1 END)::numeric +
      (COUNT(CASE WHEN response_time > active_threshold AND response_time <= (active_threshold * 4) THEN 1 END)::numeric / 2)
    ) / NULLIF(COUNT(*)::numeric, 0),
    3
  ) as apdex_score
FROM transaction_stats ts
JOIN transactions t ON t.transaction_name = ts.transaction_name AND t.test_run_id = $1
GROUP BY ts.transaction_name, ts.total_count, ts.passed_count, ts.failed_count,
         ts.avg_response_time, ts.p95_response_time, ts.p99_response_time,
         ts.impact_score, ts.active_threshold
ORDER BY ts.transaction_name ASC;
```

### 2. TypeScript Interfaces

Update the response interface to include the active threshold:

```typescript
interface TransactionStat {
  transaction_name: string;
  avg_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  ranking: number;
  apdex_score: number;
  active_threshold: number; // NEW: The threshold used for this transaction
}
```

### 3. New API Endpoints

#### Get Test-Level Threshold
```
GET /test-runs/:testRunId/apdex-threshold
Response: { apdex_threshold: 500 }
```

#### Set Test-Level Threshold
```
PUT /test-runs/:testRunId/apdex-threshold
Body: { apdex_threshold: 1000 }
Response: { apdex_threshold: 1000 }
```

#### Get Transaction-Level Thresholds
```
GET /test-runs/:testRunId/transactions/apdex-thresholds
Response: [
  { transaction_name: "slow_query", apdex_threshold: 2000 },
  { transaction_name: "api_call", apdex_threshold: 300 }
]
```

#### Set Transaction-Level Threshold
```
PUT /test-runs/:testRunId/transactions/:transactionName/apdex-threshold
Body: { apdex_threshold: 2000 }
Response: { transaction_name: "slow_query", apdex_threshold: 2000 }
```

#### Delete Transaction-Level Threshold (revert to test-level)
```
DELETE /test-runs/:testRunId/transactions/:transactionName/apdex-threshold
Response: { message: "Threshold reset to test-level default" }
```

## Frontend Implementation

### 1. Display Active Threshold in Tooltip

Update the Apdex cell tooltip to show the active threshold:

```typescript
<Tooltip
  title={`Apdex: ${formatApdex(transaction.apdex_score)} (T=${transaction.active_threshold}ms)`}
  arrow
  placement="top"
>
```

### 2. Test-Level Configuration UI

Add a configuration section in the test run details header or settings area:

```typescript
<Box>
  <Typography variant="subtitle2">Default Apdex Threshold</Typography>
  <TextField
    type="number"
    value={testLevelThreshold}
    onChange={handleTestThresholdChange}
    InputProps={{
      endAdornment: <InputAdornment position="end">ms</InputAdornment>,
    }}
    helperText="Default threshold for all transactions (T)"
  />
</Box>
```

### 3. Transaction-Level Override UI

Add an edit icon next to each transaction's Apdex score:

```typescript
<TableCell align="right">
  <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
    <Tooltip title={`Apdex: ${formatApdex(transaction.apdex_score)} (T=${transaction.active_threshold}ms)`}>
      <Box component="span" sx={apdexBadgeStyles}>
        {getApdexLabel(transaction.apdex_score)}
      </Box>
    </Tooltip>
    <IconButton
      size="small"
      onClick={() => handleEditThreshold(transaction.transaction_name)}
    >
      <EditIcon fontSize="small" />
    </IconButton>
  </Box>
</TableCell>
```

### 4. Threshold Edit Dialog

```typescript
<Dialog open={editDialogOpen} onClose={handleCloseDialog}>
  <DialogTitle>
    Configure Apdex Threshold
    <Typography variant="caption" display="block">
      Transaction: {selectedTransaction}
    </Typography>
  </DialogTitle>
  <DialogContent>
    <TextField
      label="Threshold (T)"
      type="number"
      value={editThreshold}
      onChange={handleThresholdChange}
      fullWidth
      InputProps={{
        endAdornment: <InputAdornment position="end">ms</InputAdornment>,
      }}
      helperText={
        <>
          <div>Satisfied: ≤ {editThreshold}ms</div>
          <div>Tolerating: {editThreshold}ms - {editThreshold * 4}ms</div>
          <div>Frustrated: &gt; {editThreshold * 4}ms</div>
        </>
      }
    />
    <FormControlLabel
      control={
        <Checkbox
          checked={useTestDefault}
          onChange={handleUseDefaultChange}
        />
      }
      label={`Use test default (${testLevelThreshold}ms)`}
    />
  </DialogContent>
  <DialogActions>
    <Button onClick={handleCloseDialog}>Cancel</Button>
    <Button onClick={handleSaveThreshold} variant="contained">
      Save
    </Button>
  </DialogActions>
</Dialog>
```

## Scope Hierarchy Logic

The threshold resolution follows this precedence order:

1. **Transaction-level threshold** (if set in `transaction_apdex_thresholds`)
2. **Test-level threshold** (from `test_runs.apdex_threshold`)
3. **System default** (500ms hardcoded fallback)

```typescript
// Pseudocode for threshold resolution
function getActiveThreshold(testRunId: string, transactionName: string): number {
  const transactionThreshold = getTransactionThreshold(testRunId, transactionName);
  if (transactionThreshold) return transactionThreshold;

  const testThreshold = getTestThreshold(testRunId);
  if (testThreshold) return testThreshold;

  return 500; // System default
}
```

## Visual Indicators

### 1. Threshold Source Indicator

Show which threshold is active:

```typescript
// In the tooltip or UI
const thresholdSource = transaction.active_threshold === testLevelThreshold
  ? '(test default)'
  : '(custom)';

<Tooltip title={`Apdex: ${formatApdex(score)} T=${threshold}ms ${thresholdSource}`}>
```

### 2. Color Coding

- **Default threshold**: Normal styling
- **Custom threshold**: Add a small indicator (e.g., asterisk or different color)

## Migration Steps

1. **Run SQL migrations** to add columns and create tables
2. **Deploy backend changes** with updated query logic
3. **Deploy frontend changes** with configuration UI
4. **Set default thresholds** for existing test runs (500ms)
5. **User training** on how to configure thresholds

## Benefits

- **Flexibility**: Different transactions can have different performance expectations
- **Accuracy**: More accurate Apdex scores for mixed workloads
- **Clarity**: Users know exactly which threshold applies
- **Override capability**: Easy to override without affecting other transactions
- **History**: Threshold changes are timestamped and auditable

## Example Use Cases

1. **Background jobs**: Set higher threshold (2000ms) for batch processes
2. **API calls**: Set lower threshold (300ms) for critical API endpoints
3. **Database queries**: Set moderate threshold (1000ms) for complex queries
4. **Page loads**: Set standard threshold (500ms) for web page renders

## Next Steps

1. Review and approve this design
2. Create database migration script
3. Implement backend API endpoints
4. Implement frontend configuration UI
5. Add tests for threshold configuration
6. Update documentation
