import {
  Timer,
  Error as ErrorIcon,
  Computer,
  Storage,
  QueryStats,
  AccountTree,
  Whatshot,
  Route,
  ShowChart,
  FlashOn,
  Language,
  Warning,
  Sync,
} from '@mui/icons-material';
import { AnalysisItem, DeepLinkItem } from '../types';

/**
 * Entity type color mapping
 */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  SERVICE: 'rgba(25, 118, 210, 0.8)',
  HOST: 'rgba(76, 175, 80, 0.8)',
  APPLICATION: 'rgba(156, 39, 176, 0.8)',
  PROCESS_GROUP: 'rgba(255, 152, 0, 0.8)',
};

/**
 * Get color for entity type
 */
export function getEntityTypeColor(type: string): string {
  return ENTITY_TYPE_COLORS[type] || 'rgba(96, 125, 139, 0.8)';
}

/**
 * Get accent color based on error state
 */
export function getAccentColor(hasError: boolean): string {
  if (hasError) {
    return '#f44336'; // Red for error
  }
  return '#9c27b0'; // Purple for Dynatrace
}

/**
 * Multidimensional analysis options
 */
export const MULTIDIMENSIONAL_ANALYSIS_ITEMS: AnalysisItem[] = [
  { key: 'response-times', label: 'Response Times', icon: Timer, description: 'Analyze response time patterns' },
  { key: 'failure-rate', label: 'Failure Rate', icon: ErrorIcon, description: 'Monitor error rates and failures' },
  { key: 'cpu-time', label: 'CPU Time', icon: Computer, description: 'CPU consumption analysis' },
  { key: 'io-time', label: 'I/O Time', icon: Storage, description: 'Input/output operation timing' },
  { key: 'db-time', label: 'Database Calls', icon: QueryStats, description: 'Time spent in database operations' },
  { key: 'other-services-time', label: 'Service Calls', icon: AccountTree, description: 'Time spent calling other services' },
  { key: 'wait-time', label: 'Wait Time', icon: Timer, description: 'Time spent waiting' },
  { key: 'lock-time', label: 'Lock Time', icon: Timer, description: 'Time spent in locks' },
];

/**
 * Deep link options for performance insights
 */
export const DEEP_LINK_ITEMS: DeepLinkItem[] = [
  { key: 'response-time-hotspots', label: 'Response Time Hotspots', icon: Whatshot, description: 'Identify performance bottlenecks' },
  { key: 'pure-paths', label: 'Distributed Tracing', icon: Route, description: 'Trace complete request paths' },
  { key: 'outliers', label: 'Outlier Analysis', icon: ShowChart, description: 'Find unusual response patterns' },
  { key: 'method-hotspots', label: 'Method Hotspots', icon: FlashOn, description: 'Analyze method-level performance' },
  { key: 'top-web-requests', label: 'Top Web Requests', icon: Language, description: 'View most frequent requests' },
  { key: 'exception-analysis', label: 'Exception Analysis', icon: Warning, description: 'Monitor errors and exceptions' },
  { key: 'service-flow', label: 'Service Flow', icon: Sync, description: 'Visualize service dependencies' },
];

/**
 * Metric type to Dynatrace metric name mapping
 */
export const METRIC_TYPE_MAP: Record<string, string> = {
  'response-times': 'RESPONSE_TIME',
  'failure-rate': 'FAILURE_RATE',
  'cpu-time': 'CPU_TIME',
  'io-time': 'IO_TIME',
  'db-time': 'DATABASE_CHILD_CALL_TIME',
  'other-services-time': 'NON_DATABASE_CHILD_CALL_TIME',
  'wait-time': 'WAIT_TIME',
  'lock-time': 'LOCK_TIME',
};
