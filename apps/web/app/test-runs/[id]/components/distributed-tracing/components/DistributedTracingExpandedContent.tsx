'use client';

import React, { useRef } from 'react';
import {
  Box,
  Alert,
  Tabs,
  Tab,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Timeline,
  CompareArrows,
} from '@mui/icons-material';

import { DistributedTracingCardProps, ServiceNameItem } from '../types';
import { TracingService } from '@/lib/distributed-tracing';
import { RequestFilteringSection } from './RequestFilteringSection';
import { VisualiseTab } from './VisualiseTab';
import TracesDiffTab, { type DiffTabReport } from '../TracesDiffTab';
import type { CommentItemCounts } from '@/lib/test-run-comments';
import ItemCommentHeader, { TabCommentMark } from '../../comments/ItemCommentHeader';
import { useDiffCommentView } from '../../comments/useDiffCommentView';
import { summarizeTraceAnalysis } from '../trace-analysis/utils/trace-formatters';
import {
  parseTracingItemKey,
  tracingItemKey,
  tracingItemLabel,
  type TracingCommentFilters,
} from '@perfana/shared/constants/comment-cards';

// Comment anchors live in shared so the API can build the same keys for an agent.
export type TracingFilters = TracingCommentFilters;
export { tracingItemKey, parseTracingItemKey };

const isServiceKey = (s: ServiceNameItem) => (key: string) => {
  const p = parseTracingItemKey(key);
  return !!p && p.serviceId === s.tracingServiceId && p.serviceName === s.serviceName;
};

interface DistributedTracingExpandedContentProps {
  testRun: DistributedTracingCardProps['testRun'];
  commentCounts: CommentItemCounts;
  // Service name tabs
  allServiceNames: ServiceNameItem[];
  activeServiceNameTab: number;
  onServiceNameTabChange: (event: React.SyntheticEvent, newValue: number) => void;
  currentServiceNameItem: ServiceNameItem | null;
  currentService: TracingService | null;
  // Error state
  error: string | null;
  // Filter controls
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedScenario: string | null;
  selectedTransaction: string | null;
  selectedSampler: string | null;
  minDuration: string;
  maxDuration: string;
  onScenarioChange: (scenario: string | null) => void;
  onTransactionChange: (transaction: string | null) => void;
  onSamplerChange: (sampler: string | null) => void;
  onMinDurationChange: (value: string) => void;
  onMaxDurationChange: (value: string) => void;
  // View mode
  viewModeTab: number;
  onViewModeTabChange: (event: React.SyntheticEvent, newValue: number) => void;
  isTracesDiffEnabled: boolean;
  // Visualise tab
  tracingUrl: string | null;
  loading: boolean;
  iframeLoading: boolean;
  onOpenExternal: () => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
}

