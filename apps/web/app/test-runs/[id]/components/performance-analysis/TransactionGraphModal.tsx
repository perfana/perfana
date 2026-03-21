'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';

import type { TransactionGraphModalProps } from './transaction-graph-modal/types';
import { useTransactionGraphData } from './transaction-graph-modal/hooks';
import {
  ModalHeader,
  ChartLoadingState,
  ChartErrorState,
  ChartEmptyState,
  TransactionChart,
} from './transaction-graph-modal/components';

export default function TransactionGraphModal({
  open,
  onClose,
  testRunId,
  transactionName,
  showToast,
  events,
}: TransactionGraphModalProps) {
  const {
    loading,
    data,
    error,
    aggregationSeconds,
    selectedMetric,
    handleAggregationChange,
    handleMetricChange,
  } = useTransactionGraphData({
    open,
    testRunId,
    transactionName,
    onClose,
  });

  const hasData = data &&
    (data.transaction_data.length > 0 || Object.keys(data.sampler_data).length > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: { xs: '500px', md: '600px' },
          maxHeight: '90vh',
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle sx={{ pb: 2 }}>
        <ModalHeader
          selectedMetric={selectedMetric}
          aggregationSeconds={aggregationSeconds}
          onMetricChange={handleMetricChange}
          onAggregationChange={handleAggregationChange}
          onClose={onClose}
        />
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <ChartLoadingState />
        ) : error ? (
          <ChartErrorState error={error} />
        ) : !hasData ? (
          <ChartEmptyState />
        ) : (
          <TransactionChart
            data={data}
            transactionName={transactionName}
            selectedMetric={selectedMetric}
            aggregationSeconds={aggregationSeconds}
            showToast={showToast}
            events={events}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
