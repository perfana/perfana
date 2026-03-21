'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [aggregationSeconds, setAggregationSeconds] = useState(5);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('avg_response_time');

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
    setLoading(true);
    setError(null);

    try {
      const url = `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName)}/timeseries?aggregationSeconds=${aggregationSeconds}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch time-series data');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load time-series data';
      setError(errorMessage);
    } finally {
      setLoading(false);
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
    aggregationSeconds,
    selectedMetric,
    handleAggregationChange,
    handleMetricChange,
  };
}
