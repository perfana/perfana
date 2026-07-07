import { ApiKey } from '@/lib/api-keys';

/**
 * Snackbar notification state
 */
export interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

/**
 * TTL option for API key creation
 */
export interface TtlOption {
  value: string;
  label: string;
}

/**
 * Available TTL options for API keys
 */
export const TTL_OPTIONS: TtlOption[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '1 week' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
];

/**
 * Settings section type identifier
 */
export type SettingsSectionType = 'api-keys' | 'general' | 'notifications';

/**
 * Settings section card configuration
 */
export interface SettingsSectionConfig {
  type: SettingsSectionType;
  title: string;
  description?: string;
  icon: React.ReactNode;
  color: string;
  comingSoon?: boolean;
}

/**
 * Brand colors for each settings section
 */
export const SECTION_COLORS = {
  'api-keys': 'rgba(25, 118, 210, 1)',
  'general': 'rgba(156, 39, 176, 1)',
  'notifications': 'rgba(255, 152, 0, 1)',
  'alert-filters': 'rgba(244, 67, 54, 1)',
  'proxy': 'rgba(0, 150, 136, 1)',
} as const;

/**
 * Props for useApiKeys hook
 */
export interface UseApiKeysProps {
  onSnackbar: (state: SnackbarState) => void;
}

/**
 * Return type for useApiKeys hook
 */
export interface UseApiKeysReturn {
  apiKeys: ApiKey[];
  loading: boolean;
  error: string;
  createdToken: string;
  createDialogOpen: boolean;
  deleteDialogOpen: boolean;
  selectedKey: ApiKey | null;
  form: ReturnType<typeof import('react-hook-form').useForm>;
  loadApiKeys: () => Promise<void>;
  handleCreateKey: (data: import('@/lib/validations').CreateApiKeyFormData) => Promise<void>;
  handleDeleteKey: (keyId: string) => Promise<void>;
  setCreateDialogOpen: (open: boolean) => void;
  setDeleteDialogOpen: (open: boolean) => void;
  setSelectedKey: (key: ApiKey | null) => void;
  clearCreatedToken: () => void;
  copyToClipboard: (text: string) => Promise<void>;
}
