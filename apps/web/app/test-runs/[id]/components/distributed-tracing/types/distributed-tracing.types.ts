import { TracingService } from '@/lib/distributed-tracing';

/**
 * Drill-down filters passed from other components
 */
export interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

/**
 * Props for the main DistributedTracingCard component
 */
export interface DistributedTracingCardProps {
  testRun: {
    id: string;
    test_run_id: string;
    system_under_test_id: string;
    start_time: string;
    end_time: string;
    test_environment: string;
    workload: string;
    systems_under_test?: {
      name: string;
    };
  };
  expanded: boolean;
  onExpand: () => void;
  initialFilters?: DrillDownFilters;
  onConfigurationStatus?: (hasConfiguration: boolean) => void;
}

/**
 * Flattened service name item with tracing service metadata
 */
export interface ServiceNameItem {
  serviceName: string;
  tracingServiceId: string;
  tracingInstanceLabel: string;
  tracingUi: 'tempo' | 'jaeger' | 'elastic';
}

/**
 * Props for the collapsed view component
 */
export interface DistributedTracingCollapsedViewProps {
  loading: boolean;
  tracingServices: TracingService[];
  totalServiceNames: number;
  uiTypes: string[];
}

/**
 * Props for the request filtering section
 */
export interface RequestFilteringSectionProps {
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedScenario: string | null;
  selectedTransaction: string | null;
  selectedSampler: string | null;
  minDuration: string;
  maxDuration: string;
  onScenarioChange: (value: string | null) => void;
  onTransactionChange: (value: string | null) => void;
  onSamplerChange: (value: string | null) => void;
  onMinDurationChange: (value: string) => void;
  onMaxDurationChange: (value: string) => void;
}

/**
 * Props for the visualise tab content
 */
export interface VisualiseTabProps {
  tracingUrl: string | null;
  loading: boolean;
  iframeLoading: boolean;
  iframeAllowed: boolean;
  tracingUi: string | undefined;
  onOpenExternal: () => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
}

/**
 * Return type for useDistributedTracingData hook
 */
export interface UseDistributedTracingDataReturn {
  // Loading states
  loading: boolean;
  error: string | null;
  iframeLoading: boolean;

  // Tracing services
  tracingServices: TracingService[];
  allServiceNames: ServiceNameItem[];
  currentServiceNameItem: ServiceNameItem | undefined;
  currentService: TracingService | undefined;

  // Filter state
  requestNames: string[];
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedScenario: string | null;
  selectedTransaction: string | null;
  selectedSampler: string | null;
  minDuration: string;
  maxDuration: string;

  // Tab state
  activeServiceNameTab: number;
  viewModeTab: number;

  // URL state
  tracingUrl: string | null;

  // Derived values
  totalServiceNames: number;
  uiTypes: string[];
  isTracesDiffEnabled: boolean;

  // Actions
  setError: (error: string | null) => void;
  setIframeLoading: (loading: boolean) => void;
  setSelectedScenario: (value: string | null) => void;
  setSelectedTransaction: (value: string | null) => void;
  setSelectedSampler: (value: string | null) => void;
  setMinDuration: (value: string) => void;
  setMaxDuration: (value: string) => void;
  handleServiceNameTabChange: (event: React.SyntheticEvent, newValue: number) => void;
  handleViewModeTabChange: (event: React.SyntheticEvent, newValue: number) => void;
  handleOpenExternal: () => void;
}
