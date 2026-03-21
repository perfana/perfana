export * from './pyroscope.types';

/**
 * Props for usePyroscopeData hook
 */
export interface UsePyroscopeDataProps {
  testRun: import('./pyroscope.types').PyroscopeTestRun;
  expanded: boolean;
}

/**
 * View mode tab values
 */
export type ViewMode = 0 | 1; // 0 = Single View, 1 = Diff View
