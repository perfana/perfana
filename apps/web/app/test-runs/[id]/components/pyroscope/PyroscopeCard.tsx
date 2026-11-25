'use client';

import { useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Divider,
  Alert,
  Typography,
  Tabs,
  Tab,
  Button,
} from '@mui/material';
import { OpenInNew } from '@mui/icons-material';

// Types
import { PyroscopeCardProps } from './types';

// Hooks
import { usePyroscopeData } from './hooks';

// Components
import {
  PyroscopeCollapsedView,
  PyroscopeFlameGraph,
  PyroscopeAnalysis,
  PyroscopeHeader,
  PyroscopeBaselineSelector,
} from './components';
import { WithinRunWindowsPicker } from '../shared/WithinRunWindowsPicker';

import { useCommentItemCounts, useCommentItemFocus } from '../comments/CommentsContext';
import ItemCommentHeader, { NO_EVENT, TabCommentMark } from '../comments/ItemCommentHeader';
import { useDiffCommentView } from '../comments/useDiffCommentView';
import { isComboKey, parsePyroscopeItemKey, pyroscopeItemKey, pyroscopeItemLabel } from './utils/pyroscope-comment-key';

// Utils
import { getAccentColor } from './utils/pyroscope-formatters';

/**
 * PyroscopeCard component displays continuous profiling data from Pyroscope
 * Provides single view and comparison/diff views of flame graphs
 */
