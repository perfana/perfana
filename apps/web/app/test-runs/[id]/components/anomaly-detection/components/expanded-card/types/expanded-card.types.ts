/**
 * Types for AnomalyDetectionExpandedCard component
 */

import { TestRun } from '@/types/test-runs';
import { AnomalyData } from '../../../types';

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
  handleConclusionFilterChange: (e: any) => void;
  classificationFilter: string;
  handleClassificationFilterChange: (e: any) => void;
  dashboardFilter: string;
  handleDashboardFilterChange: (e: any) => void;
  panelFilter: string;
  handlePanelFilterChange: (e: any) => void;
  conclusionsForDropdown: string[];
  classificationsForDropdown: string[];
  dashboardsForDropdown: string[];
  panelsForDropdown: string[];
  filteredData: AnomalyData[];
  feedbackState: FeedbackState;
  onMarkAsRegression: () => Promise<void>;
  onMarkAsVariability: () => Promise<void>;
  onMarkAsChangepoint: () => void;
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
  trendsData: Record<string, any[]>;
  trendsLoading: Record<string, boolean>;
  chartKey: Record<string, number>;
  drawerOpen: Record<string, boolean>;
  onDrawerToggle: (rowKey: string) => void;
  drawerData: Record<string, any>;
  drawerLoading: Record<string, boolean>;
  showToast: (message: string) => void;
  showConfigForm: Record<string, boolean>;
  configFormData: Record<string, any>;
  onConfigFormToggle: (rowKey: string) => void;
  onConfigSave: (rowKey: string, data: any) => void;
  onRefreshAnomalyData?: () => void;
  onDeleteAnomaly: () => void;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
  onDrillDownToDynatrace?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
}

/**
 * Props for tracked regressions tab content
 */
export interface TrackedRegressionsTabContentProps {
  testRunId: string;
  testRun: TestRun | null;
  trendsData: Record<string, any[]>;
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
  drawerData: Record<string, any>;
  drawerLoading: Record<string, boolean>;

  // Trends state
  trendsData: Record<string, any[]>;
  trendsLoading: Record<string, boolean>;
  chartKey: Record<string, number>;

  // Configuration state
  showConfigForm: Record<string, boolean>;
  onConfigFormToggle: (rowKey: string) => void;
  configFormData: Record<string, any>;
  onConfigSave: (rowKey: string, data: any) => void;

  // Feedback state
  onAcceptResults: () => void;
  onDenyResults: () => void;
  updateAdaptConfig: (status: AdaptConfigStatus) => void;

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
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleConclusionFilterChange: (e: any) => void;
  handleClassificationFilterChange: (e: any) => void;
  dashboardFilter: string;
  handleDashboardFilterChange: (e: any) => void;
  panelFilter: string;
  handlePanelFilterChange: (e: any) => void;
  paginatedData: AnomalyData[];
  toggleRowExpanded: (rowKey: string) => void;
  onDeleteAnomaly: () => void;

  // Drill-down functionality
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
  onDrillDownToDynatrace?: (filters: { scenario?: string; transaction?: string; sampler?: string }) => void;
}
