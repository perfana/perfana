'use client';

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TransactionStat, SamplerStat } from '../types/performance-analysis.types';

export interface ErrorModalConfig {
  transactionName?: string;
  samplerName?: string;
  title?: string;
}

export interface SamplerActionMenuData {
  transaction: string;
  sampler: SamplerStat;
}

export interface RequestGraphModalData {
  transactionName: string;
  samplerName: string;
}

export interface UsePerformanceAnalysisHandlersProps {
  testRunId: string;
  transactions: TransactionStat[];
  excludeRampUp: boolean;
  refreshAll: () => void;
}

export interface UsePerformanceAnalysisHandlersReturn {
  // Tab state
  activeTab: number;
  setActiveTab: (tab: number) => void;

  // Config dialog
  configDialogOpen: boolean;
  setConfigDialogOpen: (open: boolean) => void;
  selectedTransaction: string | undefined;
  handleOpenTestConfig: () => void;
  handleOpenTransactionConfig: (transactionName: string) => void;
  handleConfigSuccess: () => void;

  // Apdex menu
  apdexMenuAnchor: HTMLElement | null;
  handleOpenApdexMenu: (event: React.MouseEvent<HTMLElement>) => void;
  handleCloseApdexMenu: () => void;

  // Apdex dialogs
  thresholdDialogOpen: boolean;
  setThresholdDialogOpen: (open: boolean) => void;
  sloDialogOpen: boolean;
  setSloDialogOpen: (open: boolean) => void;
  baselineDialogOpen: boolean;
  setBaselineDialogOpen: (open: boolean) => void;
  thresholdsManagementDialogOpen: boolean;
  setThresholdsManagementDialogOpen: (open: boolean) => void;
  handleOpenThresholdDialog: () => void;
  handleOpenSloDialog: () => void;
  handleOpenBaselineDialog: () => void;
  handleOpenThresholdsManagementDialog: () => void;

  // Errors modal
  errorsModalOpen: boolean;
  setErrorsModalOpen: (open: boolean) => void;
  errorModalConfig: ErrorModalConfig;
  handleOpenTransactionErrors: (transactionName: string) => void;
  handleOpenSamplerErrors: (transactionName: string, samplerName: string) => void;

  // Graph modal
  graphModalOpen: boolean;
  setGraphModalOpen: (open: boolean) => void;
  graphModalTransactionName: string;
  handleOpenGraphModal: (transactionName: string) => void;

  // Transaction action menu
  actionMenuAnchor: HTMLElement | null;
  actionMenuTransaction: string;
  handleOpenActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string) => void;
  handleCloseActionMenu: () => void;
  handleConfigureApdex: () => void;

  // Transaction details modal
  detailsModalOpen: boolean;
  setDetailsModalOpen: (open: boolean) => void;
  detailsModalTransaction: TransactionStat | null;
  detailsModalSamplers: SamplerStat[];
  detailsModalLoading: boolean;
  handleShowDetails: () => void;

  // Sampler action menu
  samplerActionMenuAnchor: HTMLElement | null;
  samplerActionMenuData: SamplerActionMenuData | null;
  handleOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  handleCloseSamplerActionMenu: () => void;
  handleShowSamplerDetails: () => void;

  // Sampler details modal
  samplerDetailsModalOpen: boolean;
  setSamplerDetailsModalOpen: (open: boolean) => void;
  samplerDetailsModalData: SamplerStat | null;

  // Request time series modal
  requestGraphModalOpen: boolean;
  setRequestGraphModalOpen: (open: boolean) => void;
  requestGraphModalData: RequestGraphModalData;
  setRequestGraphModalData: (data: RequestGraphModalData) => void;

  // Utility functions
  handleCopyToClipboard: (text: string) => void;
}

