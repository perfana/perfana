'use client';

import { Box, Typography, CircularProgress, Alert } from '@mui/material';
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
}

export default function ErrorAnalysisCard({ testRunId, selectedScenarios = [] }: ErrorAnalysisCardProps) {
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
  } = useErrorAnalysisData({ testRunId, selectedScenarios });

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress sx={{ color: 'primary.main' }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert
        severity="error"
        sx={{
          m: 2,
          borderRadius: 2,
          border: '1px solid rgba(244, 67, 54, 0.3)',
          backgroundColor: 'rgba(244, 67, 54, 0.08)',
        }}
      >
        {error}
      </Alert>
    );
  }

  if (!summary || summary.totalErrors === 0) {
    return (
      <Box
        sx={{
          p: 4,
          textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.05) 0%, rgba(76, 175, 80, 0.02) 100%)',
          borderRadius: 3,
          border: '1.5px solid rgba(76, 175, 80, 0.15)',
        }}
      >
        <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
        <Typography
          variant="h6"
          sx={{
            color: 'success.main',
            fontWeight: 700,
            mb: 1,
          }}
        >
          No Errors Detected
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This test run completed without any errors. Excellent performance!
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
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
