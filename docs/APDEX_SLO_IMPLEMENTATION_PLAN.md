# Apdex-SLO Integration Implementation Plan

## Overview

Integrate Apdex scores at the transaction level into the existing SLO (Benchmark) mechanism to enable pass/fail decisions based on user satisfaction metrics.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data Model | Extend existing `Benchmark` entity | Reuse existing infrastructure, unified UX |
| Data Source | `requests_raw` table | Performance test data already available |
| Pass/Fail Logic | Strict (any failure = test fails) | Clear, predictable behavior |
| Configuration | Fully manual | User controls all thresholds |

### Apdex Formula Reference

```
Apdex = (Satisfied + Tolerating × 0.5) / Total

Where:
- Satisfied: response_time ≤ T (threshold)
- Tolerating: T < response_time ≤ 4T
- Frustrated: response_time > 4T
```

---

## Phase 1: Database & Entity Changes

### 1.1 Extend Benchmark Entity

**File:** `packages/shared/src/entities/benchmark.entity.ts`

```typescript
// Add new fields to Benchmark entity:

@Column({ type: 'varchar', length: 20, default: 'metric' })
benchmark_type: 'metric' | 'apdex';

// For Apdex benchmarks:
@Column({ type: 'varchar', length: 255, nullable: true })
transaction_name: string | null;  // null = all transactions / workload-level

@Column({ type: 'int', nullable: true })
apdex_threshold_ms: number | null;  // T value in milliseconds

@Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
min_apdex_score: number | null;  // Minimum required Apdex (0.000 - 1.000)

@Column({ type: 'boolean', default: false })
include_failed_requests: boolean;  // Whether to include failed requests in Apdex calc
```

### 1.2 Database Migration

**File:** `apps/api/src/database/migrations/XXXXXX-add-apdex-benchmark-fields.ts`

```sql
-- Migration SQL
ALTER TABLE benchmarks
ADD COLUMN benchmark_type VARCHAR(20) DEFAULT 'metric',
ADD COLUMN transaction_name VARCHAR(255),
ADD COLUMN apdex_threshold_ms INTEGER,
ADD COLUMN min_apdex_score DECIMAL(4,3),
ADD COLUMN include_failed_requests BOOLEAN DEFAULT false;

-- Add constraint
ALTER TABLE benchmarks
ADD CONSTRAINT check_apdex_fields
CHECK (
  (benchmark_type = 'metric') OR
  (benchmark_type = 'apdex' AND apdex_threshold_ms IS NOT NULL AND min_apdex_score IS NOT NULL)
);

-- Index for transaction-level lookups
CREATE INDEX idx_benchmarks_apdex_transaction
ON benchmarks (system_under_test_id, test_environment, workload, transaction_name)
WHERE benchmark_type = 'apdex';
```

### 1.3 Update Benchmark DTOs

**File:** `apps/api/src/modules/benchmarks/dto/create-benchmark.dto.ts`

```typescript
export class CreateBenchmarkDto {
  // Existing fields...

  @IsOptional()
  @IsIn(['metric', 'apdex'])
  benchmark_type?: 'metric' | 'apdex' = 'metric';

  @ValidateIf(o => o.benchmark_type === 'apdex')
  @IsString()
  transaction_name?: string;

  @ValidateIf(o => o.benchmark_type === 'apdex')
  @IsNumber()
  @Min(1)
  apdex_threshold_ms?: number;

  @ValidateIf(o => o.benchmark_type === 'apdex')
  @IsNumber()
  @Min(0)
  @Max(1)
  min_apdex_score?: number;

  @IsOptional()
  @IsBoolean()
  include_failed_requests?: boolean = false;
}
```

---

## Phase 2: Apdex Calculation Service

### 2.1 Create Apdex Calculator Service

