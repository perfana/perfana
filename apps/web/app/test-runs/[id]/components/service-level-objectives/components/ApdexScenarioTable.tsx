'use client';

import React, { useRef } from 'react';
import { useScrollParentVirtualizer, VIRTUALIZE_MIN_ROWS } from '@/hooks/useScrollParentVirtualizer';
import { Box, Collapse, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';

// Types
import type {
  ApdexScenarioTableProps,
  ApdexScenarioSortConfig,
  TransactionSample,
  ApdexTarget,
} from '../types';

// Utils
import { sortApdexTargets, groupTargetsByScenario } from '../utils/apdex-utils';

// Components
import {
  ScenarioHeader,
  SortableTableHeader,
  ApdexTransactionRow,
  ApdexExpandedContent,
} from './apdex-scenario';

// Re-export types for backwards compatibility
export type { ApdexScenarioSortConfig as SortConfig, TransactionSample, ApdexTarget };
export type { ApdexScenarioTableProps };

export default function ApdexScenarioTable({
  result,
  resultKey,
  sortConfig,
  onSort,
  expandedTransactions,
  onToggleTransaction,
  transactionSamples,
  loadingTransactionSamples,
  transactionSamplesError,
  onOpenApdexActionMenu,
  onOpenRequestActionMenu,
  hasDistributedTracing = false,
  hasDynatrace = false,
}: ApdexScenarioTableProps) {
  const theme = useTheme();

  // Sort and group targets. Computed before the empty-result bail-out below,
  // because the virtualiser hooks must run on every render - React forbids a
  // hook behind a conditional return.
  const sortSettings = sortConfig.get(resultKey);
  const sortedTargets = sortApdexTargets(result.targets ?? [], sortSettings);
  const groupedByScenario = groupTargetsByScenario(sortedTargets);

  const defaultThreshold = result.requirement?.threshold_ms || 500;
  const totalTargets = result.targets?.length ?? 0;
  const excludeRampUp = result.exclude_ramp_up_time !== false;

  // Virtualised per SCENARIO GROUP, not per row. The rows are already split
  // across groups (this run: 292 transactions over 17 scenarios, ~17 each), so
  // virtualising inside a group would buy nothing - the cost is that all 17
  // group tables mount at once. Only the groups near the viewport render.
  //
  // Group heights vary a lot (a scenario may hold 1 transaction or 100), so the
  // virtualiser measures them; estimateSize is only the first guess.
  const groups = Array.from(groupedByScenario.entries());
  const rowOffsets: number[] = [];
  let runningIdx = 0;
  for (const [, targets] of groups) {
    rowOffsets.push(runningIdx);
    runningIdx += targets.length;
  }

  const parentRef = useRef<HTMLDivElement>(null);
  const { rows: virtualGroups, padTop, padBottom } = useScrollParentVirtualizer({
    parentRef,
    count: groups.length,
    estimateSize: 420,
    overscan: 2,
    // Gate on total transactions, not group count. 292 rows spread over 17
    // groups is exactly the case that needs virtualising, and a group-count
    // threshold would switch it off.
    enabled: totalTargets >= VIRTUALIZE_MIN_ROWS,
  });

  if (!result.targets || result.targets.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mb: 3 }} ref={parentRef}>
      {padTop > 0 && <Box sx={{ height: `${padTop}px` }} />}
      {virtualGroups.map((virtualGroup) => {
        const entry = groups[virtualGroup.index];
        if (!entry) return null;
        const [scenario, targets] = entry;
        const groupIdx = virtualGroup.index;
        // Row indices must stay stable across which groups happen to be mounted,
        // so derive them from the group's precomputed offset instead of a counter
        // that only advances for rendered groups. transactionKey feeds the
        // expanded-transaction set and the fetched-samples map; a shifting index
        // would reopen the wrong row.
        let globalIdx = rowOffsets[groupIdx] ?? 0;
        const failedCount = targets.filter((t) => t.meets_requirement === false).length;

        return (
          <Box
            key={scenario}
            ref={virtualGroup.measureRef}
            data-index={virtualGroup.index}
            sx={{ mb: groupIdx < groups.length - 1 ? 3 : 0 }}
          >
            {/* Scenario Title with Stats */}
            <ScenarioHeader
              scenario={scenario}
              transactionCount={targets.length}
              failedCount={failedCount}
            />

            {/* Scenario Table Container */}
            <Box sx={{
              maxHeight: '800px',
              overflow: 'auto',
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.15),
              borderRadius: '8px',
            }}>
              {/* Sticky Table Header */}
              <SortableTableHeader
                resultKey={resultKey}
                sortConfig={sortConfig}
                onSort={onSort}
              />

              {/* Transaction Rows */}
              {targets.map((target, idx) => {
                const currentGlobalIdx = globalIdx++;
                const isLastRow = currentGlobalIdx === totalTargets - 1;
                const transactionKey = `${resultKey}-${target.transaction_name || target.target}-${currentGlobalIdx}`;
                const isExpanded = expandedTransactions.has(transactionKey);
                const transactionName = target.transaction_name || target.target || `Transaction ${currentGlobalIdx + 1}`;

                return (
                  <Box key={transactionKey}>
                    {/* Main Row */}
                    <ApdexTransactionRow
                      target={target}
                      transactionKey={transactionKey}
                      isExpanded={isExpanded}
                      isLastRow={isLastRow}
                      isEvenRow={idx % 2 === 0}
                      defaultThreshold={defaultThreshold}
                      scenario={target.scenario_name || scenario}
                      onToggle={() => onToggleTransaction(transactionKey, transactionName, excludeRampUp)}
                      onOpenActionMenu={(e) => onOpenApdexActionMenu(
                        e,
                        transactionName,
                        target.scenario_name || scenario,
                        target.threshold_ms || defaultThreshold
                      )}
                    />

                    {/* Expanded Content - S/T/F Breakdown */}
                    {/* unmountOnExit: one of these exists per transaction, so on a
                        261-transaction Apdex SLO this is 261 breakdown tables built
                        and held in the DOM for rows that are all closed. Samples live
                        in the parent's transactionSamples map, so a re-expand still
                        shows what was already fetched. */}
                    <Collapse in={isExpanded} unmountOnExit>
                      <ApdexExpandedContent
                        target={target}
                        transactionKey={transactionKey}
                        isLastRow={isLastRow}
                        scenario={target.scenario_name || scenario}
                        transactionSamples={transactionSamples[transactionKey] || []}
                        isLoading={loadingTransactionSamples[transactionKey] || false}
                        error={transactionSamplesError[transactionKey]}
                        hasDistributedTracing={hasDistributedTracing}
                        hasDynatrace={hasDynatrace}
                        excludeRampUp={excludeRampUp}
                        onOpenRequestActionMenu={onOpenRequestActionMenu}
                      />
                    </Collapse>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      })}
      {padBottom > 0 && <Box sx={{ height: `${padBottom}px` }} />}
    </Box>
  );
}
