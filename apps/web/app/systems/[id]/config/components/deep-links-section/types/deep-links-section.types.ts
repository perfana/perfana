/**
 * Types for DeepLinksSection component
 */

export interface DeepLink {
  id: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  name: string;
  url: string;
  tags: string[];
  templateDeepLinkId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeepLinkFormData {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  name: string;
  url: string;
  tags: string[];
}

export interface DeepLinksSectionProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

export interface UseDeepLinksSectionReturn {
  // Data state
  deepLinks: DeepLink[];
  loading: boolean;
  error: string | null;

  // Dialog state
  addDialogOpen: boolean;
  editDialogOpen: boolean;
  editingDeepLink: DeepLink | null;
  deleteDialogOpen: boolean;
  deletingDeepLink: DeepLink | null;
  batchDeleteDialogOpen: boolean;

  // Loading states
  submitting: boolean;
  deleteLoading: boolean;

  // Selection state
  selectedDeepLinkIds: Set<string>;

  // Dialog actions
  setAddDialogOpen: (open: boolean) => void;
  setEditDialogOpen: (open: boolean) => void;
  setEditingDeepLink: (deepLink: DeepLink | null) => void;
  setDeleteDialogOpen: (open: boolean) => void;
  setBatchDeleteDialogOpen: (open: boolean) => void;

  // Data handlers
  handleCreateDeepLink: (deepLinkData: DeepLinkFormData) => Promise<void>;
  handleUpdateDeepLink: (id: string, deepLinkData: DeepLinkFormData) => Promise<void>;
  handleDeleteDeepLink: (deepLink: DeepLink) => void;
  handleConfirmDelete: () => Promise<void>;

  // Selection handlers
  handleSelectAll: () => void;
  handleSelectOne: (id: string) => void;
  handleClearSelection: () => void;

  // Batch handlers
  handleBatchDeleteClick: () => void;
  handleBatchDeleteConfirm: () => Promise<void>;
  handleBatchDeleteCancel: () => void;
}

export interface BatchActionsToolbarProps {
  selectedCount: number;
  onBatchDelete: () => void;
  onClearSelection: () => void;
}

export interface DeepLinksTableProps {
  deepLinks: DeepLink[];
  selectedDeepLinkIds: Set<string>;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
  onEdit: (deepLink: DeepLink) => void;
  onDelete: (deepLink: DeepLink) => void;
}

export interface BatchDeleteDialogProps {
  open: boolean;
  selectedCount: number;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
