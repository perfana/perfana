'use client';

import React from 'react';
import { Box } from '@mui/material';
import { isCheckResultStale } from '../utils/slo-formatters';
import { sortMetricTargets } from '../utils/metric-series-table-utils';
import {
  MetricSeriesTableHeader,
  MetricSeriesTableRow,
  MetricSeriesEmptyState,
} from './metric-series-table';
import type { MetricSeriesTableProps } from '../types';

// Re-export types for backward compatibility
export type { SortConfig, MetricTarget, MetricSeriesTableProps } from '../types';

export default function MetricSeriesTable({
  result,
  resultKey,
  sortConfig,
  onSort,
  selectedTarget,
  onSelectTarget,
  benchmarks,
}: MetricSeriesTableProps) {
  // Find benchmark to check staleness
  const benchmark = benchmarks.find(b => b.id === result.benchmark_id);
  const isStale = isCheckResultStale(result, benchmark);

  // Sort targets using extracted utility
  const sortedTargets = sortMetricTargets(result.targets, sortConfig, resultKey);

  return (
    <Box sx={{ mt: 2 }}>
      {/* Table Header */}
      <MetricSeriesTableHeader
        resultKey={resultKey}
        sortConfig={sortConfig}
        onSort={onSort}
      />

      {/* Table Rows */}
      {sortedTargets.length > 0 ? (
        sortedTargets.map((target, sortedIndex) => {
          const isSelected = selectedTarget.get(resultKey) === target.target;

          return (
            <MetricSeriesTableRow
              key={`${target.target}-${sortedIndex}`}
              target={target}
              sortedIndex={sortedIndex}
              totalCount={sortedTargets.length}
              isSelected={isSelected}
              result={result}
              isStale={isStale}
              onClick={() => {
                if (isSelected) {
                  onSelectTarget(resultKey, undefined);
                } else {
                  onSelectTarget(resultKey, target.target);
                }
              }}
            />
          );
        })
      ) : (
        <MetricSeriesEmptyState />
      )}
    </Box>
  );
}
