import { ReEvaluateOption } from '@/lib/slo-reevaluation';

export interface TestRunDetails {
  system_under_test_id: string;
  system_name: string;
  test_environment: string;
  workload: string;
  /** test_run_id key — needed to queue a re-evaluation of this run. */
  test_run_id?: string;
}

export interface ExistingSlo {
  id: string;
  min_apdex_score: number;
  include_failed_requests: boolean;
  exclude_ramp_up_time: boolean;
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

export interface ApdexConfigState {
  threshold: string;
  loading: boolean;
  error: string | null;
  success: boolean;
  enableSlo: boolean;
  minApdexScore: number;
  includeFailedRequests: boolean;
  excludeRampUpTime: boolean;
  testRunDetails: TestRunDetails | null;
  loadingTestRun: boolean;
  existingSlo: ExistingSlo | null;
  loadingSlo: boolean;
  sloCheckFailed: boolean;
  saveDialogOpen: boolean;
  saveDialogOption: ReEvaluateOption;
}

export interface ApdexConfigActions {
  setThreshold: (value: string) => void;
  setEnableSlo: (value: boolean) => void;
  setMinApdexScore: (value: number) => void;
  setIncludeFailedRequests: (value: boolean) => void;
  setExcludeRampUpTime: (value: boolean) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  setSaveDialogOption: (option: ReEvaluateOption) => void;
  handleSaveDialogConfirm: (option: ReEvaluateOption) => Promise<void>;
  handleSaveDialogClose: () => void;
}