export default function PyroscopeCard({
  testRun,
  expanded,
  onExpand,
}: PyroscopeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Data hook
  const pyroscopeData = usePyroscopeData({ testRun, expanded });

  // Comments per application + profiler combination and view (single / diff).
  const commentCounts = useCommentItemCounts('pyroscope', expanded);
  useCommentItemFocus('pyroscope', (key) => {
    const target = parsePyroscopeItemKey(key);
    if (!target) return false;
    const idx = pyroscopeData.configurations.findIndex((c) => c.application === target.application && c.profiler === target.profiler);
    if (idx < 0) return false;
    if (idx !== pyroscopeData.activeCombinationTab) pyroscopeData.handleCombinationTabChange(NO_EVENT, idx);
    if (target.viewModeTab !== null && target.viewModeTab !== pyroscopeData.viewModeTab) {
      pyroscopeData.handleViewModeTabChange(NO_EVENT, target.viewModeTab);
    }
    return true;
  });
  const activeCombo = pyroscopeData.configurations[pyroscopeData.activeCombinationTab];
  useDiffCommentView('pyroscope', () => ({
    open: pyroscopeData.viewModeTab === 1,
    baselineTestRunId: pyroscopeData.compareMode === 'run' ? pyroscopeData.selectedBaseline?.test_run_id : null,
    windows: pyroscopeData.compareMode === 'within' ? pyroscopeData.runWindows : null,
  }));

  // Handle expand/collapse
  const handleExpand = (): void => {
    const wasCollapsed = !expanded;
    onExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="pyroscope-card-expanded"]');
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  const accentColor = getAccentColor(!!pyroscopeData.error);

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
        data-testid={expanded ? 'pyroscope-card-expanded' : 'pyroscope-card-collapsed'}
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
          <PyroscopeHeader
            expanded={expanded}
            onExpand={handleExpand}
            testRunId={testRun.test_run_id}
            systemUnderTestId={testRun.system_under_test_id}
            testEnvironment={testRun.test_environment || ''}
            workload={testRun.workload || ''}
            accentColor={accentColor}
          />

          {/* Collapsed state content */}
          {!expanded && (
            <PyroscopeCollapsedView
              applications={pyroscopeData.applications}
              profilers={pyroscopeData.profilers}
            />
          )}

          {/* Expandable details */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />

            {pyroscopeData.configurations.length === 0 ? (
              <Box textAlign="center" py={4}>
                <Alert severity="info" sx={{ mb: 2 }}>
                  No Pyroscope configuration found for this test run. Configure application+profiler combinations in
                  the system settings to view profiling data.
                </Alert>
              </Box>
            ) : (
              <Box>
                {/* Top-level tabs for application-profiler combinations */}
                {pyroscopeData.configurations.length > 1 && (
                  <Tabs
                    value={pyroscopeData.activeCombinationTab}
                    onChange={pyroscopeData.handleCombinationTabChange}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
                  >
                    {pyroscopeData.configurations.map((config, index) => (
                      <Tab key={index} label={<span>{`${config.application} / ${config.profiler.split(':')[0]}`}<TabCommentMark counts={commentCounts} itemKey={isComboKey(config)} /></span>} sx={{ fontSize: '0.875rem', minWidth: 140 }} />
                    ))}
                  </Tabs>
                )}

                {/* Nested tabs for Single View / Diff View */}
                <Tabs value={pyroscopeData.viewModeTab} onChange={pyroscopeData.handleViewModeTabChange} sx={{ mb: 3 }}>
                  <Tab label="Single View" />
                  <Tab label="Diff View" />
                </Tabs>

                {/* Comments on this profiler in this view; the scroll target when one is opened. */}
                {activeCombo && (
                  <ItemCommentHeader
                    card="pyroscope"
                    itemKey={pyroscopeItemKey(activeCombo, pyroscopeData.viewModeTab)}
                    itemLabel={pyroscopeItemLabel(activeCombo, pyroscopeData.viewModeTab)}
                    title={pyroscopeItemLabel(activeCombo, pyroscopeData.viewModeTab)}
                    counts={commentCounts}
                  >
                    {/* Threads on this profiler in the other view (or from before views were tracked). */}
                    <TabCommentMark
                      counts={commentCounts}
                      itemKey={(k) => isComboKey(activeCombo)(k) && k !== pyroscopeItemKey(activeCombo, pyroscopeData.viewModeTab)}
                    />
                  </ItemCommentHeader>
                )}

                {pyroscopeData.error && <Alert severity="error" sx={{ mb: 2 }}>{pyroscopeData.error}</Alert>}

                {/* Single View Tab Content */}
                {pyroscopeData.viewModeTab === 0 && (
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <Button
                        variant="outlined"
                        startIcon={<OpenInNew />}
                        onClick={pyroscopeData.handleOpenExternal}
                        disabled={!pyroscopeData.singleViewUrl || pyroscopeData.loading}
                        fullWidth
                      >
                        Open in Pyroscope
                      </Button>
                    </Box>
                    <PyroscopeFlameGraph
                      url={pyroscopeData.singleViewUrl}
                      loading={pyroscopeData.loading}
                      iframeLoading={pyroscopeData.iframeLoading}
                      title="Pyroscope Single View"
                      loadingText="Loading flame graph..."
                      emptyText="Select application and profiler to view flame graph"
                      onLoad={pyroscopeData.handleIframeLoad}
                      onError={pyroscopeData.handleIframeError}
                    />
                  </Box>
                )}

                {/* Diff View Tab Content */}
                {pyroscopeData.viewModeTab === 1 && (
                  <Box>
                    <Box sx={{ mb: 3 }}>
                      <WithinRunWindowsPicker
                        mode={pyroscopeData.compareMode}
                        onModeChange={pyroscopeData.setCompareMode}
                        startTime={testRun.start_time}
                        endTime={testRun.end_time}
                        value={pyroscopeData.runWindows}
                        onChange={pyroscopeData.setRunWindows}
                      />
                    </Box>
                    {pyroscopeData.compareMode === 'run' && (
                      <PyroscopeBaselineSelector
                        relatedTestRuns={pyroscopeData.relatedTestRuns}
                        selectedBaseline={pyroscopeData.selectedBaseline}
                        onBaselineChange={pyroscopeData.setSelectedBaseline}
                        loading={pyroscopeData.fetchingBaselines}
                      />
                    )}

                    {pyroscopeData.hasComparison && (
                      <PyroscopeAnalysis
                        analysis={pyroscopeData.flamegraphAnalysis}
                        loading={pyroscopeData.analysingFlamegraph}
                        showAnalysis={pyroscopeData.showAnalysis}
                        onToggleAnalysis={() => pyroscopeData.setShowAnalysis(!pyroscopeData.showAnalysis)}
                        symbolFilter={pyroscopeData.symbolFilter}
                        onSymbolFilterChange={pyroscopeData.setSymbolFilter}
                        showAllRegressions={pyroscopeData.showAllRegressions}
                        onToggleAllRegressions={() => pyroscopeData.setShowAllRegressions(!pyroscopeData.showAllRegressions)}
                        showAllImprovements={pyroscopeData.showAllImprovements}
                        onToggleAllImprovements={() => pyroscopeData.setShowAllImprovements(!pyroscopeData.showAllImprovements)}
                        compareViewUrl={pyroscopeData.compareViewUrl}
                        isLoading={pyroscopeData.loading}
                        hasBaseline={pyroscopeData.hasComparison}
                        onOpenExternal={pyroscopeData.handleOpenExternal}
                      />
                    )}

                    {!pyroscopeData.hasComparison ? (
                      <Box textAlign="center" py={8}>
                        <Typography variant="body2" color="text.secondary">
                          Select a baseline test run to compare
                        </Typography>
                      </Box>
                    ) : (
                      <PyroscopeFlameGraph
                        url={pyroscopeData.compareViewUrl}
                        loading={pyroscopeData.loading}
                        iframeLoading={pyroscopeData.compareIframeLoading}
                        title="Pyroscope Comparison View"
                        loadingText="Loading comparison..."
                        emptyText="Select application, profiler, and baseline to view comparison"
                        onLoad={pyroscopeData.handleCompareIframeLoad}
                        onError={pyroscopeData.handleCompareIframeError}
                      />
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}
