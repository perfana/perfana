'use client';

import ApdexConfigDialog from '../ApdexConfigDialog';
import ApdexThresholdDialog from '../ApdexThresholdDialog';
import ApdexSloDialog from '../ApdexSloDialog';
import AggregatedSloDialog from '../AggregatedSloDialog';
import BaselineApdexDialog from '../BaselineApdexDialog';
import ApdexThresholdsManagementDialog from '../../service-level-objectives/ApdexThresholdsManagementDialog';
import ErrorsModal from '../ErrorsModal';
import TransactionGraphModal from '../TransactionGraphModal';
import RequestTimeSeriesModal from '../RequestTimeSeriesModal';
import TransactionDetailsModal from './TransactionDetailsModal';
import SamplerDetailsModal from './SamplerDetailsModal';
import { TransactionStat, SamplerStat } from '../types/performance-analysis.types';
import { ErrorModalConfig, RequestGraphModalData } from '../hooks/usePerformanceAnalysisHandlers';
import type { PerfanaEvent } from '@/lib/events';

interface PerformanceAnalysisDialogsProps {
  testRunId: string;
  transactions: TransactionStat[];
  testLevelThreshold: number;
  showToast: (message: string) => void;
  onConfigSuccess: () => void;

  // Config dialog
  configDialogOpen: boolean;
  onConfigDialogClose: () => void;
  selectedTransaction?: string;

  // Apdex threshold dialog
  thresholdDialogOpen: boolean;
  onThresholdDialogClose: () => void;

  // Apdex SLO dialog
  sloDialogOpen: boolean;
  onSloDialogClose: () => void;

  // Aggregated SLO dialog
  aggregatedSloDialogOpen: boolean;
  onAggregatedSloDialogClose: () => void;

  // Baseline dialog
  baselineDialogOpen: boolean;
  onBaselineDialogClose: () => void;

  // Thresholds management dialog
  thresholdsManagementDialogOpen: boolean;
  onThresholdsManagementDialogClose: () => void;

  // Errors modal
  errorsModalOpen: boolean;
  onErrorsModalClose: () => void;
  errorModalConfig: ErrorModalConfig;
  excludeRampUp: boolean;

  // Graph modal
  graphModalOpen: boolean;
  onGraphModalClose: () => void;
  graphModalTransactionName: string;
  events?: PerfanaEvent[];

  // Request graph modal
  requestGraphModalOpen: boolean;
  onRequestGraphModalClose: () => void;
  requestGraphModalData: RequestGraphModalData;

  // Transaction details modal
  detailsModalOpen: boolean;
  onDetailsModalClose: () => void;
  detailsModalTransaction: TransactionStat | null;
  detailsModalSamplers: SamplerStat[];
  detailsModalLoading: boolean;

  // Sampler details modal
  samplerDetailsModalOpen: boolean;
  onSamplerDetailsModalClose: () => void;
  samplerDetailsModalData: SamplerStat | null;
}

export function PerformanceAnalysisDialogs({
  testRunId,
  transactions,
  testLevelThreshold,
  showToast,
  onConfigSuccess,
  configDialogOpen,
  onConfigDialogClose,
  selectedTransaction,
  thresholdDialogOpen,
  onThresholdDialogClose,
  sloDialogOpen,
  onSloDialogClose,
  aggregatedSloDialogOpen,
  onAggregatedSloDialogClose,
  baselineDialogOpen,
  onBaselineDialogClose,
  thresholdsManagementDialogOpen,
  onThresholdsManagementDialogClose,
  errorsModalOpen,
  onErrorsModalClose,
  errorModalConfig,
  excludeRampUp,
  graphModalOpen,
  onGraphModalClose,
  graphModalTransactionName,
  events,
  requestGraphModalOpen,
  onRequestGraphModalClose,
  requestGraphModalData,
  detailsModalOpen,
  onDetailsModalClose,
  detailsModalTransaction,
  detailsModalSamplers,
  detailsModalLoading,
  samplerDetailsModalOpen,
  onSamplerDetailsModalClose,
  samplerDetailsModalData,
}: PerformanceAnalysisDialogsProps) {
  return (
    <>
      {/* Apdex Configuration Dialog (used for transaction row menus) */}
      <ApdexConfigDialog
        open={configDialogOpen}
        onClose={onConfigDialogClose}
        testRunId={testRunId}
        transactionName={selectedTransaction}
        currentThreshold={
          selectedTransaction
            ? transactions.find(t => t.transaction_name === selectedTransaction)?.active_threshold
            : testLevelThreshold
        }
        onSuccess={onConfigSuccess}
      />

      {/* Apdex Threshold Dialog (test-level) */}
      <ApdexThresholdDialog
        open={thresholdDialogOpen}
        onClose={onThresholdDialogClose}
        testRunId={testRunId}
        currentThreshold={testLevelThreshold}
        onSuccess={onConfigSuccess}
      />

      {/* Apdex SLO Dialog */}
      <ApdexSloDialog
        open={sloDialogOpen}
        onClose={onSloDialogClose}
        testRunId={testRunId}
        currentThreshold={testLevelThreshold}
        onSuccess={onConfigSuccess}
      />

      {/* Aggregated SLO Dialog */}
      <AggregatedSloDialog
        open={aggregatedSloDialogOpen}
        onClose={onAggregatedSloDialogClose}
        testRunId={testRunId}
        onSuccess={onConfigSuccess}
      />

      {/* Baseline Apdex Dialog */}
      <BaselineApdexDialog
        open={baselineDialogOpen}
        onClose={onBaselineDialogClose}
        testRunId={testRunId}
        onSuccess={onConfigSuccess}
      />

      {/* Apdex Thresholds Management Dialog */}
      <ApdexThresholdsManagementDialog
        open={thresholdsManagementDialogOpen}
        onClose={onThresholdsManagementDialogClose}
        testRunId={testRunId}
        apdexCheckResult={null}
        onSuccess={onConfigSuccess}
      />

      {/* Errors Modal */}
      <ErrorsModal
        open={errorsModalOpen}
        onClose={onErrorsModalClose}
        testRunId={testRunId}
        transactionName={errorModalConfig.transactionName}
        samplerName={errorModalConfig.samplerName}
        title={errorModalConfig.title}
        excludeRampUp={excludeRampUp}
      />

      {/* Graph Modal */}
      <TransactionGraphModal
        open={graphModalOpen}
        onClose={onGraphModalClose}
        testRunId={testRunId}
        transactionName={graphModalTransactionName}
        showToast={showToast}
        events={events}
      />

      {/* Request Time Series Graph Modal */}
      <RequestTimeSeriesModal
        open={requestGraphModalOpen}
        onClose={onRequestGraphModalClose}
        testRunId={testRunId}
        transactionName={requestGraphModalData.transactionName}
        samplerName={requestGraphModalData.samplerName}
        showToast={showToast}
      />

      {/* Transaction Details Modal */}
      <TransactionDetailsModal
        open={detailsModalOpen}
        onClose={onDetailsModalClose}
        transaction={detailsModalTransaction}
        samplers={detailsModalSamplers}
        loading={detailsModalLoading}
      />

      {/* Sampler Details Modal */}
      <SamplerDetailsModal
        open={samplerDetailsModalOpen}
        onClose={onSamplerDetailsModalClose}
        sampler={samplerDetailsModalData}
      />
    </>
  );
}
