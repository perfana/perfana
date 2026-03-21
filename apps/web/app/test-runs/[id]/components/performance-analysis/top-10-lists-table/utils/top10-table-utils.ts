import {
  Top10TransactionItem,
  Top10TableSortField,
  Top10TableSortOrder,
  TransactionStat,
} from '../types';

/**
 * Format a number with appropriate decimal places based on magnitude
 */
export const formatNumber = (num: number): string => {
  if (num === 0) return '0';
  if (num < 10) return num.toFixed(2);
  if (num < 100) return num.toFixed(1);
  return Math.round(num).toLocaleString();
};

/**
 * Format a number as a percentage with 2 decimal places
 */
export const formatPercentage = (num: number): string => {
  return `${num.toFixed(2)}%`;
};

/**
 * Prepare Top10TransactionItem data from transaction statistics
 */
export const prepareTop10TransactionData = (
  transactions: TransactionStat[],
  testDuration: number
): Top10TransactionItem[] => {
  return transactions.map(item => {
    const scenarioName = item.scenario_name || '';
    const transactionName = item.transaction_name;

    const avgResponseTime = item.avg_response_time;
    const callCount = item.total_count;
    const errorCount = item.failed_count;
    const errorRate = item.total_count > 0
      ? (item.failed_count / item.total_count) * 100
      : 0;
    const throughput = testDuration > 0
      ? callCount / testDuration
      : 0;
    const impact = avgResponseTime * callCount;

    return {
      scenarioName,
      transactionName,
      avgResponseTime,
      impact,
      callCount,
      errorCount,
      errorRate,
      throughput,
    };
  });
};

/**
 * Sort Top10TransactionItem data based on sort field and order
 */
export const sortTransactionData = (
  data: Top10TransactionItem[],
  sortField: Top10TableSortField | undefined,
  sortOrder: Top10TableSortOrder | undefined,
  valueField: keyof Top10TransactionItem
): Top10TransactionItem[] => {
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

/**
 * Get top 10 items from data based on sorting function
 */
export const getTop10Transactions = (
  data: Top10TransactionItem[],
  sortFn: (a: Top10TransactionItem, b: Top10TransactionItem) => number
): Top10TransactionItem[] => {
  return [...data].sort(sortFn).slice(0, 10);
};

/**
 * Get ranking chip color based on position
 */
export const getRankingChipStyles = (index: number): { backgroundColor: string; color: string } => {
  if (index === 0) return { backgroundColor: '#ffd700', color: '#000' };
  if (index === 1) return { backgroundColor: '#c0c0c0', color: '#000' };
  if (index === 2) return { backgroundColor: '#cd7f32', color: '#000' };
  return { backgroundColor: 'default', color: 'inherit' };
};
