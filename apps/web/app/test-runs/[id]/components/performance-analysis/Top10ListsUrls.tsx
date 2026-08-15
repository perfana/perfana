'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Chip,
  Divider,
} from '@mui/material';
import {
  Speed as SpeedIcon,
  TrendingUp as TrendingUpIcon,
  Error as ErrorIcon,
  NetworkCheck as NetworkCheckIcon,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { Top10Filter } from './components';
import { ClippedUrl } from '@/components/ui/clipped-url';

interface TransactionStat {
  transaction_name: string;
  scenario_name?: string;
  avg_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  ranking: number;
  apdex_score: number;
  active_threshold: number;
}

interface SamplerStat {
  sampler_name: string;
  scenario_name?: string;
  avg_response_time: number;
  min_response_time: number;
  max_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  avg_latency: number;
  avg_connect_time: number;
  total_request_size: number;
  total_response_size: number;
  apdex_score: number;
  active_threshold: number;
  url_hash: string | null;
  url_pattern: string | null;
}

interface Top10Item {
  url: string;
  avgResponseTime: number;
  impact: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number;
}

type SortField = 'url' | 'value';
type SortOrder = 'asc' | 'desc';

interface Top10ListsUrlsProps {
  testRunId: string;
  selectedScenarios?: string[];
  excludeRampUp?: boolean;
}

export default function Top10ListsUrls({ testRunId, selectedScenarios = [], excludeRampUp = false }: Top10ListsUrlsProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samplers, setSamplers] = useState<Array<SamplerStat & { transaction_name: string }>>([]);
  const [testDuration, setTestDuration] = useState<number>(1);
  const [sortFields, setSortFields] = useState<Record<number, SortField>>({});
  const [sortOrders, setSortOrders] = useState<Record<number, SortOrder>>({});
  const [nameFilter, setNameFilter] = useState('');

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRunId, excludeRampUp]);

  const fetchData = async () => {
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
      const allSamplers: Array<SamplerStat & { transaction_name: string }> = [];

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
        } catch (err) {
          console.warn(`Failed to fetch samples for transaction ${transaction.transaction_name}`, err);
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
  };

  const formatNumber = (num: number): string => {
    if (num === 0) return '0';
    if (num < 10) return num.toFixed(2);
    if (num < 100) return num.toFixed(1);
    return Math.round(num).toLocaleString();
  };

  const formatPercentage = (num: number): string => {
    return `${num.toFixed(2)}%`;
  };

  const prepareTop10Data = (): Top10Item[] => {
    // Aggregate data by URL pattern
    const urlMap = new Map<string, {
      totalResponseTime: number;
      totalCount: number;
      passedCount: number;
      failedCount: number;
    }>();

    const filteredSamplers = selectedScenarios.length === 0
      ? samplers
      : samplers.filter(s => {
          const label = s.scenario_name && s.scenario_name.length > 0
            ? s.scenario_name
            : 'No Scenario';
          return selectedScenarios.includes(label);
        });

    filteredSamplers.forEach(sampler => {
      const url = sampler.url_pattern || sampler.sampler_name || 'Unknown';

      if (!urlMap.has(url)) {
        urlMap.set(url, {
          totalResponseTime: 0,
          totalCount: 0,
          passedCount: 0,
          failedCount: 0,
        });
      }

      const urlData = urlMap.get(url)!;
      urlData.totalResponseTime += sampler.avg_response_time * sampler.total_count;
      urlData.totalCount += sampler.total_count;
      urlData.passedCount += sampler.passed_count;
      urlData.failedCount += sampler.failed_count;
    });

    // Convert map to array of Top10Item
    const result: Top10Item[] = [];
    urlMap.forEach((data, url) => {
      const avgResponseTime = data.totalCount > 0
        ? data.totalResponseTime / data.totalCount
        : 0;
      const errorRate = data.totalCount > 0
        ? (data.failedCount / data.totalCount) * 100
        : 0;
      const throughput = testDuration > 0
        ? data.totalCount / testDuration
        : 0;
      const impact = avgResponseTime * data.totalCount;

      result.push({
        url,
        avgResponseTime,
        impact,
        callCount: data.totalCount,
        errorCount: data.failedCount,
        errorRate,
        throughput,
      });
    });

    return result;
  };

  const handleSort = (dimensionIndex: number, field: SortField) => {
    const currentOrder = sortOrders[dimensionIndex];
    const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';

    setSortFields({ ...sortFields, [dimensionIndex]: field });
    setSortOrders({ ...sortOrders, [dimensionIndex]: newOrder });
  };

  const sortData = (data: Top10Item[], dimensionIndex: number, valueField: keyof Top10Item): Top10Item[] => {
    const sortField = sortFields[dimensionIndex];
    const sortOrder = sortOrders[dimensionIndex];

    if (!sortField) return data;

    return [...data].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortField === 'value') {
        aVal = a[valueField] as number;
        bVal = b[valueField] as number;
      } else {
        aVal = a[sortField] as string;
        bVal = b[sortField] as string;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      } else {
        return sortOrder === 'asc'
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      }
    });
  };

  const getTop10 = (
    data: Top10Item[],
    sortFn: (a: Top10Item, b: Top10Item) => number
  ): Top10Item[] => {
    return [...data].sort(sortFn).slice(0, 10);
  };

  // Name filter applies before the top-10 slice so search narrows the pool, then ranks.
  const filter = nameFilter.trim().toLowerCase();
  const top10Data = filter
    ? prepareTop10Data().filter((item) => item.url.toLowerCase().includes(filter))
    : prepareTop10Data();
  const hasMissingUrlPatterns = samplers.some((s) => s.url_pattern == null);

  /** One "Top 10 by ..." table. description/showErrorCount vary per entry. */
  type Top10Dimension = {
    title: string;
    icon: React.ReactNode;
    data: Top10Item[];
    valueField: keyof Top10Item;
    valueFormatter: (val: number) => string;
    color: string;
    description?: string;
    showErrorCount?: boolean;
  };

  const dimensions: Top10Dimension[] = [
    {
      title: 'Slowest Average Response Times',
      icon: <SpeedIcon />,
      data: getTop10(top10Data, (a, b) => b.avgResponseTime - a.avgResponseTime),
      valueField: 'avgResponseTime' as keyof Top10Item,
      valueFormatter: (val: number) => `${formatNumber(val)} ms`,
      color: '#ff9800',
    },
    {
      title: 'Highest Throughput',
      icon: <NetworkCheckIcon />,
      data: getTop10(top10Data, (a, b) => b.throughput - a.throughput),
      valueField: 'throughput' as keyof Top10Item,
      valueFormatter: (val: number) => `${formatNumber(val)}/s`,
      color: '#4caf50',
    },
    {
      title: 'Highest Performance Impact',
      icon: <TrendingUpIcon />,
      data: getTop10(top10Data, (a, b) => b.impact - a.impact),
      valueField: 'impact' as keyof Top10Item,
      valueFormatter: (val: number) => formatNumber(val),
      color: '#f44336',
      description: 'Performance Impact = Avg Response Time × Call Count. Higher values indicate URLs that consume more total time.',
    },
    {
      title: 'Highest Error Rate',
      icon: <ErrorIcon />,
      data: getTop10(top10Data, (a, b) => b.errorRate - a.errorRate),
      valueField: 'errorRate' as keyof Top10Item,
      valueFormatter: (val: number) => formatPercentage(val),
      color: '#e91e63',
      showErrorCount: true,
    },
  ];

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ my: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 2 }}>
        <Top10Filter value={nameFilter} onChange={setNameFilter} placeholder="Filter URLs..." />
      </Box>
      {hasMissingUrlPatterns && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="top10-urls-pending-hint">
          Some entries show the sampler name in place of the URL pattern. URL patterns populate once the test completes and the post-test rollup runs.
        </Alert>
      )}
      {/* Dimensions */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {dimensions.map((dimension, index) => (
          <Paper
            key={index}
            elevation={2}
            sx={{
              p: 3,
              borderLeft: `4px solid ${dimension.color}`,
              backgroundColor: 'background.paper',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Box sx={{ color: dimension.color, display: 'flex', alignItems: 'center' }}>
                {dimension.icon}
              </Box>
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, fontSize: '1rem' }}
                title={dimension.description}
              >
                {dimension.title}
              </Typography>
            </Box>

            <Divider sx={{ mb: 2 }} />

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, width: '5%' }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700, width: '70%' }}>
                      <TableSortLabel
                        active={sortFields[index] === 'url'}
                        direction={sortOrders[index] || 'asc'}
                        onClick={() => handleSort(index, 'url')}
                      >
                        URL
                      </TableSortLabel>
                    </TableCell>
                    {dimension.showErrorCount && (
                      <TableCell sx={{ fontWeight: 700, width: '10%', textAlign: 'right' }}>
                        Errors
                      </TableCell>
                    )}
                    <TableCell sx={{ fontWeight: 700, width: '25%', textAlign: 'right' }}>
                      <TableSortLabel
                        active={sortFields[index] === 'value'}
                        direction={sortOrders[index] || 'asc'}
                        onClick={() => handleSort(index, 'value')}
                        sx={{
                          flexDirection: 'row-reverse',
                          '& .MuiTableSortLabel-icon': {
                            marginLeft: 0,
                            marginRight: '4px',
                          },
                        }}
                      >
                        Value
                      </TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(() => {
                    const sortedData = sortData(dimension.data, index, dimension.valueField);
                    return sortedData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={dimension.showErrorCount ? 4 : 3} sx={{ textAlign: 'center', py: 3 }}>
                          <Typography variant="body2" color="text.secondary">
                            No data available
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedData.map((item, idx) => (
                        <TableRow
                          key={idx}
                          sx={{
                            '&:hover': {
                              backgroundColor: 'action.hover',
                            },
                          }}
                        >
                          <TableCell>
                            <Chip
                              label={idx + 1}
                              size="small"
                              sx={{
                                fontWeight: 700,
                                backgroundColor:
                                  idx === 0
                                    ? '#ffd700'
                                    : idx === 1
                                    ? '#c0c0c0'
                                    : idx === 2
                                    ? '#cd7f32'
                                    : 'default',
                                color: idx < 3 ? '#000' : 'inherit',
                              }}
                            />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 0 }}>
                            <ClippedUrl url={item.url} variant="body2" color="text.primary" sx={{ fontSize: '0.85rem' }} />
                          </TableCell>
                          {dimension.showErrorCount && (
                            <TableCell
                              sx={{
                                textAlign: 'right',
                                fontFamily: 'monospace',
                                fontWeight: 600,
                              }}
                            >
                              {item.errorCount.toLocaleString()}
                            </TableCell>
                          )}
                          <TableCell
                            sx={{
                              textAlign: 'right',
                              fontWeight: 600,
                              color: dimension.color,
                              fontFamily: 'monospace',
                            }}
                          >
                            {dimension.valueFormatter(item[dimension.valueField] as number)}
                          </TableCell>
                        </TableRow>
                      ))
                    );
                  })()}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
