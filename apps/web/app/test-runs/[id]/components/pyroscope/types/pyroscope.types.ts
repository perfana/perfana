/**
 * Pyroscope Types
 * Type definitions for Pyroscope profiling card components
 */

export interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
  completed: boolean;
  application_release?: string;
  start_time?: string;
  end_time?: string;
  annotations?: string[];
}

export interface PyroscopeInstance {
  id: string;
  label: string;
  pyroscopeUrl: string;
  pyroscope_url: string;
  backendUrl?: string;
  backend_url?: string;
  pyroscopeStandAlone: boolean;
  pyroscope_stand_alone: boolean;
}

export interface PyroscopeConfiguration {
  application: string;
  profiler: string;
}

export interface SystemUnderTest {
  name?: string;
  pyroscope_instance_id?: string;
  pyroscope_configurations?: PyroscopeConfiguration[];
  pyroscopeInstance?: PyroscopeInstance;
}

export interface FlamegraphDiff {
  function: string;
  baselineSamples: number;
  currentSamples: number;
  delta: number;
  deltaPercent: number;
  significance: 'high' | 'medium' | 'low';
  changeType: 'regression' | 'improvement' | 'new' | 'removed' | 'stable';
  baselinePercent?: number;
  currentPercent?: number;
}

export interface FlamegraphSummary {
  baselineTotal: number;
  currentTotal: number;
  totalDelta: number;
  totalDeltaPercent: number;
}

export interface FlamegraphAnalysis {
  summary: FlamegraphSummary;
  topFunctionChanges: FlamegraphDiff[];
  regressions?: FlamegraphDiff[];
  improvements?: FlamegraphDiff[];
  newHotspots: string[];
  improvedFunctions: string[];
  tableReport: string;
  error?: string;
}

export interface PyroscopeTestRun {
  id: string;
  test_run_id: string;
  system_under_test_id: string;
  start_time: string;
  end_time: string;
  test_environment: string;
  workload: string;
  system_under_test?: SystemUnderTest;
  systems_under_test?: SystemUnderTest;
}

export interface PyroscopeCardProps {
  testRun: PyroscopeTestRun;
  expanded: boolean;
  onExpand: () => void;
}

export interface PyroscopeCollapsedViewProps {
  profilers: string[];
  applications: string[];
  error: string | null;
}

export interface PyroscopeFlameGraphProps {
  url: string | null;
  loading: boolean;
  iframeLoading: boolean;
  title: string;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onOpenExternal?: () => void;
  externalDisabled?: boolean;
}

export interface PyroscopeAnalysisProps {
  analysis: FlamegraphAnalysis | null;
  analyzing: boolean;
  showAnalysis: boolean;
  onToggleAnalysis: () => void;
  symbolFilter: string;
  onSymbolFilterChange: (filter: string) => void;
  showAllRegressions: boolean;
  onToggleAllRegressions: () => void;
  showAllImprovements: boolean;
  onToggleAllImprovements: () => void;
  onOpenExternal: () => void;
  compareViewUrl: string | null;
  loading: boolean;
  selectedBaseline: RelatedTestRun | null;
}

export interface BaselineSelectorProps {
  relatedTestRuns: RelatedTestRun[];
  selectedBaseline: RelatedTestRun | null;
  onBaselineChange: (baseline: RelatedTestRun | null) => void;
  loading: boolean;
}
