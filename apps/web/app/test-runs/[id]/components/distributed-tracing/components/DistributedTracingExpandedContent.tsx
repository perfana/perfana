'use client';

import React from 'react';
import {
  Box,
  Alert,
  Tabs,
  Tab,
  Tooltip,
} from '@mui/material';
import {
  Timeline,
  CompareArrows,
} from '@mui/icons-material';

import { DistributedTracingCardProps, ServiceNameItem } from '../types';
import { TracingService } from '@/lib/distributed-tracing';
import { RequestFilteringSection } from './RequestFilteringSection';
import { VisualiseTab } from './VisualiseTab';
import TracesDiffTab from '../TracesDiffTab';

interface DistributedTracingExpandedContentProps {
  testRun: DistributedTracingCardProps['testRun'];
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
              label={`${item.serviceName} (${item.tracingUi.toUpperCase()})`}
              sx={{ fontSize: '0.875rem', minWidth: 140 }}
            />
          ))}
        </Tabs>
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
        />
      )}
    </Box>
  );
}