export function usePerformanceAnalysisHandlers({
  testRunId,
  transactions,
  excludeRampUp,
  refreshAll,
}: UsePerformanceAnalysisHandlersProps): UsePerformanceAnalysisHandlersReturn {
  // Tab state
  const [activeTab, setActiveTab] = useState(0);

  // Config dialog
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<string | undefined>(undefined);

  // Apdex menu
  const [apdexMenuAnchor, setApdexMenuAnchor] = useState<HTMLElement | null>(null);

  // Apdex dialogs
  const [thresholdDialogOpen, setThresholdDialogOpen] = useState(false);
  const [sloDialogOpen, setSloDialogOpen] = useState(false);
  const [baselineDialogOpen, setBaselineDialogOpen] = useState(false);
  const [thresholdsManagementDialogOpen, setThresholdsManagementDialogOpen] = useState(false);

  // Errors modal
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [errorModalConfig, setErrorModalConfig] = useState<ErrorModalConfig>({});

  // Graph modal
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [graphModalTransactionName, setGraphModalTransactionName] = useState<string>('');

  // Transaction action menu
  const [actionMenuAnchor, setActionMenuAnchor] = useState<HTMLElement | null>(null);
  const [actionMenuTransaction, setActionMenuTransaction] = useState<string>('');

  // Transaction details modal
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [detailsModalTransaction, setDetailsModalTransaction] = useState<TransactionStat | null>(null);
  const [detailsModalSamplers, setDetailsModalSamplers] = useState<SamplerStat[]>([]);
  const [detailsModalLoading, setDetailsModalLoading] = useState(false);

  // Sampler action menu
  const [samplerActionMenuAnchor, setSamplerActionMenuAnchor] = useState<HTMLElement | null>(null);
  const [samplerActionMenuData, setSamplerActionMenuData] = useState<SamplerActionMenuData | null>(null);

  // Sampler details modal
  const [samplerDetailsModalOpen, setSamplerDetailsModalOpen] = useState(false);
  const [samplerDetailsModalData, setSamplerDetailsModalData] = useState<SamplerStat | null>(null);

  // Request time series modal
  const [requestGraphModalOpen, setRequestGraphModalOpen] = useState(false);
  const [requestGraphModalData, setRequestGraphModalData] = useState<RequestGraphModalData>({
    transactionName: '',
    samplerName: '',
  });

  // Config dialog handlers
  const handleOpenTestConfig = useCallback(() => {
    setSelectedTransaction(undefined);
    setConfigDialogOpen(true);
  }, []);

  const handleOpenTransactionConfig = useCallback((transactionName: string) => {
    setSelectedTransaction(transactionName);
    setConfigDialogOpen(true);
  }, []);

  const handleConfigSuccess = useCallback(() => {
    refreshAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [refreshAll]);

  // Apdex menu handlers
  const handleOpenApdexMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setApdexMenuAnchor(event.currentTarget);
  }, []);

  const handleCloseApdexMenu = useCallback(() => {
    setApdexMenuAnchor(null);
  }, []);

  const handleOpenThresholdDialog = useCallback(() => {
    handleCloseApdexMenu();
    setThresholdDialogOpen(true);
  }, [handleCloseApdexMenu]);

  const handleOpenSloDialog = useCallback(() => {
    handleCloseApdexMenu();
    setSloDialogOpen(true);
  }, [handleCloseApdexMenu]);

  const handleOpenBaselineDialog = useCallback(() => {
    handleCloseApdexMenu();
    setBaselineDialogOpen(true);
  }, [handleCloseApdexMenu]);

  const handleOpenThresholdsManagementDialog = useCallback(() => {
    handleCloseApdexMenu();
    setThresholdsManagementDialogOpen(true);
  }, [handleCloseApdexMenu]);

  // Errors modal handlers
  const handleOpenTransactionErrors = useCallback((transactionName: string) => {
    setErrorModalConfig({
      transactionName,
      title: `Errors for ${transactionName}`,
    });
    setErrorsModalOpen(true);
  }, []);

  const handleOpenSamplerErrors = useCallback((transactionName: string, samplerName: string) => {
    setErrorModalConfig({
      transactionName,
      samplerName,
      title: `Errors for ${samplerName}`,
    });
    setErrorsModalOpen(true);
  }, []);

  // Graph modal handlers
  const handleOpenGraphModal = useCallback((transactionName: string) => {
    setGraphModalTransactionName(transactionName);
    setGraphModalOpen(true);
  }, []);

  // Transaction action menu handlers
  const handleOpenActionMenu = useCallback((event: React.MouseEvent<HTMLElement>, transactionName: string) => {
    event.stopPropagation();
    setActionMenuAnchor(event.currentTarget);
    setActionMenuTransaction(transactionName);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setActionMenuAnchor(null);
    setActionMenuTransaction('');
  }, []);

  const handleConfigureApdex = useCallback(() => {
    handleOpenTransactionConfig(actionMenuTransaction);
    handleCloseActionMenu();
  }, [actionMenuTransaction, handleOpenTransactionConfig, handleCloseActionMenu]);

  const handleShowDetails = useCallback(async () => {
    const transaction = transactions.find(t => t.transaction_name === actionMenuTransaction);
    if (transaction) {
      setDetailsModalTransaction(transaction);
      setDetailsModalOpen(true);
      setDetailsModalLoading(true);
      handleCloseActionMenu();

      try {
        const response = await authenticatedFetch(
          `/test-runs/${testRunId}/transactions/${encodeURIComponent(transaction.transaction_name)}/samples?excludeRampUp=${excludeRampUp}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch transaction details');
        }

        const samplers = await response.json();
        setDetailsModalSamplers(samplers);
      } catch (err) {
        console.error('Error fetching transaction details:', err);
        setDetailsModalSamplers([]);
      } finally {
        setDetailsModalLoading(false);
      }
    } else {
      handleCloseActionMenu();
    }
  }, [transactions, actionMenuTransaction, testRunId, excludeRampUp, handleCloseActionMenu]);

  // Sampler action menu handlers
  const handleOpenSamplerActionMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => {
      event.stopPropagation();
      setSamplerActionMenuAnchor(event.currentTarget);
      setSamplerActionMenuData({ transaction, sampler });
    },
    []
  );

  const handleCloseSamplerActionMenu = useCallback(() => {
    setSamplerActionMenuAnchor(null);
    setSamplerActionMenuData(null);
  }, []);

  const handleShowSamplerDetails = useCallback(() => {
    if (samplerActionMenuData) {
      setSamplerDetailsModalData(samplerActionMenuData.sampler);
      setSamplerDetailsModalOpen(true);
      handleCloseSamplerActionMenu();
    }
  }, [samplerActionMenuData, handleCloseSamplerActionMenu]);

  // Utility functions
  const handleCopyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  return {
    // Tab state
    activeTab,
    setActiveTab,

    // Config dialog
    configDialogOpen,
    setConfigDialogOpen,
    selectedTransaction,
    handleOpenTestConfig,
    handleOpenTransactionConfig,
    handleConfigSuccess,

    // Apdex menu
    apdexMenuAnchor,
    handleOpenApdexMenu,
    handleCloseApdexMenu,

    // Apdex dialogs
    thresholdDialogOpen,
    setThresholdDialogOpen,
    sloDialogOpen,
    setSloDialogOpen,
    baselineDialogOpen,
    setBaselineDialogOpen,
    thresholdsManagementDialogOpen,
    setThresholdsManagementDialogOpen,
    handleOpenThresholdDialog,
    handleOpenSloDialog,
    handleOpenBaselineDialog,
    handleOpenThresholdsManagementDialog,

    // Errors modal
    errorsModalOpen,
    setErrorsModalOpen,
    errorModalConfig,
    handleOpenTransactionErrors,
    handleOpenSamplerErrors,

    // Graph modal
    graphModalOpen,
    setGraphModalOpen,
    graphModalTransactionName,
    handleOpenGraphModal,

    // Transaction action menu
    actionMenuAnchor,
    actionMenuTransaction,
    handleOpenActionMenu,
    handleCloseActionMenu,
    handleConfigureApdex,

    // Transaction details modal
    detailsModalOpen,
    setDetailsModalOpen,
    detailsModalTransaction,
    detailsModalSamplers,
    detailsModalLoading,
    handleShowDetails,

    // Sampler action menu
    samplerActionMenuAnchor,
    samplerActionMenuData,
    handleOpenSamplerActionMenu,
    handleCloseSamplerActionMenu,
    handleShowSamplerDetails,

    // Sampler details modal
    samplerDetailsModalOpen,
    setSamplerDetailsModalOpen,
    samplerDetailsModalData,

    // Request time series modal
    requestGraphModalOpen,
    setRequestGraphModalOpen,
    requestGraphModalData,
    setRequestGraphModalData,

    // Utility functions
    handleCopyToClipboard,
  };
}
