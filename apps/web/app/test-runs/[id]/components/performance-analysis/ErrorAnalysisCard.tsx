'use client';

import { Box, Paper, Typography, CircularProgress, Alert } from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { useErrorAnalysisData } from './error-analysis/hooks';
import {
  ErrorSummaryCards,
  ErrorsOverTimeChart,
  ErrorsTable,
  ErrorDetailsDialog,
} from './error-analysis/components';

interface ErrorAnalysisCardProps {
  testRunId: string;
  selectedScenarios?: string[];
  excludeRampUp?: boolean;
}

export default function ErrorAnalysisCard({ testRunId, selectedScenarios = [], excludeRampUp = false }: ErrorAnalysisCardProps) {
  const {
    loading,
    error,
    summary,
    errorsByCode,
    errorsByTransaction,
    errorsOverTime,
    errorsOverTimeByCode,
    selectedError,
    detailsOpen,
    handleViewDetails,
    handleCloseDetails,
  } = useErrorAnalysisData({ testRunId, selectedScenarios, excludeRampUp });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ my: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!summary || summary.totalErrors === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Paper
          elevation={2}
          sx={{
            p: 3,
            borderLeft: '4px solid #4caf50',
            backgroundColor: 'background.paper',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <CheckCircleIcon sx={{ color: 'success.main' }} />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
              No errors detected
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This test run completed without any errors.
            </Typography>
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Summary Statistics */}
      <ErrorSummaryCards summary={summary} />

      {/* Charts Section - Errors Over Time and By Code */}
      <ErrorsOverTimeChart
        errorsOverTime={errorsOverTime}
        errorsOverTimeByCode={errorsOverTimeByCode}
        errorsByCode={errorsByCode}
      />

      {/* Error Details Table */}
      <ErrorsTable
        errorsByTransaction={errorsByTransaction}
        onViewDetails={handleViewDetails}
      />

      {/* Error Details Dialog */}
      <ErrorDetailsDialog
        open={detailsOpen}
        onClose={handleCloseDetails}
        selectedError={selectedError}
      />
    </Box>
  );
}
