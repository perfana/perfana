export interface TestRunDetails {
  system_under_test_id: string;
  system_name: string;
  test_environment: string;
  workload: string;
}

export interface ExistingSlo {
  id: string;
  min_apdex_score: number;
  include_failed_requests: boolean;
  enabled: boolean;
}

export interface ApdexConfigDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  transactionName?: string;
  currentThreshold?: number;
  onSuccess: () => void;
}

export interface UseApdexConfigProps {
  testRunId: string;
  transactionName?: string;
  currentThreshold?: number;
  onSuccess: () => void;
  onClose: () => void;
  open: boolean;
}

export interface UseApdexConfigReturn {
  // Form state
  threshold: string;
  setThreshold: (value: string) => void;
  loading: boolean;
  error: string | null;
  success: boolean;

  // SLO state
  enableSlo: boolean;
  setEnableSlo: (value: boolean) => void;
  minApdexScore: number;
  setMinApdexScore: (value: number) => void;
  includeFailedRequests: boolean;
  setIncludeFailedRequests: (value: boolean) => void;

  // Data
  testRunDetails: TestRunDetails | null;
  existingSlo: ExistingSlo | null;
  loadingTestRun: boolean;
  loadingSlo: boolean;

  // Computed
  isTransactionLevel: boolean;
  title: string;

  // Actions
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
}
