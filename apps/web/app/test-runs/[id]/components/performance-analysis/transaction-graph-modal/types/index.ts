/**
 * Type definitions for TransactionGraphModal component
 */

export interface TimeSeriesDataPoint {
  time_bucket: string;
  avg_response_time: number | null;
  median_response_time: number | null;
  min_response_time: number | null;
  max_response_time: number | null;
  p90_response_time: number | null;
  p95_response_time: number | null;
  p99_response_time: number | null;
  total_count: number;
  passed_count: number;
  failed_count: number;
}

export interface TimeSeriesResponse {
  transaction_data: TimeSeriesDataPoint[];
  sampler_data: Record<string, TimeSeriesDataPoint[]>;
  /** Bucket size the server actually used. Throughput traces divide by it. */
  aggregation_seconds: number;
}

export interface TransactionGraphModalProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  transactionName: string;
  showToast: (message: string) => void;
  events?: import('@/lib/events').PerfanaEvent[];
}

export type MetricType =
  | 'avg_response_time'
  | 'median_response_time'
  | 'p90_response_time'
  | 'p95_response_time'
  | 'p99_response_time';

export interface MetricOption {
  value: MetricType;
  label: string;
}

export interface AggregationOption {
  value: number;
  label: string;
}

export interface SamplerColor {
  fill: string;
  border: string;
}
