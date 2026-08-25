'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  Top10Item,
  Top10SortField,
  Top10SortOrder,
  Top10Dimension,
  TransactionStat,
  SamplerStat,
  SamplerWithTransaction,
} from '../types';
import { prepareTop10Data, getTop10, sortData, formatNumber, formatPercentage } from '../utils';
import {
  Speed as SpeedIcon,
  TrendingUp as TrendingUpIcon,
  Error as ErrorIcon,
  NetworkCheck as NetworkCheckIcon,
} from '@mui/icons-material';
import React from 'react';
import { formatImpactShare, sumImpact } from '@perfana/shared/utils';

export interface UseTop10DataProps {
  testRunId: string;
  selectedScenarios?: string[];
  excludeRampUp?: boolean;
  nameFilter?: string;
}

export interface UseTop10DataReturn {
  // Loading and error states
  loading: boolean;
  error: string | null;

  // Data
  top10Data: Top10Item[];
  dimensions: Top10Dimension[];

  // Sorting
  sortFields: Record<number, Top10SortField>;
  sortOrders: Record<number, Top10SortOrder>;
  handleSort: (dimensionIndex: number, field: Top10SortField) => void;
  getSortedData: (data: Top10Item[], dimensionIndex: number, valueField: keyof Top10Item) => Top10Item[];

  // Action menu
  actionMenuAnchor: HTMLElement | null;
  actionMenuData: Top10Item | null;
  handleOpenActionMenu: (event: React.MouseEvent<HTMLElement>, item: Top10Item) => void;
  handleCloseActionMenu: () => void;
}

