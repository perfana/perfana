'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  Top10TransactionItem,
  Top10TableSortField,
  Top10TableSortOrder,
  Top10TableDimension,
  TransactionStat,
} from '../types';
import {
  prepareTop10TransactionData,
  getTop10Transactions,
  sortTransactionData,
  formatNumber,
  formatPercentage,
} from '../utils';
import {
  Speed as SpeedIcon,
  TrendingUp as TrendingUpIcon,
  Error as ErrorIcon,
  NetworkCheck as NetworkCheckIcon,
} from '@mui/icons-material';
import React from 'react';

export interface UseTop10TableDataProps {
  testRunId: string;
  selectedScenarios?: string[];
}

export interface UseTop10TableDataReturn {
  loading: boolean;
  error: string | null;
  top10Data: Top10TransactionItem[];
  dimensions: Top10TableDimension[];
  sortFields: Record<number, Top10TableSortField>;
  sortOrders: Record<number, Top10TableSortOrder>;
  handleSort: (dimensionIndex: number, field: Top10TableSortField) => void;
  getSortedData: (
    data: Top10TransactionItem[],
    dimensionIndex: number,
    valueField: keyof Top10TransactionItem
  ) => Top10TransactionItem[];
  actionMenuAnchor: HTMLElement | null;
  actionMenuData: Top10TransactionItem | null;
  handleOpenActionMenu: (event: React.MouseEvent<HTMLElement>, item: Top10TransactionItem) => void;
  handleCloseActionMenu: () => void;
}

export function useTop10TableData({ testRunId, selectedScenarios = [] }: UseTop10TableDataProps): UseTop10TableDataReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionStat[]>([]);
  const [testDuration, setTestDuration] = useState<number>(1);
  const [sortFields, setSortFields] = useState<Record<number, Top10TableSortField>>({});
  const [sortOrders, setSortOrders] = useState<Record<number, Top10TableSortOrder>>({});
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [actionMenuData, setActionMenuData] = useState<Top10TransactionItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const testRunResponse = await authenticatedFetch(`/test-runs/${testRunId}`);
      if (!testRunResponse.ok) {
        throw new Error('Failed to fetch test run details');
      }
      const testRunData = await testRunResponse.json();
      const durationSeconds = testRunData.duration || 1;
      setTestDuration(durationSeconds);

      const transactionsResponse = await authenticatedFetch(
        `/test-runs/${testRunId}/transactions`
      );
      if (!transactionsResponse.ok) {
        throw new Error('Failed to fetch transactions');
      }
      const transactionsData = await transactionsResponse.json();
      setTransactions(transactionsData);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load data';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [testRunId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const allTop10Data = prepareTop10TransactionData(transactions, testDuration);
  const top10Data = selectedScenarios.length === 0
    ? allTop10Data
    : allTop10Data.filter((item) => {
        const label = item.scenarioName && item.scenarioName.length > 0
          ? item.scenarioName
          : 'No Scenario';
        return selectedScenarios.includes(label);
      });

  const dimensions: Top10TableDimension[] = [
    {
      title: 'Slowest Average Response Times',
      icon: React.createElement(SpeedIcon),
      data: getTop10Transactions(top10Data, (a, b) => b.avgResponseTime - a.avgResponseTime),
      valueField: 'avgResponseTime',
      valueFormatter: (val: number) => `${formatNumber(val)} ms`,
      color: '#ff9800',
    },
    {
      title: 'Highest Throughput',
      icon: React.createElement(NetworkCheckIcon),
      data: getTop10Transactions(top10Data, (a, b) => b.throughput - a.throughput),
      valueField: 'throughput',
      valueFormatter: (val: number) => `${formatNumber(val)}/s`,
      color: '#4caf50',
    },
    {
      title: 'Highest Performance Impact',
      icon: React.createElement(TrendingUpIcon),
      data: getTop10Transactions(top10Data, (a, b) => b.impact - a.impact),
      valueField: 'impact',
      valueFormatter: (val: number) => formatNumber(val),
      color: '#f44336',
      description: 'Performance Impact = Avg Response Time x Call Count. Higher values indicate transactions that consume more total time.',
    },
    {
      title: 'Highest Error Rate',
      icon: React.createElement(ErrorIcon),
      data: getTop10Transactions(top10Data, (a, b) => b.errorRate - a.errorRate),
      valueField: 'errorRate',
      valueFormatter: (val: number) => formatPercentage(val),
      color: '#e91e63',
      showErrorCount: true,
    },
  ];

  const handleSort = useCallback((dimensionIndex: number, field: Top10TableSortField) => {
    const currentOrder = sortOrders[dimensionIndex];
    const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';

    setSortFields(prev => ({ ...prev, [dimensionIndex]: field }));
    setSortOrders(prev => ({ ...prev, [dimensionIndex]: newOrder }));
  }, [sortOrders]);

  const getSortedData = useCallback((
    data: Top10TransactionItem[],
    dimensionIndex: number,
    valueField: keyof Top10TransactionItem
  ): Top10TransactionItem[] => {
    return sortTransactionData(data, sortFields[dimensionIndex], sortOrders[dimensionIndex], valueField);
  }, [sortFields, sortOrders]);

  const handleOpenActionMenu = useCallback((event: React.MouseEvent<HTMLElement>, item: Top10TransactionItem) => {
    event.stopPropagation();
    setActionMenuAnchor(event.currentTarget);
    setActionMenuData(item);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setActionMenuAnchor(null);
    setActionMenuData(null);
  }, []);

  return {
    loading,
    error,
    top10Data,
    dimensions,
    sortFields,
    sortOrders,
    handleSort,
    getSortedData,
    actionMenuAnchor,
    actionMenuData,
    handleOpenActionMenu,
    handleCloseActionMenu,
  };
}