**File:** `apps/worker/src/pipelines/checks/ApdexCalculator.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface ApdexResult {
  transaction_name: string | null;  // null = workload aggregate
  satisfied_count: number;
  tolerating_count: number;
  frustrated_count: number;
  total_count: number;
  apdex_score: number;
  threshold_ms: number;
}

@Injectable()
export class ApdexCalculator {
  constructor(private dataSource: DataSource) {}

  /**
   * Calculate Apdex score for a specific transaction or entire workload
   */
  async calculateApdex(params: {
    testRunId: string;
    transactionName: string | null;  // null = all transactions
    thresholdMs: number;
    includeFailedRequests: boolean;
    excludeRampUp: boolean;
    rampUpEndTime?: Date;
  }): Promise<ApdexResult> {
    const { testRunId, transactionName, thresholdMs, includeFailedRequests, excludeRampUp, rampUpEndTime } = params;

    const toleratingThreshold = thresholdMs * 4;

    // Build WHERE clause
    const conditions: string[] = ['test_run_id = $1'];
    const queryParams: any[] = [testRunId];
    let paramIndex = 2;

    if (transactionName) {
      conditions.push(`transaction_name = $${paramIndex}`);
      queryParams.push(transactionName);
      paramIndex++;
    }

    if (!includeFailedRequests) {
      conditions.push('success = true');
    }

    if (excludeRampUp && rampUpEndTime) {
      conditions.push(`time >= $${paramIndex}`);
      queryParams.push(rampUpEndTime);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT
        ${transactionName ? `'${transactionName}'` : 'NULL'} as transaction_name,
        COUNT(*) FILTER (WHERE response_time <= $${paramIndex}) as satisfied_count,
        COUNT(*) FILTER (WHERE response_time > $${paramIndex} AND response_time <= $${paramIndex + 1}) as tolerating_count,
        COUNT(*) FILTER (WHERE response_time > $${paramIndex + 1}) as frustrated_count,
        COUNT(*) as total_count
      FROM requests_raw
      WHERE ${whereClause}
        AND response_time IS NOT NULL
    `;

    queryParams.push(thresholdMs, toleratingThreshold);

    const result = await this.dataSource.query(query, queryParams);
    const row = result[0];

    const satisfied = parseInt(row.satisfied_count) || 0;
    const tolerating = parseInt(row.tolerating_count) || 0;
    const frustrated = parseInt(row.frustrated_count) || 0;
    const total = parseInt(row.total_count) || 0;

    const apdexScore = total > 0
      ? (satisfied + tolerating * 0.5) / total
      : null;

    return {
      transaction_name: transactionName,
      satisfied_count: satisfied,
      tolerating_count: tolerating,
      frustrated_count: frustrated,
      total_count: total,
      apdex_score: apdexScore !== null ? Math.round(apdexScore * 1000) / 1000 : null,
      threshold_ms: thresholdMs,
    };
  }

  /**
   * Calculate Apdex for all transactions in a test run
   */
  async calculateAllTransactionApdex(params: {
    testRunId: string;
    thresholdMs: number;  // Default threshold for transactions without specific config
    includeFailedRequests: boolean;
    excludeRampUp: boolean;
    rampUpEndTime?: Date;
  }): Promise<ApdexResult[]> {
    const { testRunId, thresholdMs, includeFailedRequests, excludeRampUp, rampUpEndTime } = params;

    const toleratingThreshold = thresholdMs * 4;

    let timeFilter = '';
    const queryParams: any[] = [testRunId, thresholdMs, toleratingThreshold];

    if (excludeRampUp && rampUpEndTime) {
      timeFilter = 'AND time >= $4';
      queryParams.push(rampUpEndTime);
    }

    const successFilter = includeFailedRequests ? '' : 'AND success = true';

    const query = `
      SELECT
        transaction_name,
        COUNT(*) FILTER (WHERE response_time <= $2) as satisfied_count,
        COUNT(*) FILTER (WHERE response_time > $2 AND response_time <= $3) as tolerating_count,
        COUNT(*) FILTER (WHERE response_time > $3) as frustrated_count,
        COUNT(*) as total_count
      FROM requests_raw
      WHERE test_run_id = $1
        AND response_time IS NOT NULL
        AND transaction_name IS NOT NULL
        ${successFilter}
        ${timeFilter}
      GROUP BY transaction_name
      ORDER BY transaction_name
    `;

    const results = await this.dataSource.query(query, queryParams);

    return results.map(row => {
      const satisfied = parseInt(row.satisfied_count) || 0;
      const tolerating = parseInt(row.tolerating_count) || 0;
      const total = parseInt(row.total_count) || 0;

      const apdexScore = total > 0
        ? (satisfied + tolerating * 0.5) / total
        : null;

      return {
        transaction_name: row.transaction_name,
        satisfied_count: satisfied,
        tolerating_count: parseInt(row.tolerating_count) || 0,
        frustrated_count: parseInt(row.frustrated_count) || 0,
        total_count: total,
        apdex_score: apdexScore !== null ? Math.round(apdexScore * 1000) / 1000 : null,
        threshold_ms: thresholdMs,
      };
    });
  }
}
```

---

## Phase 3: Integration with RequirementChecker

### 3.1 Extend RequirementChecker for Apdex

**File:** `apps/worker/src/pipelines/checks/RequirementChecker.ts`

```typescript
// Add to existing RequirementChecker class:

import { ApdexCalculator, ApdexResult } from './ApdexCalculator';

export interface ApdexCheckResult {
  meets_requirement: boolean | null;
  apdex_result: ApdexResult;
  requirement: {
    min_score: number;
    threshold_ms: number;
  };
  status: 'COMPLETE' | 'ERROR' | 'NO_DATA';
  message: string;
}

async checkApdexRequirement(
  benchmark: Benchmark,
  testRun: TestRun,
): Promise<ApdexCheckResult> {
  if (benchmark.benchmark_type !== 'apdex') {
    throw new Error('Benchmark is not an Apdex type');
  }

  const { apdex_threshold_ms, min_apdex_score, transaction_name, include_failed_requests, exclude_ramp_up_time } = benchmark;

  // Calculate ramp-up end time if needed
  let rampUpEndTime: Date | undefined;
  if (exclude_ramp_up_time && testRun.ramp_up && testRun.start_time) {
    rampUpEndTime = new Date(testRun.start_time.getTime() + testRun.ramp_up * 1000);
  }

  try {
    const apdexResult = await this.apdexCalculator.calculateApdex({
      testRunId: testRun.test_run_id,
      transactionName: transaction_name,
      thresholdMs: apdex_threshold_ms,
      includeFailedRequests: include_failed_requests,
      excludeRampUp: exclude_ramp_up_time,
      rampUpEndTime,
    });

    // No data available
    if (apdexResult.total_count === 0) {
      return {
        meets_requirement: null,
        apdex_result: apdexResult,
        requirement: { min_score: min_apdex_score, threshold_ms: apdex_threshold_ms },
        status: 'NO_DATA',
        message: transaction_name
          ? `No request data found for transaction: ${transaction_name}`
          : 'No request data found for this test run',
      };
    }

    // Evaluate pass/fail
    const meetsRequirement = apdexResult.apdex_score >= min_apdex_score;

    return {
      meets_requirement: meetsRequirement,
      apdex_result: apdexResult,
      requirement: { min_score: min_apdex_score, threshold_ms: apdex_threshold_ms },
      status: 'COMPLETE',
      message: meetsRequirement
        ? `Apdex ${apdexResult.apdex_score.toFixed(3)} meets minimum ${min_apdex_score}`
        : `Apdex ${apdexResult.apdex_score.toFixed(3)} is below minimum ${min_apdex_score}`,
    };

  } catch (error) {
    return {
      meets_requirement: null,
      apdex_result: null,
      requirement: { min_score: min_apdex_score, threshold_ms: apdex_threshold_ms },
      status: 'ERROR',
      message: `Error calculating Apdex: ${error.message}`,
    };
  }
}
```

### 3.2 Update ChecksPipeline

**File:** `apps/worker/src/pipelines/checks/ChecksPipeline.ts`

```typescript
// Modify the main check evaluation loop to handle both types:

async evaluateBenchmark(benchmark: Benchmark, testRun: TestRun): Promise<CheckResult> {
  if (benchmark.benchmark_type === 'apdex') {
    return this.evaluateApdexBenchmark(benchmark, testRun);
  } else {
    return this.evaluateMetricBenchmark(benchmark, testRun);
  }
}