export function useTop10Data({ testRunId, selectedScenarios = [], excludeRampUp = false, nameFilter = '' }: UseTop10DataProps): UseTop10DataReturn {
  // Loading and error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [samplers, setSamplers] = useState<SamplerWithTransaction[]>([]);
  const [testDuration, setTestDuration] = useState<number>(1);

  // Sorting states
  const [sortFields, setSortFields] = useState<Record<number, Top10SortField>>({});
  const [sortOrders, setSortOrders] = useState<Record<number, Top10SortOrder>>({});

  // Action menu state
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [actionMenuData, setActionMenuData] = useState<Top10Item | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch test run details for duration
      const testRunResponse = await authenticatedFetch(`/test-runs/${testRunId}`);
      if (!testRunResponse.ok) {
        throw new Error('Failed to fetch test run details');
      }
      const testRunData = await testRunResponse.json();
      const durationSeconds = testRunData.duration || 1;
      setTestDuration(durationSeconds);

      // Fetch all transactions
      const transactionsResponse = await authenticatedFetch(
        `/test-runs/${testRunId}/transactions?excludeRampUp=${excludeRampUp}`
      );
      if (!transactionsResponse.ok) {
        throw new Error('Failed to fetch transactions');
      }
      const transactionsData: TransactionStat[] = await transactionsResponse.json();

      // Fetch samplers for each transaction
      const allSamplers: SamplerWithTransaction[] = [];

      for (const transaction of transactionsData) {
        try {
          const samplesResponse = await authenticatedFetch(
            `/test-runs/${testRunId}/transactions/${encodeURIComponent(transaction.transaction_name)}/samples?excludeRampUp=${excludeRampUp}`
          );
          if (samplesResponse.ok) {
            const samplesData: SamplerStat[] = await samplesResponse.json();
            // Add transaction_name to each sampler
            samplesData.forEach(sampler => {
              allSamplers.push({
                ...sampler,
                transaction_name: transaction.transaction_name,
                scenario_name: transaction.scenario_name,
              });
            });
          }
        } catch {
          // Skip failed sampler fetches silently
        }
      }

      setSamplers(allSamplers);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load data';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [testRunId, excludeRampUp]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prepare data (filtered by scenario if any selected)
  const allTop10Data = prepareTop10Data(samplers, testDuration);
  const scenarioFiltered = selectedScenarios.length === 0
    ? allTop10Data
    : allTop10Data.filter((item) => {
        const label = item.scenarioName && item.scenarioName.length > 0
          ? item.scenarioName
          : 'No Scenario';
        return selectedScenarios.includes(label);
      });
  // Name filter applies before the top-10 slice; matches request name or URL (either can be displayed).
  const filter = nameFilter.trim().toLowerCase();
  const top10Data = filter
    ? scenarioFiltered.filter(
        (item) =>
          item.requestName.toLowerCase().includes(filter) ||
          item.url.toLowerCase().includes(filter),
      )
    : scenarioFiltered;

  // Denominator for the impact score: every row currently in view, not the ten
  // that make the list — a top-ten denominator would inflate all ten.
  //
  // "Currently in view" includes the scenario and name filters, so this is a share
  // of what you are looking at and it re-bases as you filter. That is deliberate
  // here and it is NOT the same denominator the report uses: a report has no
  // filter box, so it always scores against every row in the scope. Same run,
  // same transaction, different number on the two surfaces once a filter is on —
  // which is why the tooltip says "of the rows shown".
  const impactTotal = sumImpact(top10Data);

  // Build dimensions configuration
  const dimensions: Top10Dimension[] = [
    {
      title: 'Slowest Average Response Times',
      valueHeader: 'Avg response time',
      icon: React.createElement(SpeedIcon),
      data: getTop10(top10Data, (a, b) => b.avgResponseTime - a.avgResponseTime),
      valueField: 'avgResponseTime',
      valueFormatter: (val: number) => `${formatNumber(val)} ms`,
      color: '#ff9800',
    },
    {
      title: 'Highest Throughput',
      valueHeader: 'Throughput',
      icon: React.createElement(NetworkCheckIcon),
      data: getTop10(top10Data, (a, b) => b.throughput - a.throughput),
      valueField: 'throughput',
      valueFormatter: (val: number) => `${formatNumber(val)}/s`,
      color: '#4caf50',
    },
    {
      title: 'Performance Impact Ranking',
      valueHeader: 'Impact score',
      icon: React.createElement(TrendingUpIcon),
      data: getTop10(top10Data, (a, b) => b.impact - a.impact),
      valueField: 'impact',
      // Share of the run's total time rather than the raw avg x count product:
      // the product is a number in the millions that means nothing on its own and
      // cannot be compared between runs. The ranking is identical either way.
      valueFormatter: (val: number) => formatImpactShare(val, impactTotal),
      color: '#f44336',
      description: `Impact score = this request's share of the total time spent by the rows shown (avg response time × call count), on a 0-100 scale. Ranks identically to the raw product, but is readable and comparable between runs.`,
    },
    {
      title: 'Highest Error Rate',
      valueHeader: 'Error rate',
      icon: React.createElement(ErrorIcon),
      data: getTop10(top10Data, (a, b) => b.errorRate - a.errorRate),
      valueField: 'errorRate',
      valueFormatter: (val: number) => formatPercentage(val),
      color: '#e91e63',
      showErrorCount: true,
    },
  ];

  // Handle sort
  const handleSort = useCallback((dimensionIndex: number, field: Top10SortField) => {
    const currentOrder = sortOrders[dimensionIndex];
    const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';

    setSortFields(prev => ({ ...prev, [dimensionIndex]: field }));
    setSortOrders(prev => ({ ...prev, [dimensionIndex]: newOrder }));
  }, [sortOrders]);

  // Get sorted data for a dimension
  const getSortedData = useCallback((
    data: Top10Item[],
    dimensionIndex: number,
    valueField: keyof Top10Item
  ): Top10Item[] => {
    return sortData(data, sortFields[dimensionIndex], sortOrders[dimensionIndex], valueField);
  }, [sortFields, sortOrders]);

  // Action menu handlers
  const handleOpenActionMenu = useCallback((event: React.MouseEvent<HTMLElement>, item: Top10Item) => {
    event.stopPropagation();
    setActionMenuAnchor(event.currentTarget);
    setActionMenuData(item);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setActionMenuAnchor(null);
    setActionMenuData(null);
  }, []);

  return {
    // Loading and error states
    loading,
    error,

    // Data
    top10Data,
    dimensions,

    // Sorting
    sortFields,
    sortOrders,
    handleSort,
    getSortedData,

    // Action menu
    actionMenuAnchor,
    actionMenuData,
    handleOpenActionMenu,
    handleCloseActionMenu,
  };
}
