import { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';

export type DataSource = 'grafana' | 'dynatrace' | 'performance-metrics';

export interface GraphsCardProps {
  testRun: TestRun | null;
  testRunId: string;
  graphsExpanded: boolean;
  onGraphsExpand: () => void;
  showToast: (message: string) => void;
  events?: PerfanaEvent[];
}

export interface ApplicationDashboard {
  id: string;
  dashboard_label: string;
  dashboard_name: string;
  dashboard_uid: string;
  metrics_source_id?: string;
  source_type?: string;
  grafanaInstance?: {
    label: string;
  };
}

export interface SeriesConfig {
  id: string; // unique ID for React keys
  dashboardId: string;
  dashboardLabel: string;
  panelId: number;
  panelTitle: string;
  metricName: string;
  source: DataSource;
  yAxisFormat?: string;
  metricsSourceId?: string;
  /** The panel's own unit, so the series table can show that `yAxisFormat` overrides it. */
  panelYAxisFormat?: string;
  /**
   * Which colour slot this series holds. Removing a series frees its slot, so the lines
   * that stay keep the colour the reader has been following — the old index-based
   * assignment recoloured every line below the one removed.
   */
  colorSlot?: number;
  /** Hidden from the chart but kept in the table (and in the preset). */
  hidden?: boolean;
}

export interface MetricDataPoint {
  time: string;
  metric_name: string;
  value: number;
  timestep: number;
  ramp_up?: boolean;
}