private async evaluateApdexBenchmark(benchmark: Benchmark, testRun: TestRun): Promise<CheckResult> {
  const apdexResult = await this.requirementChecker.checkApdexRequirement(benchmark, testRun);

  // Convert to standard CheckResult format for storage
  return {
    benchmark_id: benchmark.id,
    test_run_id: testRun.id,
    meets_requirement: apdexResult.meets_requirement,
    targets: [{
      target: benchmark.transaction_name || 'workload',
      value: apdexResult.apdex_result?.apdex_score ?? null,
      meets_requirement: apdexResult.meets_requirement,
      is_artificial: false,
      // Extended Apdex data
      apdex_details: apdexResult.apdex_result ? {
        satisfied_count: apdexResult.apdex_result.satisfied_count,
        tolerating_count: apdexResult.apdex_result.tolerating_count,
        frustrated_count: apdexResult.apdex_result.frustrated_count,
        total_count: apdexResult.apdex_result.total_count,
        threshold_ms: apdexResult.apdex_result.threshold_ms,
      } : null,
    }],
    requirement: apdexResult.requirement,
    status: apdexResult.status,
    message: apdexResult.message,
  };
}
```

### 3.3 Extend CheckResult Entity

**File:** `packages/shared/src/entities/check-result.entity.ts`

```typescript
// Extend the targets JSONB to include Apdex details:

interface CheckResultTarget {
  target: string;
  value: number | null;
  meets_requirement: boolean | null;
  is_artificial: boolean;
  // New: Apdex-specific details (only for Apdex benchmarks)
  apdex_details?: {
    satisfied_count: number;
    tolerating_count: number;
    frustrated_count: number;
    total_count: number;
    threshold_ms: number;
  };
}
```

---

## Phase 4: API Endpoints

### 4.1 Extend Benchmarks Controller

**File:** `apps/api/src/modules/benchmarks/benchmarks.controller.ts`

```typescript
// Add new endpoints for Apdex-specific operations:

@Post('apdex')
@ApiOperation({ summary: 'Create an Apdex SLO benchmark' })
async createApdexBenchmark(@Body() dto: CreateApdexBenchmarkDto): Promise<Benchmark> {
  return this.benchmarksService.createApdexBenchmark(dto);
}

@Get('apdex/transactions')
@ApiOperation({ summary: 'Get available transactions for Apdex configuration' })
@ApiQuery({ name: 'systemUnderTestId', required: true })
@ApiQuery({ name: 'testEnvironment', required: true })
@ApiQuery({ name: 'workload', required: true })
async getAvailableTransactions(
  @Query('systemUnderTestId') systemUnderTestId: string,
  @Query('testEnvironment') testEnvironment: string,
  @Query('workload') workload: string,
): Promise<string[]> {
  return this.benchmarksService.getAvailableTransactions(
    systemUnderTestId,
    testEnvironment,
    workload,
  );
}

