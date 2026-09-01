'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SelectChangeEvent } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import type { TimeSeriesResponse, MetricType } from '../types';

interface UseTransactionGraphDataProps {
  open: boolean;
  testRunId: string;
  transactionName: string;
  onClose: () => void;
}

interface UseTransactionGraphDataReturn {
  loading: boolean;
  data: TimeSeriesResponse | null;
  error: string | null;
  aggregationSeconds: number;
  selectedMetric: MetricType;
  handleAggregationChange: (event: SelectChangeEvent<number>) => void;
  handleMetricChange: (event: SelectChangeEvent<string>) => void;
}

export function useTransactionGraphData({
  open,
  testRunId,
  transactionName,
  onClose,
}: UseTransactionGraphDataProps): UseTransactionGraphDataReturn {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TimeSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = let the server pick from the run duration. A 3 h run at the 5 s floor
  // is 2160 points per series, well past what the chart can show.
  const [aggregationSeconds, setAggregationSeconds] = useState<number | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('avg_response_time');
  // Guards against an out-of-order response. The bucket choices now span 5s..300s,
  // so a 300s response (tiny) routinely lands before a 5s one (60x larger) issued
  // first — last-write-wins on ARRIVAL would pair the 5s data with a 300s divisor
  // and render throughput 60x too low, permanently.
  const requestSeq = useRef(0);

  // Keyboard shortcut for Escape key
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (open) {
      window.addEventListener('keydown', handleKeyPress);
      return () => window.removeEventListener('keydown', handleKeyPress);
    }
  }, [open, onClose]);

  const fetchTimeSeriesData = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);

    try {
      const url =
        `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName)}/timeseries` +
        (aggregationSeconds === null ? '' : `?aggregationSeconds=${aggregationSeconds}`);
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch time-series data');
      }

      const result: TimeSeriesResponse = await response.json();
      if (seq !== requestSeq.current) return;
      setData(result);
      // Deliberately NOT stored in `aggregationSeconds`: that state drives the
      // fetch, so adopting into it would trigger a second full round trip for
      // the same chart. The effective value is derived from `data` below.

    } catch (err) {
      if (seq !== requestSeq.current) return;
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load time-series data';
      setError(errorMessage);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [testRunId, transactionName, aggregationSeconds]);

  useEffect(() => {
    if (open && testRunId && transactionName) {
      fetchTimeSeriesData();
    }
  }, [open, testRunId, transactionName, fetchTimeSeriesData]);

  const handleAggregationChange = useCallback((event: SelectChangeEvent<number>) => {
    setAggregationSeconds(event.target.value as number);
  }, []);

  const handleMetricChange = useCallback((event: SelectChangeEvent<string>) => {
    setSelectedMetric(event.target.value as MetricType);
  }, []);

  return {
    loading,
    data,
    error,
    // The user's explicit pick wins; otherwise show what the server chose.
    // Before the first response there is nothing to divide by yet, and the
    // chart is not rendered in that state.
    aggregationSeconds: aggregationSeconds ?? data?.aggregation_seconds ?? 5,
    selectedMetric,
    handleAggregationChange,
    handleMetricChange,
  };
}
