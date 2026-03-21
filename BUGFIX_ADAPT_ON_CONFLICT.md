# Bug Fix: ADAPT Pipeline ON CONFLICT Constraint

## Issue
After refactoring AdaptPipeline.ts, the worker service failed with:
```
QueryFailedError: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

## Root Cause
During the refactoring that extracted SQL queries from AdaptPipeline.ts to `sql-builder.ts`, the ON CONFLICT clause was incorrectly modified.

### Original (Correct)
```sql
ON CONFLICT (test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)
```

### Refactored (Incorrect)
```sql
ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name)
```

The `control_group_id` column was accidentally omitted from the ON CONFLICT clause.

## Impact
- ADAPT analysis failed for all test runs
- Error occurred in `ResultsProcessor.processAdaptResults` at line 183
- Affected the core ADAPT pipeline functionality

## Fix
**File**: `/apps/worker/src/pipelines/helpers/adapt/results/sql-builder.ts`

**Line 265**: Restored `control_group_id` to the ON CONFLICT clause:

```typescript
ON CONFLICT (test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)
```

## Verification
- ✅ TypeScript compilation: Success
- ✅ Matches original constraint from commit fcae5a6~1
- ✅ Aligns with `ds_adapt_results` table unique constraint

## Database Schema
The `ds_adapt_results` table has a unique constraint on:
```sql
(test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)
```

This ensures one result row per unique combination of these five identifiers.

## Testing
The fix should be verified by:
1. Running ADAPT analysis on test runs
2. Confirming no SQL errors in worker logs
3. Verifying results are correctly inserted/updated in `ds_adapt_results` table

## Related Commits
- Refactoring commits: fcae5a6, 47fb523, dbc3e31, ac5b8c3, 786b536
- Original implementation: fcae5a6~1
