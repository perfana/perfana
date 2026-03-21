import { Profile, ProfileDashboard } from '@/lib/profiles';
import { ProfileBenchmark } from '@/lib/profile-benchmarks';

/**
 * Snackbar notification state
 */
export interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

/**
 * Props for useProfileData hook
 */
export interface UseProfileDataProps {
  profileId: string;
}

/**
 * Props for useDashboards hook
 */
export interface UseDashboardsProps {
  profileId: string;
  onSnackbar: (state: SnackbarState) => void;
}

/**
 * Props for useBenchmarks hook
 */
export interface UseBenchmarksProps {
  profileId: string;
  onSnackbar: (state: SnackbarState) => void;
}

/**
 * Props for useGrafanaData hook
 */
export interface UseGrafanaDataProps {
  onSnackbar: (state: SnackbarState) => void;
}

/**
 * TabPanel component props
 */
export interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

/**
 * Props for BatchDeleteDialog component
 */
export interface BatchDeleteDialogProps {
  open: boolean;
  itemCount: number;
  itemType: 'dashboard' | 'SLO';
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Dashboard management state returned by useDashboards hook
 */
export interface DashboardsState {
  dashboards: ProfileDashboard[];
  loading: boolean;
  error: string;
  selectedIds: Set<string>;
  formDialogOpen: boolean;
  formMode: 'create' | 'edit';
  editingDashboard: ProfileDashboard | undefined;
  batchDeleteDialogOpen: boolean;
}

/**
 * Dashboard management actions returned by useDashboards hook
 */
export interface DashboardsActions {
  loadDashboards: () => Promise<void>;
  handleAdd: () => Promise<void>;
  handleEdit: (dashboard: ProfileDashboard) => Promise<void>;
  handleDelete: (dashboardId: string) => Promise<void>;
  handleFormSubmit: (data: unknown) => Promise<void>;
  handleSelectAll: () => void;
  handleSelectOne: (id: string) => void;
  handleBatchDelete: () => Promise<void>;
  setFormDialogOpen: (open: boolean) => void;
  setBatchDeleteDialogOpen: (open: boolean) => void;
}

/**
 * Benchmark management state returned by useBenchmarks hook
 */
export interface BenchmarksState {
  benchmarks: ProfileBenchmark[];
  loading: boolean;
  error: string;
  selectedIds: Set<string>;
  formDialogOpen: boolean;
  formMode: 'create' | 'edit';
  editingBenchmark: ProfileBenchmark | undefined;
  batchDeleteDialogOpen: boolean;
}

/**
 * Benchmark management actions returned by useBenchmarks hook
 */
export interface BenchmarksActions {
  loadBenchmarks: () => Promise<void>;
  handleAdd: () => void;
  handleEdit: (benchmark: ProfileBenchmark) => void;
  handleDelete: (benchmarkId: string) => Promise<void>;
  handleFormSubmit: (data: unknown) => Promise<void>;
  handleSelectAll: () => void;
  handleSelectOne: (id: string) => void;
  handleBatchDelete: () => Promise<void>;
  setFormDialogOpen: (open: boolean) => void;
  setBatchDeleteDialogOpen: (open: boolean) => void;
}