@Get('apdex/preview')
@ApiOperation({ summary: 'Preview Apdex calculation for a test run' })
async previewApdex(
  @Query('testRunId') testRunId: string,
  @Query('transactionName') transactionName: string | null,
  @Query('thresholdMs') thresholdMs: number,
): Promise<ApdexResult> {
  return this.benchmarksService.previewApdex(testRunId, transactionName, thresholdMs);
}
```

### 4.2 Create Apdex-Specific DTOs

**File:** `apps/api/src/modules/benchmarks/dto/create-apdex-benchmark.dto.ts`

```typescript
import { IsString, IsNumber, IsBoolean, IsOptional, Min, Max, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApdexBenchmarkDto {
  @ApiProperty({ description: 'System under test ID' })
  @IsUUID()
  system_under_test_id: string;

  @ApiProperty({ description: 'Test environment' })
  @IsString()
  test_environment: string;

  @ApiProperty({ description: 'Workload name' })
  @IsString()
  workload: string;

  @ApiPropertyOptional({ description: 'Transaction name (null for workload-level)' })
  @IsOptional()
  @IsString()
  transaction_name?: string;

  @ApiProperty({ description: 'Apdex T threshold in milliseconds', example: 500 })
  @IsNumber()
  @Min(1)
  apdex_threshold_ms: number;

  @ApiProperty({ description: 'Minimum required Apdex score (0.0 - 1.0)', example: 0.9 })
  @IsNumber()
  @Min(0)
  @Max(1)
  min_apdex_score: number;

  @ApiPropertyOptional({ description: 'Include failed requests in calculation', default: false })
  @IsOptional()
  @IsBoolean()
  include_failed_requests?: boolean = false;

  @ApiPropertyOptional({ description: 'Exclude ramp-up time from calculation', default: true })
  @IsOptional()
  @IsBoolean()
  exclude_ramp_up_time?: boolean = true;

  @ApiPropertyOptional({ description: 'Display name for the SLO' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Tags for categorization' })
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];
}
```

---

## Phase 5: Frontend UI

### 5.1 Apdex SLO Tab Component

**File:** `apps/web/app/systems/[id]/config/components/ApdexSLOSection.tsx`

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip,
  FormControlLabel, Checkbox, Alert, Tooltip, CircularProgress,
} from '@mui/material';
import { Add, Edit, Delete, Info } from '@mui/icons-material';

interface ApdexSLO {
  id: string;
  transaction_name: string | null;
  apdex_threshold_ms: number;
  min_apdex_score: number;
  include_failed_requests: boolean;
  exclude_ramp_up_time: boolean;
  enabled: boolean;
  name?: string;
  tags?: string[];
}

interface ApdexSLOSectionProps {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

export function ApdexSLOSection({ systemUnderTestId, testEnvironment, workload }: ApdexSLOSectionProps) {
  const [slos, setSlos] = useState<ApdexSLO[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSLO, setEditingSLO] = useState<ApdexSLO | null>(null);
  const [availableTransactions, setAvailableTransactions] = useState<string[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    transaction_name: '',
    apdex_threshold_ms: 500,
    min_apdex_score: 0.9,
    include_failed_requests: false,
    exclude_ramp_up_time: true,
  });

  // Load existing Apdex SLOs
  useEffect(() => {
    loadApdexSLOs();
    loadAvailableTransactions();
  }, [systemUnderTestId, testEnvironment, workload]);

  const loadApdexSLOs = async () => {
    // Fetch from /benchmarks?benchmark_type=apdex&...
  };

  const loadAvailableTransactions = async () => {
    // Fetch from /benchmarks/apdex/transactions?...
  };

  const handleSave = async () => {
    // POST/PUT to /benchmarks/apdex
  };

  const handleDelete = async (id: string) => {
    // DELETE /benchmarks/:id
  };

  const getApdexColor = (score: number) => {
    if (score >= 0.94) return 'success';
    if (score >= 0.85) return 'warning';
    return 'error';
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          Apdex SLOs
          <Tooltip title="Apdex measures user satisfaction based on response time. Score ranges from 0 (frustrated) to 1 (satisfied).">
            <Info sx={{ ml: 1, fontSize: 18, color: 'text.secondary', verticalAlign: 'middle' }} />
          </Tooltip>
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => { setEditingSLO(null); setDialogOpen(true); }}
        >
          Add Apdex SLO
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>Apdex Formula:</strong> (Satisfied + Tolerating × 0.5) / Total
        <br />
        <small>
          Satisfied: response ≤ T | Tolerating: T &lt; response ≤ 4T | Frustrated: response &gt; 4T
        </small>
      </Alert>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Transaction</TableCell>
              <TableCell align="right">Threshold (T)</TableCell>
              <TableCell align="right">Min Apdex</TableCell>
              <TableCell align="center">Options</TableCell>
              <TableCell align="center">Enabled</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {slos.map((slo) => (
              <TableRow key={slo.id}>
                <TableCell>
                  {slo.transaction_name || (
                    <Chip label="All Transactions" size="small" color="primary" />
                  )}
                </TableCell>
                <TableCell align="right">{slo.apdex_threshold_ms} ms</TableCell>
                <TableCell align="right">
                  <Chip
                    label={slo.min_apdex_score.toFixed(2)}
                    size="small"
                    color={getApdexColor(slo.min_apdex_score)}
                  />
                </TableCell>
                <TableCell align="center">
                  {slo.exclude_ramp_up_time && (
                    <Tooltip title="Excludes ramp-up time">
                      <Chip label="No Ramp-up" size="small" variant="outlined" sx={{ mr: 0.5 }} />
                    </Tooltip>
                  )}
                  {slo.include_failed_requests && (
                    <Tooltip title="Includes failed requests">
                      <Chip label="Incl. Failed" size="small" variant="outlined" />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Checkbox checked={slo.enabled} size="small" />
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => { setEditingSLO(slo); setDialogOpen(true); }}>
                    <Edit fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(slo.id)}>
                    <Delete fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {slos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No Apdex SLOs configured. Click "Add Apdex SLO" to create one.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingSLO ? 'Edit Apdex SLO' : 'Add Apdex SLO'}</DialogTitle>
        <DialogContent>
          {/* Transaction selector, threshold input, min score input, options */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
```

### 5.2 Apdex Results Display

**File:** `apps/web/app/test-runs/[id]/components/service-level-objectives/ApdexSLOCard.tsx`

```tsx
'use client';

import React from 'react';
import { Box, Typography, LinearProgress, Chip, Tooltip, Paper } from '@mui/material';
import { CheckCircle, Cancel, HelpOutline } from '@mui/icons-material';

interface ApdexDetails {
  satisfied_count: number;
  tolerating_count: number;
  frustrated_count: number;
  total_count: number;
  threshold_ms: number;
}

interface ApdexSLOCardProps {
  transactionName: string | null;
  apdexScore: number | null;
  minScore: number;
  meetsRequirement: boolean | null;
  apdexDetails: ApdexDetails | null;
}

export function ApdexSLOCard({
  transactionName,
  apdexScore,
  minScore,
  meetsRequirement,
  apdexDetails,
}: ApdexSLOCardProps) {
  const getScoreColor = (score: number | null) => {
    if (score === null) return 'grey';
    if (score >= 0.94) return '#4caf50';  // Excellent
    if (score >= 0.85) return '#8bc34a';  // Good
    if (score >= 0.70) return '#ff9800';  // Fair
    if (score >= 0.50) return '#ff5722';  // Poor
    return '#f44336';  // Unacceptable
  };

  const getScoreLabel = (score: number | null) => {
    if (score === null) return 'No Data';
    if (score >= 0.94) return 'Excellent';
    if (score >= 0.85) return 'Good';
    if (score >= 0.70) return 'Fair';
    if (score >= 0.50) return 'Poor';
    return 'Unacceptable';
  };

  const renderStatusIcon = () => {
    if (meetsRequirement === null) {
      return <HelpOutline sx={{ color: 'grey.500' }} />;
    }
    return meetsRequirement
      ? <CheckCircle sx={{ color: 'success.main' }} />
      : <Cancel sx={{ color: 'error.main' }} />;
  };

  return (
    <Paper
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: meetsRequirement === false ? 'error.main' : 'divider',
        bgcolor: meetsRequirement === false ? 'error.50' : 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {transactionName || 'All Transactions'}
          </Typography>
          <Chip
            label={`T = ${apdexDetails?.threshold_ms || 0}ms`}
            size="small"
            variant="outlined"
            sx={{ mt: 0.5 }}
          />
        </Box>
        {renderStatusIcon()}
      </Box>

      {/* Apdex Score Display */}
      <Box sx={{ my: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="h4" sx={{ color: getScoreColor(apdexScore), fontWeight: 700 }}>
            {apdexScore !== null ? apdexScore.toFixed(3) : '—'}
          </Typography>
          <Chip
            label={getScoreLabel(apdexScore)}
            size="small"
            sx={{ bgcolor: getScoreColor(apdexScore), color: 'white' }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Minimum required: {minScore.toFixed(2)}
        </Typography>

        {/* Progress bar showing score vs minimum */}
        <Box sx={{ mt: 1, position: 'relative' }}>
          <LinearProgress
            variant="determinate"
            value={(apdexScore || 0) * 100}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: 'grey.200',
              '& .MuiLinearProgress-bar': {
                bgcolor: getScoreColor(apdexScore),
                borderRadius: 4,
              },
            }}
          />
          {/* Minimum threshold marker */}
          <Box
            sx={{
              position: 'absolute',
              left: `${minScore * 100}%`,
              top: -2,
              bottom: -2,
              width: 2,
              bgcolor: 'grey.800',
              borderRadius: 1,
            }}
          />
        </Box>
      </Box>

      {/* Distribution breakdown */}
      {apdexDetails && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Response Distribution ({apdexDetails.total_count.toLocaleString()} requests)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title={`Response ≤ ${apdexDetails.threshold_ms}ms`}>
              <Chip
                label={`Satisfied: ${apdexDetails.satisfied_count.toLocaleString()}`}
                size="small"
                sx={{ bgcolor: '#4caf50', color: 'white' }}
              />
            </Tooltip>
            <Tooltip title={`${apdexDetails.threshold_ms}ms < Response ≤ ${apdexDetails.threshold_ms * 4}ms`}>
              <Chip
                label={`Tolerating: ${apdexDetails.tolerating_count.toLocaleString()}`}
                size="small"
                sx={{ bgcolor: '#ff9800', color: 'white' }}
              />
            </Tooltip>
            <Tooltip title={`Response > ${apdexDetails.threshold_ms * 4}ms`}>
              <Chip
                label={`Frustrated: ${apdexDetails.frustrated_count.toLocaleString()}`}
                size="small"
                sx={{ bgcolor: '#f44336', color: 'white' }}
              />
            </Tooltip>
          </Box>
        </Box>
      )}
    </Paper>
  );
}
```

### 5.3 Integrate into ServiceLevelObjectivesSection

**File:** `apps/web/app/test-runs/[id]/components/service-level-objectives/ServiceLevelObjectivesSection.tsx`

```tsx
// Add tab filtering for benchmark types:

const [benchmarkTypeFilter, setBenchmarkTypeFilter] = useState<'all' | 'metric' | 'apdex'>('all');

// Filter benchmarks by type
const filteredBenchmarks = useMemo(() => {
  return benchmarks.filter(b =>
    benchmarkTypeFilter === 'all' || b.benchmark_type === benchmarkTypeFilter
  );
}, [benchmarks, benchmarkTypeFilter]);

// In render:
<Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
  <Tabs value={benchmarkTypeFilter} onChange={(_, v) => setBenchmarkTypeFilter(v)}>
    <Tab label="All SLOs" value="all" />
    <Tab label="Metric SLOs" value="metric" />
    <Tab label="Apdex SLOs" value="apdex" />
  </Tabs>
</Box>
```

---

## Phase 6: Testing

### 6.1 Unit Tests

**Files to create:**
- `apps/worker/src/pipelines/checks/__tests__/ApdexCalculator.spec.ts`
- `apps/api/src/modules/benchmarks/__tests__/apdex-benchmarks.spec.ts`

```typescript
// Example test cases:

describe('ApdexCalculator', () => {
  it('should calculate Apdex score correctly', async () => {
    // Given: 100 requests - 70 satisfied, 20 tolerating, 10 frustrated
    // Expected: (70 + 20 * 0.5) / 100 = 0.80
  });

  it('should return null for empty result set', async () => {
    // Given: No requests for transaction
    // Expected: apdex_score = null, total_count = 0
  });

  it('should respect threshold boundaries', async () => {
    // Given: T = 500ms
    // - 499ms → Satisfied
    // - 500ms → Satisfied
    // - 501ms → Tolerating
    // - 2000ms → Tolerating (< 4T)
    // - 2001ms → Frustrated (> 4T)
  });

  it('should exclude failed requests when configured', async () => {
    // Given: 10 successful + 5 failed requests
    // When: include_failed_requests = false
    // Then: total_count = 10
  });
});
```

### 6.2 Integration Tests

**File:** `apps/api/src/modules/benchmarks/__tests__/apdex-integration.spec.ts`

```typescript
describe('Apdex SLO Integration', () => {
  it('should create and evaluate Apdex benchmark end-to-end', async () => {
    // 1. Create test run with requests_raw data
    // 2. Create Apdex benchmark
    // 3. Trigger evaluation
    // 4. Verify check_results
  });

  it('should fail test when Apdex is below threshold', async () => {
    // Given: Apdex = 0.75, min_apdex_score = 0.85
    // Then: meets_requirement = false
  });
});
```

---

## Implementation Timeline

| Phase | Description | Dependencies | Estimated Effort |
|-------|-------------|--------------|------------------|
| 1 | Database & Entity Changes | None | Small |
| 2 | Apdex Calculator Service | Phase 1 | Medium |
| 3 | RequirementChecker Integration | Phase 2 | Medium |
| 4 | API Endpoints | Phase 1-3 | Medium |
| 5 | Frontend UI | Phase 4 | Large |
| 6 | Testing | Phase 1-5 | Medium |

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/worker/src/pipelines/checks/ApdexCalculator.ts` | Core Apdex calculation logic |
| `apps/api/src/modules/benchmarks/dto/create-apdex-benchmark.dto.ts` | Apdex-specific DTO |
| `apps/web/app/systems/[id]/config/components/ApdexSLOSection.tsx` | Configuration UI |
| `apps/web/app/test-runs/[id]/components/service-level-objectives/ApdexSLOCard.tsx` | Results display |

### Modified Files
| File | Changes |
|------|---------|
| `packages/shared/src/entities/benchmark.entity.ts` | Add Apdex fields |
| `packages/shared/src/entities/check-result.entity.ts` | Extend targets interface |
| `apps/worker/src/pipelines/checks/RequirementChecker.ts` | Add Apdex evaluation |
| `apps/worker/src/pipelines/checks/ChecksPipeline.ts` | Route to Apdex evaluator |
| `apps/api/src/modules/benchmarks/benchmarks.controller.ts` | Add Apdex endpoints |
| `apps/api/src/modules/benchmarks/benchmarks.service.ts` | Add Apdex service methods |
| `apps/web/app/test-runs/[id]/components/service-level-objectives/ServiceLevelObjectivesSection.tsx` | Add type filtering |

---

## Design Decisions (Finalized)

| Question | Decision | Implication |
|----------|----------|-------------|
| **Workload-level Apdex** | ✅ Yes, allow workload-level | Users can create SLOs with `transaction_name = null` to aggregate across all transactions |
| **Threshold Fallback** | ✅ Fallback to existing thresholds | Use `workload_apdex_thresholds` → `workload_transaction_apdex_thresholds` hierarchy when threshold not explicitly set |
| **Alert Integration** | ❌ No separate alerting | Apdex SLOs only affect pass/fail status; no additional alert channel triggers |

---

## Threshold Resolution Logic

When evaluating an Apdex SLO, the threshold is resolved in this order:

```
1. Explicit threshold on Benchmark (apdex_threshold_ms)
   ↓ if null
2. Transaction-specific: workload_transaction_apdex_thresholds
   (system_under_test_id + test_environment + workload + transaction_name)
   ↓ if not found
3. Workload-level: workload_apdex_thresholds
   (system_under_test_id + test_environment + workload)
   ↓ if not found
4. System default: 500ms
```

### Implementation in ApdexCalculator

```typescript
async resolveThreshold(params: {
  benchmarkThreshold: number | null;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  transactionName: string | null;
}): Promise<number> {
  const { benchmarkThreshold, systemUnderTestId, testEnvironment, workload, transactionName } = params;

  // 1. Explicit threshold takes precedence
  if (benchmarkThreshold !== null) {
    return benchmarkThreshold;
  }

  // 2. Transaction-specific threshold
  if (transactionName) {
    const transactionThreshold = await this.dataSource.query(`
      SELECT apdex_threshold_ms
      FROM workload_transaction_apdex_thresholds
      WHERE system_under_test_id = $1
        AND test_environment = $2
        AND workload = $3
        AND transaction_name = $4
    `, [systemUnderTestId, testEnvironment, workload, transactionName]);

    if (transactionThreshold.length > 0) {
      return transactionThreshold[0].apdex_threshold_ms;
    }
  }

  // 3. Workload-level threshold
  const workloadThreshold = await this.dataSource.query(`
    SELECT apdex_threshold_ms
    FROM workload_apdex_thresholds
    WHERE system_under_test_id = $1
      AND test_environment = $2
      AND workload = $3
  `, [systemUnderTestId, testEnvironment, workload]);

  if (workloadThreshold.length > 0) {
    return workloadThreshold[0].apdex_threshold_ms;
  }

  // 4. System default
  return 500;
}
```
