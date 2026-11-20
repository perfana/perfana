'use client';

import { useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Divider,
  Alert,
} from '@mui/material';

// Types
import { DistributedTracingCardProps } from './types';

// Hooks
import { useDistributedTracingData } from './hooks';
import { useCommentItemCounts, useCommentItemFocus } from '../comments/CommentsContext';
import { NO_EVENT } from '../comments/ItemCommentHeader';
import { parseTracingItemKey } from './components/DistributedTracingExpandedContent';

// Components
import {
  DistributedTracingCollapsedView,
  DistributedTracingExpandedContent,
  DistributedTracingHeader,
} from './components';

/**
 * DistributedTracingCard component displays distributed tracing data
 * Supports Tempo, Jaeger, and Elastic APM integrations
 */
export default function DistributedTracingCard({
  testRun,
  expanded,
  onExpand,
  initialFilters,
  onConfigurationStatus,
}: DistributedTracingCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Data hook manages all state and data loading
  const data = useDistributedTracingData({
    testRun,
    expanded,
    initialFilters,
    onConfigurationStatus,
  });

  // Comments per service name and the request filters they were written under.
  const commentCounts = useCommentItemCounts('distributed-tracing', expanded);
  useCommentItemFocus('distributed-tracing', (key) => {
    const target = parseTracingItemKey(key);
    if (!target) return false;
    const idx = data.allServiceNames.findIndex((s) => s.tracingServiceId === target.serviceId && s.serviceName === target.serviceName);
    if (idx < 0) return false;
    // The tab change clears the filters; the setters below run after it in the same batch.
    if (idx !== data.activeServiceNameTab) data.handleServiceNameTabChange(NO_EVENT, idx);
    data.setSelectedScenario(target.scenario);
    data.setSelectedTransaction(target.transaction);
    data.setSelectedSampler(target.sampler);
    return true;
  });

  // Handle expand/collapse with auto-focus
  const handleExpand = (): void => {
    const wasCollapsed = !expanded;
    onExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="distributed-tracing-card-expanded"]');
        if (expandedCard) {
          expandedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  // Get accent color key based on status (for theme-aware usage)
  const getAccentColorKey = (): 'error' | 'primary' => {
    return data.error ? 'error' : 'primary';
  };

  // Hide the card completely when no tracing is configured
  if (!data.loading && data.tracingServices.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        gridColumn: expanded ? '1 / -1' : 'auto',
        height: expanded ? 'auto' : '293px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={
          expanded ? 'distributed-tracing-card-expanded' : 'distributed-tracing-card-collapsed'
        }
        elevation={0}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: '100%',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: '3px solid',
          borderTopColor: `${getAccentColorKey()}.main`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: expanded ? 'visible' : 'hidden',
          '&:hover': expanded
            ? {}
            : {
                transform: 'translateY(-4px)',
                boxShadow: (theme) => theme.palette.mode === 'dark'
                  ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
                  : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
              },
        }}
        onClick={expanded ? undefined : handleExpand}
      >
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: 3.5,
            pt: 4,
            '&:last-child': { pb: 3.5 },
          }}
        >
          {/* Header Section */}
          <DistributedTracingHeader
            expanded={expanded}
            testRunId={testRun.test_run_id}
            systemId={testRun.system_under_test_id}
            testEnvironment={testRun.test_environment || ''}
            workload={testRun.workload || ''}
            accentColorKey={getAccentColorKey()}
            onExpand={handleExpand}
          />

          {/* Collapsed state content */}
          {!expanded && (
            <DistributedTracingCollapsedView
              loading={data.loading}
              tracingServices={data.tracingServices}
              totalServiceNames={data.totalServiceNames}
              uiTypes={data.uiTypes}
            />
          )}

          {/* Expandable details */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />

            {data.tracingServices.length === 0 ? (
              <Box textAlign="center" py={4}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  No distributed tracing configured for this test run. Configure tracing services in
                  the system settings to view traces.
                </Alert>
              </Box>
            ) : (
              <DistributedTracingExpandedContent
                testRun={testRun}
                commentCounts={commentCounts}
                allServiceNames={data.allServiceNames}
                activeServiceNameTab={data.activeServiceNameTab}
                onServiceNameTabChange={data.handleServiceNameTabChange}
                currentServiceNameItem={data.currentServiceNameItem ?? null}
                currentService={data.currentService ?? null}
                error={data.error}
                scenarios={data.scenarios}
                transactions={data.transactions}
                samplers={data.samplers}
                selectedScenario={data.selectedScenario}
                selectedTransaction={data.selectedTransaction}
                selectedSampler={data.selectedSampler}
                minDuration={data.minDuration}
                maxDuration={data.maxDuration}
                onScenarioChange={data.setSelectedScenario}
                onTransactionChange={data.setSelectedTransaction}
                onSamplerChange={data.setSelectedSampler}
                onMinDurationChange={data.setMinDuration}
                onMaxDurationChange={data.setMaxDuration}
                viewModeTab={data.viewModeTab}
                onViewModeTabChange={data.handleViewModeTabChange}
                isTracesDiffEnabled={data.isTracesDiffEnabled}
                tracingUrl={data.tracingUrl}
                loading={data.loading}
                iframeLoading={data.iframeLoading}
                onOpenExternal={data.handleOpenExternal}
                onIframeLoad={() => data.setIframeLoading(false)}
                onIframeError={() => {
                  data.setIframeLoading(false);
                  data.setError('Failed to load tracing iframe');
                }}
              />
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}
