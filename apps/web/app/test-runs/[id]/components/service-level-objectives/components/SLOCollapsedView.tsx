'use client';

import { buildSystemConfigUrl } from '@/lib/system-config-url';
import React from 'react';
import {
  Box,
  Button,
  Tooltip,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { CheckResult, Benchmark } from '@/lib/types';
import { isCheckResultStale } from '../utils/slo-formatters';

interface SLOCollapsedViewProps {
  checkResults: CheckResult[];
  checkResultsLoading: boolean;
  benchmarks: Benchmark[];
  benchmarksLoading: boolean;
  testRun: TestRun | null;
}

export function SLOCollapsedView({
  checkResults,
  checkResultsLoading,
  benchmarks,
  benchmarksLoading,
  testRun,
}: SLOCollapsedViewProps) {
  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPISection
          checkResults={checkResults}
          checkResultsLoading={checkResultsLoading}
          benchmarks={benchmarks}
          benchmarksLoading={benchmarksLoading}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        <BadgeSection
          checkResults={checkResults}
          checkResultsLoading={checkResultsLoading}
          benchmarks={benchmarks}
          benchmarksLoading={benchmarksLoading}
          testRun={testRun}
        />
      </Box>
    </Box>
  );
}

// KPI section sub-component
function KPISection({
  checkResults,
  checkResultsLoading,
  benchmarks,
  benchmarksLoading,
}: {
  checkResults: CheckResult[];
  checkResultsLoading: boolean;
  benchmarks: Benchmark[];
  benchmarksLoading: boolean;
}) {
  if (checkResultsLoading || benchmarksLoading) {
    return (
      <KPIDisplay
        value="—"
        label="Loading SLOs..."
        loading={true}
      />
    );
  }

  if (checkResults.length > 0) {
    const failedCount = checkResults.filter(r => r.meets_requirement === false).length;
    const hasFailed = failedCount > 0;
    return (
      <KPIDisplay
        value={failedCount}
        label="Failed SLOs"
        color={hasFailed ? 'error' : 'success'}
      />
    );
  }

  if (benchmarks.length > 0) {
    return (
      <KPIDisplay
        value={benchmarks.length}
        label="Configured, Not Evaluated"
        color="warning"
      />
    );
  }

  return (
    <KPIDisplay
      value="0"
      label="SLOs Configured"
      color="neutral"
    />
  );
}

// Badge section sub-component
function BadgeSection({
  checkResults,
  checkResultsLoading,
  benchmarks,
  benchmarksLoading,
  testRun,
}: {
  checkResults: CheckResult[];
  checkResultsLoading: boolean;
  benchmarks: Benchmark[];
  benchmarksLoading: boolean;
  testRun: TestRun | null;
}) {
  if (checkResultsLoading || benchmarksLoading) {
    return <SoftBadge label="Loading..." color="blue" />;
  }

  if (checkResults.length > 0) {
    return <CollapsedBadges checkResults={checkResults} benchmarks={benchmarks} />;
  }

  if (benchmarks.length > 0) {
    return <SoftBadge label="Not Evaluated" color="orange" />;
  }

  return (
    <Button
      variant="outlined"
      size="small"
      startIcon={<Add />}
      onClick={(e) => {
        e.stopPropagation();
        if (testRun) {
          const configUrl = buildSystemConfigUrl({ systemId: testRun.system_under_test_id, tab: 'slo', environment: testRun.test_environment, workload: testRun.workload, fromTestRun: testRun.test_run_id });
          window.open(configUrl, '_blank');
        }
      }}
      sx={{
        height: '32px',
        borderColor: 'primary.main',
        color: 'primary.main',
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          borderColor: 'primary.dark',
          backgroundColor: 'primary.main',
          color: 'primary.contrastText'
        }
      }}
    >
      Add SLO
    </Button>
  );
}

// Collapsed badges sub-component
function CollapsedBadges({
  checkResults,
  benchmarks,
}: {
  checkResults: CheckResult[];
  benchmarks: Benchmark[];
}) {
  const passedCount = checkResults.filter(r => r.meets_requirement === true).length;
  const failedCount = checkResults.filter(r => r.meets_requirement === false).length;
  const invalidCount = checkResults.filter(r => r.status === 'ERROR').length;
  const staleCount = checkResults.filter(result => {
    const benchmark = benchmarks.find(b => b.id === result.benchmark_id);
    return isCheckResultStale(result, benchmark);
  }).length;

  const failedResults = checkResults.filter(r => r.meets_requirement === false);
  const failedTags = [...new Set(failedResults.flatMap(r => r.tags || []))];

  return (
    <>
      {passedCount > 0 && (
        <SoftBadge count={passedCount} label="passed" color="green" />
      )}
      {failedCount > 0 && (
        <SoftBadge count={failedCount} label="failed" color="red" />
      )}
      {invalidCount > 0 && (
        <SoftBadge count={invalidCount} label="invalid" color="orange" />
      )}
      {staleCount > 0 && (
        <Tooltip
          title={`${staleCount} outdated result${staleCount > 1 ? 's' : ''} - configuration changed since last analysis`}
          arrow
          placement="top"
        >
          <Box>
            <SoftBadge count={staleCount} label="outdated" color="orange" />
          </Box>
        </Tooltip>
      )}
      {failedTags.slice(0, 3).map((tag, index) => (
        <SoftBadge key={index} label={tag} color="purple" />
      ))}
    </>
  );
}
