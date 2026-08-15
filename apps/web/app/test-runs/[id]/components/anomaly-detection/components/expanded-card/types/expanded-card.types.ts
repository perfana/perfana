/**
 * Types for AnomalyDetectionExpandedCard component
 */

import type { DrawerData } from '../../../types';
import { TestRun } from '@/types/test-runs';
import { AnomalyData, MetricTrendData } from '../../../types';
import { DeleteOptions } from '../../DeleteAnomalyDialog';
import type { AnomalySortKey, SortDirection, DiffSortMode } from '../../../hooks/useAnomalyDetection';

/**
 * Feedback state for anomaly detection
 */
export type FeedbackState = 'tbd' | 'accepted' | 'denied' | null;

/**
 * Adapt config status values
 */
export type AdaptConfigStatus = 'ACCEPTED' | 'DENIED' | 'TBD';

/**
 * Props for the expanded card header
 */
export interface ExpandedCardHeaderProps {
  onCollapse: () => void;
}

/**
 * Props for feedback banners
 */
export interface FeedbackBannerProps {
  feedbackState: FeedbackState;
  isBaselineMode?: boolean;
  onDisableBaselineMode?: () => Promise<void>;
  onMarkAsRegression: () => Promise<void>;
  onMarkAsVariability: () => Promise<void>;
  onMarkAsChangepoint: () => void;
}

/**
 * Props for the anomaly tab content
 */
export interface AnomalyTabContentProps {
  loading: boolean;
  anomalyData: AnomalyData[];
  searchQuery: string;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  conclusionFilter: string;
  handleConclusionFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  classificationFilter: string;
  handleClassificationFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  dashboardFilter: string;
  handleDashboardFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  panelFilter: string;
  handlePanelFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  conclusionsForDropdown: string[];
  classificationsForDropdown: string[];
  dashboardsForDropdown: string[];
  panelsForDropdown: string[];
  filteredData: AnomalyData[];
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  feedbackState: FeedbackState;
  onMarkAsRegression: () => Promise<void>;
  onMarkAsVariability: () => Promise<void>;
  onMarkAsChangepoint: () => void;
  onDisableBaselineMode?: () => Promise<void>;
  // Table props
  paginatedData: AnomalyData[];
  page: number;
  rowsPerPage: number;
  onPageChange: (event: unknown, newPage: number) => void;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  expandedRows: Set<string>;
  toggleRowExpanded: (rowKey: string) => void;
  testRunId: string;
  testRun: TestRun | null;
  trendsData: Record<string, MetricTrendData[]>;
  trendsLoading: Record<string, boolean>;
  chartKey: Record<string, number>;
  drawerOpen: Record<string, boolean>;
  onDrawerToggle: (rowKey: string) => void;
  /** ADAPT result per expanded row, keyed by the row key. */
  drawerData: Record<string, DrawerData>;
  drawerLoading: Record<string, boolean>;
  showToast: (message: string) => void;
  showConfigForm: Record<string, boolean>;
  configFormData: Record<string, unknown>;
  onConfigFormToggle: (rowKey: string) => void;
  onConfigSave: (rowKey: string, data: unknown, scope: 'metric' | 'panel') => Promise<void>;
  onRefreshAnomalyData?: () => void;
  onDeleteAnomaly: (anomaly: AnomalyData, options: DeleteOptions) => Promise<void>;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
  onDrillDownToDynatrace?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
  // Sort state
  sortBy: AnomalySortKey | null;
  sortDirection: SortDirection;
  diffSortMode: DiffSortMode;
  onSortChange: (key: AnomalySortKey) => void;
  onDiffSortModeChange: (mode: DiffSortMode) => void;
}

/**
 * Props for tracked regressions tab content
 */
export interface TrackedRegressionsTabContentProps {
  testRunId: string;
  testRun: TestRun | null;
  trendsData: Record<string, MetricTrendData[]>;
  onRefreshAnomalyData?: () => void;
  showToast: (message: string) => void;
}

/**
 * Main props for the AnomalyDetectionExpandedCard
 */
export interface AnomalyDetectionExpandedCardProps {
  testRun: TestRun | null;
  testRunId: string;
  data: AnomalyData[];
  loading: boolean;
  error?: string;
  trackedCount: number;

  // Filter state
  searchQuery: string;
  onSearchChange: (query: string) => void;
  conclusionFilter: string;
  onConclusionFilterChange: (filter: string) => void;
  classificationFilter: string;
  onClassificationFilterChange: (filter: string) => void;

  // Table state
  page: number;
  rowsPerPage: number;
  onPageChange: (event: unknown, newPage: number) => void;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;

  // Row interaction state
  expandedRows: Set<string>;
  onRowToggle: (rowKey: string) => void;

  // Drawer state
  drawerOpen: Record<string, boolean>;
  onDrawerToggle: (rowKey: string) => void;
  /** ADAPT result per expanded row, keyed by the row key. */
  drawerData: Record<string, DrawerData>;
  drawerLoading: Record<string, boolean>;

  // Trends state
  trendsData: Record<string, MetricTrendData[]>;
  trendsLoading: Record<string, boolean>;
  chartKey: Record<string, number>;

  // Configuration state
  showConfigForm: Record<string, boolean>;
  onConfigFormToggle: (rowKey: string) => void;
  configFormData: Record<string, unknown>;
  onConfigSave: (rowKey: string, data: unknown, scope: 'metric' | 'panel') => Promise<void>;

  // Feedback state
  onAcceptResults: () => void;
  onDenyResults: () => void;
  updateAdaptConfig: (status: AdaptConfigStatus) => void;
  disableBaselineMode?: () => Promise<void>;

  // UI handlers
  onCollapse: () => void;
  showToast: (message: string) => void;
  onRefreshAnomalyData?: () => void;

  // Tab state
  activeTab: number;
  onTabChange: (tabIndex: number) => void;

  // Additional props
  pendingConclusionRef: React.MutableRefObject<string | null>;
  cardRef: React.RefObject<HTMLDivElement | null>;
  conclusionsForDropdown: string[];
  classificationsForDropdown: string[];
  dashboardsForDropdown: string[];
  panelsForDropdown: string[];
  filteredData: AnomalyData[];
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleConclusionFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  handleClassificationFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  dashboardFilter: string;
  handleDashboardFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  panelFilter: string;
  handlePanelFilterChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  paginatedData: AnomalyData[];
  toggleRowExpanded: (rowKey: string) => void;
  onDeleteAnomaly: (anomaly: AnomalyData, options: DeleteOptions) => Promise<void>;

  // Drill-down functionality
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
  onDrillDownToDynatrace?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;

  // Sort state
  sortBy: AnomalySortKey | null;
  sortDirection: SortDirection;
  diffSortMode: DiffSortMode;
  onSortChange: (key: AnomalySortKey) => void;
  onDiffSortModeChange: (mode: DiffSortMode) => void;
}
