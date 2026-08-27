'use client';

import { useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Collapse,
  Divider,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import { ExpandMore, ExpandLess, Settings } from '@mui/icons-material';

import { buildSystemConfigUrl } from '@/lib/system-config-url';

// Types
import { DynatraceCardProps } from './types';

// Hooks
import { useDynatraceData, useDynatraceHandlers } from './hooks';

// Components
import { DynatraceCollapsedView, DynatraceExpandedContent } from './components';

// Utils
import { getAccentColor } from './utils/dynatrace-config';

export default function DynatraceCard({
  testRun,
  expanded,
  onExpand,
  initialFilters,
  onConfigurationStatus,
}: DynatraceCardProps) {
  const { test_run_id: testRunId } = testRun;
  const cardRef = useRef<HTMLDivElement>(null);

  // Data hook
  const dynatraceData = useDynatraceData({
    testRun,
    testRunId,
    expanded,
    initialFilters,
    onConfigurationStatus,
  });

  // Handlers hook
  const handlers = useDynatraceHandlers({
    testRun,
    configs: dynatraceData.configs,
    selectedMetric: dynatraceData.filterOptions.selectedMetric,
    minDuration: dynatraceData.minDuration,
    maxDuration: dynatraceData.maxDuration,
  });

  // Handle expand/collapse with auto-focus
  const handleExpand = () => {
    const wasCollapsed = !expanded;
    onExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="dynatrace-card-expanded"]');
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  // Don't render if no configurations exist and not loading
  if (!dynatraceData.loading && dynatraceData.configs.length === 0 && !dynatraceData.error) {
    return null;
  }

  const accentColor = getAccentColor(!!dynatraceData.error);

  return (
    <Box sx={{
      gridColumn: expanded ? '1 / -1' : 'auto',
      height: expanded ? 'auto' : '293px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={expanded ? 'dynatrace-card-expanded' : 'dynatrace-card-collapsed'}
        elevation={0}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: '100%',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: `3px solid ${accentColor}`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: expanded ? 'visible' : 'hidden',
          '&:hover': expanded ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
          }
        }}
        onClick={expanded ? undefined : handleExpand}
      >
        <CardContent sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 3.5,
          pt: 4,
          '&:last-child': { pb: 3.5 }
        }}>
          {/* Header Section */}
          {expanded ? (
            <Box
              mb={2.5}
              sx={{
                py: 1,
                px: 1.25,
                mx: -1.25,
                borderRadius: 2,
                transition: 'background-color 0.2s ease',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
              onClick={handleExpand}
            >
              <Box textAlign="center">
                <Typography
                  variant="h5"
                  component="h2"
                  sx={{ fontWeight: 600, color: 'text.primary', fontSize: '1.25rem', lineHeight: 1.2 }}
                >
                  Dynatrace
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Click to collapse
                </Typography>
              </Box>
              <Tooltip title="Configure Dynatrace settings" placement="top">
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(buildSystemConfigUrl({
                      systemId: testRun.system_under_test_id,
                      tab: 'dynatrace',
                      environment: testRun.test_environment,
                      workload: testRun.workload,
                      fromTestRun: testRunId,
                    }), '_blank');
                  }}
                  size="medium"
                  sx={{
                    position: 'absolute',
                    right: 48,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    backgroundColor: 'action.hover',
                    '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText' },
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Settings />
                </IconButton>
              </Tooltip>
              <IconButton
                onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                size="medium"
                sx={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  backgroundColor: 'action.hover',
                  '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText' },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandLess />
              </IconButton>
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" mb={2} position="relative">
              <Typography
                variant="subtitle1"
                component="h2"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  fontSize: '0.875rem',
                  letterSpacing: '0.01em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                Dynatrace
              </Typography>
              <IconButton
                onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 0,
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': { backgroundColor: `${accentColor}15`, color: accentColor },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandMore />
              </IconButton>
            </Box>
          )}

          {/* Collapsed state content */}
          {!expanded && (
            <DynatraceCollapsedView
              loading={dynatraceData.loading}
              error={dynatraceData.error}
              entityMappings={dynatraceData.entityMappings}
              serviceEntities={dynatraceData.serviceEntities}
              hostEntities={dynatraceData.hostEntities}
              metricNames={dynatraceData.metricNames}
            />
          )}

          {/* Expanded content.
              onEntered: Plotly charts inside (host performance graphs) measure their
              geometry mid-animation and useResizeHandler only listens to window
              resize — dispatch one once the Collapse settles so they relayout at the
              final width (same fix as TrendsCard / AnomalyExpandedContent). */}
          <Collapse in={expanded} onEntered={() => window.dispatchEvent(new Event('resize'))}>
            <Divider sx={{ my: 2 }} />

            {dynatraceData.loading ? (
              <Box textAlign="center" py={4}>
                <CircularProgress size={32} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Loading Dynatrace data...
                </Typography>
              </Box>
            ) : dynatraceData.error ? (
              <Alert severity="error" sx={{ mb: 2 }}>
                {dynatraceData.error}
              </Alert>
            ) : dynatraceData.entityMappings.length === 0 ? (
              <Box textAlign="center" py={4}>
                <Typography variant="body2" color="text.secondary">
                  No Dynatrace entity mappings found for this test run.
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Configure entity mappings to see services and hosts here.
                </Typography>
              </Box>
            ) : (
              <DynatraceExpandedContent
                testRun={testRun}
                configs={dynatraceData.configs}
                serviceEntities={dynatraceData.serviceEntities}
                hostEntities={dynatraceData.hostEntities}
                scenarios={dynatraceData.filterOptions.scenarios}
                transactions={dynatraceData.filterOptions.transactions}
                samplers={dynatraceData.filterOptions.samplers}
                selectedScenario={dynatraceData.selectedScenario}
                selectedTransaction={dynatraceData.selectedTransaction}
                selectedSampler={dynatraceData.selectedSampler}
                minDuration={dynatraceData.minDuration}
                maxDuration={dynatraceData.maxDuration}
                isFullFilterSelected={dynatraceData.filterOptions.isFullFilterSelected}
                tabValue={dynatraceData.tabValue}
                primaryTabValue={dynatraceData.primaryTabValue}
                onTabChange={dynatraceData.handleTabChange}
                onPrimaryTabChange={dynatraceData.handlePrimaryTabChange}
                onScenarioChange={dynatraceData.handleScenarioChange}
                onTransactionChange={dynatraceData.handleTransactionChange}
                onSamplerChange={dynatraceData.setSelectedSampler}
                onMinDurationChange={dynatraceData.setMinDuration}
                onMaxDurationChange={dynatraceData.setMaxDuration}
                relatedTestRuns={dynatraceData.relatedTestRuns}
                selectedComparisonTestRun={dynatraceData.selectedComparisonTestRun}
                comparisonLoading={dynatraceData.comparisonLoading}
                onComparisonTestRunChange={dynatraceData.setSelectedComparisonTestRun}
                onFetchRelatedTestRuns={dynatraceData.fetchRelatedTestRuns}
                onDeepLinkClick={handlers.handleDeepLinkClick}
                onMultiDimensionalAnalysis={handlers.handleMultiDimensionalAnalysis}
                onComparisonClick={handlers.handleComparisonClick}
              />
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}