export function DistributedTracingExpandedContent({
  testRun,
  commentCounts,
  allServiceNames,
  activeServiceNameTab,
  onServiceNameTabChange,
  currentServiceNameItem,
  currentService,
  error,
  scenarios,
  transactions,
  samplers,
  selectedScenario,
  selectedTransaction,
  selectedSampler,
  minDuration,
  maxDuration,
  onScenarioChange,
  onTransactionChange,
  onSamplerChange,
  onMinDurationChange,
  onMaxDurationChange,
  viewModeTab,
  onViewModeTabChange,
  isTracesDiffEnabled,
  tracingUrl,
  loading,
  iframeLoading,
  onOpenExternal,
  onIframeLoad,
  onIframeError,
}: DistributedTracingExpandedContentProps) {
  const filters: TracingFilters = { scenario: selectedScenario, transaction: selectedTransaction, sampler: selectedSampler };
  const diffState = useRef<DiffTabReport | null>(null);
  useDiffCommentView('distributed-tracing', () => ({
    open: viewModeTab === 1,
    baselineTestRunId: diffState.current?.baselineTestRunId,
    resultSummary: diffState.current?.result ? summarizeTraceAnalysis(diffState.current.result, diffState.current.resultFor) : null,
  }));
  return (
    <Box>
      {/* Service name tabs (if multiple service names) */}
      {allServiceNames.length > 1 && (
        <Tabs
          value={activeServiceNameTab}
          onChange={onServiceNameTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          {allServiceNames.map((item) => (
            <Tab
              key={`${item.tracingServiceId}-${item.serviceName}`}
              label={<span>{`${item.serviceName} (${item.tracingUi.toUpperCase()})`}<TabCommentMark counts={commentCounts} itemKey={isServiceKey(item)} /></span>}
              sx={{ fontSize: '0.875rem', minWidth: 140 }}
            />
          ))}
        </Tabs>
      )}

      {currentServiceNameItem && (
        <ItemCommentHeader
          card="distributed-tracing"
          itemKey={tracingItemKey(currentServiceNameItem, filters)}
          itemLabel={tracingItemLabel(currentServiceNameItem, filters)}
          title={currentServiceNameItem.serviceName}
          counts={commentCounts}
        >
          {(filters.scenario || filters.transaction) && (
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {[filters.scenario, filters.transaction, filters.sampler].filter(Boolean).join(' / ')}
            </Typography>
          )}
          <TabCommentMark counts={commentCounts} itemKey={(k) => isServiceKey(currentServiceNameItem)(k) && k !== tracingItemKey(currentServiceNameItem, filters)} />
        </ItemCommentHeader>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Request Filtering Section */}
      <RequestFilteringSection
        scenarios={scenarios}
        transactions={transactions}
        samplers={samplers}
        selectedScenario={selectedScenario}
        selectedTransaction={selectedTransaction}
        selectedSampler={selectedSampler}
        minDuration={minDuration}
        maxDuration={maxDuration}
        onScenarioChange={onScenarioChange}
        onTransactionChange={onTransactionChange}
        onSamplerChange={onSamplerChange}
        onMinDurationChange={onMinDurationChange}
        onMaxDurationChange={onMaxDurationChange}
      />

      {/* View Mode Tabs (Visualise / Traces Diff) */}
      <Tabs
        value={viewModeTab}
        onChange={onViewModeTabChange}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Visualise" icon={<Timeline sx={{ fontSize: 18 }} />} iconPosition="start" />
        <Tab
          label={
            <Tooltip
              title={
                isTracesDiffEnabled
                  ? 'Compare traces with a baseline test run'
                  : 'Select a Scenario and Transaction to enable trace comparison'
              }
              placement="top"
            >
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <CompareArrows sx={{ fontSize: 18 }} />
                Traces Diff
              </Box>
            </Tooltip>
          }
          disabled={!isTracesDiffEnabled}
        />
      </Tabs>

      {/* Visualise Tab Content */}
      {viewModeTab === 0 && (
        <VisualiseTab
          tracingUrl={tracingUrl}
          loading={loading}
          iframeLoading={iframeLoading}
          iframeAllowed={currentService?.tracingInstance?.tracingIframeAllowed ?? false}
          tracingUi={currentService?.tracingInstance?.tracingUi}
          onOpenExternal={onOpenExternal}
          onIframeLoad={onIframeLoad}
          onIframeError={onIframeError}
        />
      )}

      {/* Traces Diff Tab Content */}
      {viewModeTab === 1 && currentServiceNameItem && currentService?.tracingInstance && (
        <TracesDiffTab
          testRun={testRun}
          tracingInstanceId={currentService.tracingInstance.id}
          serviceName={currentServiceNameItem.serviceName}
          scenario={selectedScenario!}
          transaction={selectedTransaction!}
          sampler={selectedSampler}
          onSamplerChange={onSamplerChange}
          onDiffStateChange={(st) => { diffState.current = st; }}
        />
      )}
    </Box>
  );
}
