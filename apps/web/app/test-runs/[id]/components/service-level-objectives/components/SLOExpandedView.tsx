'use client';

import { buildSystemConfigUrl } from '@/lib/system-config-url';
import React from 'react';
import {
  Box,
  Typography,
  Button,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MonitorHeart, Add } from '@mui/icons-material';
import { SLOList } from './SLOList';
import {} from '../hooks';
import { SortField, SortDirection, SamplerStat } from '../types';
import { TestRun } from '@/types/test-runs';

interface SLOExpandedViewProps {
  testRun: TestRun | null;
  testRunId: string;
  checkResults: unknown[];
  checkResultsLoading: boolean;
  benchmarks: unknown[];
  benchmarksLoading: boolean;
  expandedSloRows: Set<string>;
  sloFilter: 'all' | 'failed';
  searchText: string;
  sortConfig: Map<string, { field: SortField; direction: SortDirection }>;
  selectedTarget: Map<string, string>;
  setSelectedTarget: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  expandedTransactions: Set<string>;
  transactionSamples: Record<string, SamplerStat[]>;
  loadingTransactionSamples: Record<string, boolean>;
  transactionSamplesError: Record<string, string>;
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;

  // Actions
  toggleSloRow: (key: string) => void;
  handleSort: (rowKey: string, field: SortField) => void;
  setSloFilter: (filter: 'all' | 'failed') => void;
  setIsFilterManuallySet: (value: boolean) => void;
  setSearchText: (text: string) => void;
  toggleTransactionExpanded: (transactionKey: string, transactionName: string, excludeRampUp: boolean) => Promise<void>;
  handleOpenRequestActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string, scenarioName: string | undefined, samplerName: string) => void;
  handleOpenApdexActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string, scenarioName: string | undefined, threshold: number) => void;
  handleEditSlo: (checkResult: unknown) => Promise<void>;
  handleReEvaluate: (panelId: number, applicationDashboardId?: string, metricName?: string) => Promise<void>;
  handleOpenApdexThresholdsDialog: (result: unknown, event: React.MouseEvent) => void;
  getCheckResultKey: (result: unknown) => string;
}

export function SLOExpandedView({
  testRun,
  testRunId,
  checkResults,
  checkResultsLoading,
  benchmarks,
  benchmarksLoading,
  expandedSloRows,
  sloFilter,
  searchText,
  sortConfig,
  selectedTarget,
  setSelectedTarget,
  expandedTransactions,
  transactionSamples,
  loadingTransactionSamples,
  transactionSamplesError,
  hasDistributedTracing,
  hasDynatrace,
  toggleSloRow,
  handleSort,
  setSloFilter,
  setIsFilterManuallySet,
  setSearchText,
  toggleTransactionExpanded,
  handleOpenRequestActionMenu,
  handleOpenApdexActionMenu,
  handleEditSlo,
  handleReEvaluate,
  handleOpenApdexThresholdsDialog,
  getCheckResultKey,
}: SLOExpandedViewProps) {
  const theme = useTheme();

  if (checkResultsLoading || benchmarksLoading) {
    return (
      <Box textAlign="center" py={4}>
        <Typography variant="body2" color="text.secondary">
          Loading service level objectives...
        </Typography>
      </Box>
    );
  }

  if (checkResults.length > 0) {
    return (
      <SLOList
        testRun={testRun}
        testRunId={testRunId}
        checkResults={checkResults}
        benchmarks={benchmarks}
        expandedSloRows={expandedSloRows}
        sloFilter={sloFilter}
        searchText={searchText}
        sortConfig={sortConfig}
        selectedTarget={selectedTarget}
        setSelectedTarget={setSelectedTarget}
        expandedTransactions={expandedTransactions}
        transactionSamples={transactionSamples}
        loadingTransactionSamples={loadingTransactionSamples}
        transactionSamplesError={transactionSamplesError}
        hasDistributedTracing={hasDistributedTracing}
        hasDynatrace={hasDynatrace}
        toggleSloRow={toggleSloRow}
        handleSort={handleSort}
        setSloFilter={setSloFilter}
        setIsFilterManuallySet={setIsFilterManuallySet}
        setSearchText={setSearchText}
        toggleTransactionExpanded={toggleTransactionExpanded}
        handleOpenRequestActionMenu={handleOpenRequestActionMenu}
        handleOpenApdexActionMenu={handleOpenApdexActionMenu}
        handleEditSlo={handleEditSlo}
        handleReEvaluate={handleReEvaluate}
        handleOpenApdexThresholdsDialog={handleOpenApdexThresholdsDialog}
        getCheckResultKey={getCheckResultKey}
      />
    );
  }

  if (benchmarks.length > 0) {
    return (
      <Box textAlign="center" py={4}>
        <MonitorHeart
          color="warning"
          sx={{
            fontSize: '4rem',
            filter: `drop-shadow(0px 2px 4px ${alpha(theme.palette.warning.main, 0.3)})`,
            mb: 2
          }}
        />
        <Typography variant="h6" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
          SLOs have not been evaluated yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {benchmarks.length} service level objective{benchmarks.length !== 1 ? 's are' : ' is'} configured but no results are available for this test run
        </Typography>
      </Box>
    );
  }

  return (
    <Box textAlign="center" py={4}>
      <Typography variant="h6" color="text.secondary" sx={{ mb: 2, fontWeight: 600 }}>
        No service level objectives configured
      </Typography>
      {testRun && (
        <Button
          variant="contained"
          size="medium"
          startIcon={<Add />}
          onClick={(e) => {
            e.stopPropagation();
            const configUrl = buildSystemConfigUrl({ systemId: testRun.system_under_test_id, tab: 'slo', environment: testRun.test_environment, workload: testRun.workload, fromTestRun: testRun.test_run_id });
            window.open(configUrl, '_blank');
          }}
          sx={{
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': {
              backgroundColor: 'primary.dark'
            }
          }}
        >
          Add SLO
        </Button>
      )}
    </Box>
  );
}
