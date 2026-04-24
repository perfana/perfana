'use client';

import React from 'react';
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

  if (!result.targets || result.targets.length === 0) {
    return null;
  }

  // Sort and group targets
  const sortSettings = sortConfig.get(resultKey);
  const sortedTargets = sortApdexTargets(result.targets, sortSettings);
  const groupedByScenario = groupTargetsByScenario(sortedTargets);

  const defaultThreshold = result.requirement?.threshold_ms || 500;
  const totalTargets = result.targets.length;
  const excludeRampUp = result.exclude_ramp_up_time !== false;
  let globalIdx = 0;

  return (
    <Box sx={{ mb: 3 }}>
      {Array.from(groupedByScenario.entries()).map(([scenario, targets], groupIdx) => {
        const failedCount = targets.filter((t) => t.meets_requirement === false).length;

        return (
          <Box key={scenario} sx={{ mb: groupIdx < groupedByScenario.size - 1 ? 3 : 0 }}>
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
                    <Collapse in={isExpanded}>
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
    </Box>
  );
}
