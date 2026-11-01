'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Box, CircularProgress, Alert, Snackbar, Tabs, Tab } from '@mui/material';
import { TestRun } from '@/types/test-runs';

// Hooks
import {
  useTestRunData,
  useExpansionState,
  useConfigurationStatus,
  useRelatedTestRuns,
  scrollToCard,
  TAB,
  tabOfCard,
  type TabIndex,
} from './hooks';
import { useEventsData } from './components/events/hooks';
import { useHasDeepLinks } from './components/deep-links/hooks';

// Types
import { DrillDownFilters } from './types';

// Components
import DeepLinksCard from './components/deep-links/DeepLinksCard';
import DynatraceCard from './components/dynatrace/DynatraceCard';
import DistributedTracingCard from './components/distributed-tracing/DistributedTracingCard';
import PyroscopeCard from './components/pyroscope/PyroscopeCard';
import TestRunHeader from './components/header/TestRunHeader';
import TestRunDetailsCard from './components/test-run-details/TestRunDetailsCard';
import ConfigurationComparisonSection from './components/configuration-comparison/ConfigurationComparisonSection';
import DashboardsSection from './components/dashboards/DashboardsSection';
import ServiceLevelObjectivesSection from './components/service-level-objectives/ServiceLevelObjectivesSection';
import AnomalyDetectionSection from './components/anomaly-detection/AnomalyDetectionSection';
import TrendsCard from './components/trends/TrendsCard';
import CompareCard from './components/compare/CompareCard';
import PerformanceAnalysisCard from './components/performance-analysis/PerformanceAnalysisCard';
import EventsCard from './components/events/EventsCard';
import GraphsCard from './components/graphs/GraphsCard';
import AwrReportCard from './components/awr/AwrReportCard';
import ReportCard from './components/reporting/ReportCard';
import PendingReports from './components/reporting/PendingReports';
import { JobProgressIndicator } from '@/components/job-progress/JobProgressIndicator';
import { GenerateReportDialog } from '@/components/reports/report-generation/GenerateReportDialog';
import { HtmlReportViewerModal } from '@/components/reports/HtmlReportViewerModal';
import {
  CardLinkRequest,
  CardLinkRequestContext,
  LINKABLE_CARDS,
  LinkableCard,
  MetricSeriesRef,
  OpenCardLinkContext,
  PerformanceAnalysisDrillDownContext,
} from './components/shared/metric-card-links';
import { TabActiveContext } from './context/TabActiveContext';
import { TabErrorBoundary } from './components/shared/TabErrorBoundary';
import { getPlotly } from '@/lib/plotly';

const TAB_PANEL_IDS: Record<TabIndex, string> = {
  [TAB.results]: 'tabpanel-results',
  [TAB.rca]: 'tabpanel-rca',
  [TAB.reporting]: 'tabpanel-reporting',
};

/**
 * A hidden tab's subtree does not re-render: it keeps the props it last rendered with, so a live
 * run's updates, a keystroke on another tab or a toast cost it nothing, and it catches up the
 * moment it is shown. State inside its cards still updates; their timers check TabActiveContext.
 * `active` exists for the comparator only. A Provider whose value must change while the tab is
 * hidden (TabActiveContext, CardLinkRequestContext) must wrap TabBody, never sit inside it:
 * context crosses the memo, but a frozen subtree's own Provider never gets a new value.
 */
const TabBody = React.memo(
  function TabBody({ children }: { active: boolean; children: React.ReactNode }) {
    return <>{children}</>;
  },
  (_prev, next) => !next.active,
);

export default function TestRunDetailsPage() {
  const params = useParams();
  const testRunId = params.id as string;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabIndex>(TAB.results);
  // A tab mounts on first visit and then stays mounted (hidden), so its cards keep their own
  // state — added series, selected runs, filters — across tab switches. Recorded below the
  // loading return: a ?card= landing switches tabs while the spinner shows, and must not mount
  // the Results tab it never displayed.
  const [visitedTabs, setVisitedTabs] = useState<TabIndex[]>([]);
  // A chart in a hidden panel keeps whatever size it had; relayout the ones just shown. Only
  // that panel's: a window resize would wake every chart in every kept-mounted tab.
  useEffect(() => {
    document.querySelectorAll(`#${TAB_PANEL_IDS[activeTab]} .js-plotly-plot`).forEach((gd) => {
      getPlotly()?.Plots.resize(gd as HTMLElement).catch(() => undefined);
    });
  }, [activeTab]);
  // Prev/next changes the [id] segment, which Next 15 keys the page on, so the page remounts with
  // fresh state: drill-down filters, visited tabs and link requests never carry over to another run.
  const [perfAnalysisFilters, setPerfAnalysisFilters] = useState<DrillDownFilters | undefined>(undefined);

  // Toast notification state
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Report generation dialog state
  const [generateReportDialogOpen, setGenerateReportDialogOpen] = useState(false);
  const [reportRefreshTrigger, setReportRefreshTrigger] = useState(0);

  // Report viewer state (for viewing generated reports)
  const [reportViewerOpen, setReportViewerOpen] = useState(false);
  const [reportViewerReportId, setReportViewerReportId] = useState<string | undefined>(undefined);
  const [pendingReportIds, setPendingReportIds] = useState<string[]>([]);

  // Custom hooks
  const { configurationStatus, setHasDistributedTracing, setHasDynatrace, checkConfigurationStatus } =
    useConfigurationStatus();

  const { previousTestRun, nextTestRun, loadRelatedTestRuns } = useRelatedTestRuns(testRunId);

  const {
    expansionState,
    anomalyState,
    drillDownFilters,
    drillDownSeq,
    toggleExpansion,
    setExpansion,
    collapseTab,
    setAnomalyActiveTab,
    setAnomalyConclusionFilter,
    handleAnomalyExpand,
    handleDrillDownToDistributedTracing,
    handleDrillDownToDynatrace,
  } = useExpansionState();

  const handleTestRunLoaded = useCallback(
    async (testRun: TestRun) => {
      await loadRelatedTestRuns(testRun);
      await checkConfigurationStatus(testRun);
    },
    [loadRelatedTestRuns, checkConfigurationStatus]
  );

  const { testRun, loading, error, setTestRun, refreshTestRun, editingState, setEditingState } =
    useTestRunData({ testRunId, onLoadComplete: handleTestRunLoaded });

  const { events } = useEventsData(testRunId);

  const hasDeepLinks = useHasDeepLinks(
    testRun?.system_under_test_id || testRun?.systems_under_test?.id,
    testRun?.test_environment,
    testRun?.workload,
  );

  // Breadcrumb href back to the (filtered) test runs list
  const backHref = (() => {
    const params = new URLSearchParams();
    if (testRun) {
      const systemName = testRun.systems_under_test?.name;
      if (systemName) params.set('system', systemName);
      if (testRun.test_environment) params.set('environment', testRun.test_environment);
      if (testRun.workload) params.set('workload', testRun.workload);
    }
    const query = params.toString();
    return query ? `/test-runs?${query}` : '/test-runs';
  })();

  const showToast = useCallback((message: string) => {
    setSnackbarMessage(message);
    setSnackbarOpen(true);
  }, []);

  const handleTestRunUpdate = useCallback((updatedTestRun: TestRun) => {
    setTestRun(updatedTestRun);
  }, [setTestRun]);

  const handleCloseSnackbar = useCallback(() => setSnackbarOpen(false), []);

  const handleReportReady = useCallback((reportId: string) => {
    setReportViewerReportId(reportId);
    setReportViewerOpen(true);
  }, []);
  const handleReportSettled = useCallback((reportId: string) => {
    setPendingReportIds(prev => prev.filter(id => id !== reportId));
    setReportRefreshTrigger(prev => prev + 1);
  }, []);

  // Drill-down handlers with scroll behavior
  const onDrillDownToDistributedTracing = useCallback(
    (filters: DrillDownFilters) => {
      const needsTabSwitch = handleDrillDownToDistributedTracing(filters, activeTab, setActiveTab);
      scrollToCard('distributed-tracing-card-expanded', needsTabSwitch ? { delay: 150, maxRetries: 8 } : undefined);
    },
    [handleDrillDownToDistributedTracing, activeTab]
  );

  const onDrillDownToDynatrace = useCallback(
    (filters: DrillDownFilters) => {
      const needsTabSwitch = handleDrillDownToDynatrace(filters, activeTab, setActiveTab);
      scrollToCard('dynatrace-card-expanded', needsTabSwitch ? { delay: 150, maxRetries: 8 } : undefined);
    },
    [handleDrillDownToDynatrace, activeTab]
  );

  // Same-tab drill-down to Performance Analysis → Overview, filtered on the row's transaction
  const onDrillDownToPerformanceAnalysis = useCallback(
    (filters: DrillDownFilters) => {
      setPerfAnalysisFilters(filters);
      const needsTabSwitch = activeTab !== TAB.results;
      setActiveTab(TAB.results);
      setExpansion('performanceExpanded', true);
      scrollToCard('performance-analysis-card-expanded', needsTabSwitch ? { delay: 150, maxRetries: 8 } : undefined);
    },
    [activeTab, setExpansion]
  );

  // A row's "Open in Graphs / Compare / Trends" link, opened in a new tab, lands here with
  // ?card=…; the card's cascade reads the series itself. A plain click on this page never
  // navigates: openCardLink hands the series to the card instead (CardLinkRequestContext).
  const revealCard = useCallback((card: LinkableCard) => {
    setActiveTab(tabOfCard(`${card}Expanded`));
    setExpansion(`${card}Expanded`, true);
    scrollToCard(`${card}-card-expanded`, { delay: 150, maxRetries: 8 });
  }, [setExpansion]);
  const linkedCard = useSearchParams().get('card');
  useEffect(() => {
    if (LINKABLE_CARDS.includes(linkedCard as LinkableCard)) revealCard(linkedCard as LinkableCard);
  }, [linkedCard, revealCard]);
  const [cardLinkRequest, setCardLinkRequest] = useState<CardLinkRequest | null>(null);
  const consumedCardLinks = useRef(new Set<string>()).current;
  const lastCardLinkRequestId = useRef(0);
  const cardLinkContext = useMemo(() => ({ request: cardLinkRequest, consumed: consumedCardLinks }), [cardLinkRequest, consumedCardLinks]);
  const openCardLink = useCallback((card: LinkableCard, ref: MetricSeriesRef) => {
    setCardLinkRequest({ card, ref, id: ++lastCardLinkRequestId.current });
    revealCard(card);
  }, [revealCard]);
  // ReportCard's refresh effect depends on this callback, so an inline arrow refetched the
  // report summary on every page render once a report had settled.
  const onReportSnackbar = useCallback((message: string) => showToast(message), [showToast]);

  // Anomaly expansion handler
  const onAnomalyExpand = useCallback(
    (tabIndex?: number) => {
      const wasCollapsed = handleAnomalyExpand(tabIndex);
      if (wasCollapsed) scrollToCard('anomaly-detection-section-expanded');
    },
    [handleAnomalyExpand]
  );

  // Loading state
  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'background.default' }}>
        <CircularProgress size={48} />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'background.default', p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 600 }}>{error}</Alert>
      </Box>
    );
  }

  // Not found state
  if (!testRun) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'background.default', p: 3 }}>
        <Alert severity="warning" sx={{ maxWidth: 600 }}>Test run not found</Alert>
      </Box>
    );
  }

  if (!visitedTabs.includes(activeTab)) setVisitedTabs([...visitedTabs, activeTab]);

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
    gap: 3,
    alignItems: 'stretch',
  };

  const cardBoxStyle = (isExpanded: boolean) => ({
    gridColumn: isExpanded ? '1 / -1' : 'auto',
    height: isExpanded ? 'auto' : '293px',
    display: 'flex',
    flexDirection: 'column' as const,
  });

  return (
    <PerformanceAnalysisDrillDownContext.Provider value={onDrillDownToPerformanceAnalysis}>
    <OpenCardLinkContext.Provider value={openCardLink}>
    <CardLinkRequestContext.Provider value={cardLinkContext}>
    <Box sx={{ backgroundColor: 'background.default', pb: 4 }}>
      {/* Deletion status banner */}
      {testRun.deletion_status === 'queued' || testRun.deletion_status === 'deleting' ? (
        <Alert severity="warning" sx={{ mx: 3, mt: 2 }}>
          This test run is scheduled for deletion.
        </Alert>
      ) : testRun.deletion_status === 'failed' ? (
        <Alert severity="error" sx={{ mx: 3, mt: 2 }}>
          Deletion of this test run failed. You can retry from the test runs list.
        </Alert>
      ) : null}

      {/* Header */}
      <TestRunHeader
        testRun={testRun}
        backHref={backHref}
        previousTestRun={previousTestRun}
        nextTestRun={nextTestRun}
        onSuccess={showToast}
        onError={showToast}
        onRefresh={refreshTestRun}
      />

      {/* Job Progress */}
      <JobProgressIndicator
        testRunId={testRun.test_run_id}
        systemUnderTestId={testRun.system_under_test_id || testRun.systems_under_test?.id}
        testEnvironment={testRun.test_environment}
        workload={testRun.workload}
        variant="detailed"
        onCompleted={refreshTestRun}
        onFailed={(error) => showToast(`Job failed: ${error}`)}
      />

      {/* Main Content */}
      <Box sx={{ px: 3 }}>
        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            aria-label="Test run details tabs"
            sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '0.95rem', minHeight: 48, px: 3 }, '& .Mui-selected': { color: 'primary.main' } }}
          >
            {/* onChange skips a click on the active tab; onClick then sees the pre-switch activeTab, so only a re-click collapses.
                detail === 1: a single pointer click. A double-click's second click (2) and keyboard activation (0) never collapse. */}
            <Tab label="Results" id="tab-results" aria-controls={TAB_PANEL_IDS[TAB.results]} onClick={(e) => e.detail === 1 && activeTab === TAB.results && collapseTab(TAB.results)} />
            <Tab label="Root Cause Analysis" id="tab-rca" aria-controls={TAB_PANEL_IDS[TAB.rca]} onClick={(e) => e.detail === 1 && activeTab === TAB.rca && collapseTab(TAB.rca)} />
            <Tab label="Reporting" id="tab-reporting" aria-controls={TAB_PANEL_IDS[TAB.reporting]} onClick={(e) => e.detail === 1 && activeTab === TAB.reporting && collapseTab(TAB.reporting)} />
          </Tabs>
        </Box>

        {/* Results Tab */}
        <Box role="tabpanel" hidden={activeTab !== TAB.results} id={TAB_PANEL_IDS[TAB.results]} aria-labelledby="tab-results">
          {visitedTabs.includes(TAB.results) && (
            <TabActiveContext.Provider value={activeTab === TAB.results}>
            <TabErrorBoundary key={testRunId}>
            <TabBody active={activeTab === TAB.results}>
            <Box sx={gridStyle}>
              <Box sx={cardBoxStyle(expansionState.expanded)}>
                <TestRunDetailsCard
                  testRun={testRun}
                  expanded={expansionState.expanded}
                  setExpanded={(val) => { const wasCollapsed = !expansionState.expanded; setExpansion('expanded', val); if (wasCollapsed && val) scrollToCard('test-run-details-card-expanded'); }}
                  isEditingTags={editingState.isEditingTags}
                  setIsEditingTags={(val) => setEditingState(prev => ({ ...prev, isEditingTags: val }))}
                  editingTags={editingState.editingTags}
                  setEditingTags={(val) => setEditingState(prev => ({ ...prev, editingTags: val }))}
                  allAvailableTags={editingState.allAvailableTags}
                  tagsSaving={editingState.tagsSaving}
                  setTagsSaving={(val) => setEditingState(prev => ({ ...prev, tagsSaving: val }))}
                  isEditingAnnotations={editingState.isEditingAnnotations}
                  setIsEditingAnnotations={(val) => setEditingState(prev => ({ ...prev, isEditingAnnotations: val }))}
                  editingAnnotations={editingState.editingAnnotations}
                  setEditingAnnotations={(val) => setEditingState(prev => ({ ...prev, editingAnnotations: val }))}
                  annotationsSaving={editingState.annotationsSaving}
                  setAnnotationsSaving={(val) => setEditingState(prev => ({ ...prev, annotationsSaving: val }))}
                  onTestRunUpdate={handleTestRunUpdate}
                  showToast={showToast}
                  onRefreshTriggered={refreshTestRun}
                />
              </Box>
              <Box sx={cardBoxStyle(expansionState.configExpanded)}>
                <ConfigurationComparisonSection testRun={testRun} testRunId={testRunId} configExpanded={expansionState.configExpanded} onConfigExpand={() => { const wasCollapsed = !expansionState.configExpanded; toggleExpansion('configExpanded'); if (wasCollapsed) scrollToCard('config-comparison-expanded'); }} showToast={showToast} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.dashboardsExpanded)}>
                <DashboardsSection testRun={testRun} testRunId={testRunId} dashboardsExpanded={expansionState.dashboardsExpanded} onDashboardsExpand={() => { const wasCollapsed = !expansionState.dashboardsExpanded; toggleExpansion('dashboardsExpanded'); if (wasCollapsed) scrollToCard('dashboards-section-expanded'); }} showToast={showToast} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.anomalyExpanded)}>
                <AnomalyDetectionSection testRun={testRun} testRunId={testRunId} anomalyExpanded={expansionState.anomalyExpanded} onAnomalyExpand={onAnomalyExpand} activeTab={anomalyState.activeTab} onActiveTabChange={setAnomalyActiveTab} conclusionFilter={anomalyState.conclusionFilter} setConclusionFilter={setAnomalyConclusionFilter} showToast={showToast} onTestRunUpdate={handleTestRunUpdate} hasDistributedTracing={configurationStatus.hasDistributedTracing} hasDynatrace={configurationStatus.hasDynatrace} onDrillDownToDistributedTracing={onDrillDownToDistributedTracing} onDrillDownToDynatrace={onDrillDownToDynatrace} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.performanceExpanded)}>
                <PerformanceAnalysisCard initialFilters={perfAnalysisFilters} testRunId={testRunId} testRun={testRun} expanded={expansionState.performanceExpanded} onExpand={() => { const wasCollapsed = !expansionState.performanceExpanded; toggleExpansion('performanceExpanded'); if (wasCollapsed) scrollToCard('performance-analysis-card-expanded'); }} showToast={showToast} hasDistributedTracing={configurationStatus.hasDistributedTracing} hasDynatrace={configurationStatus.hasDynatrace} onDrillDownToDistributedTracing={onDrillDownToDistributedTracing} onDrillDownToDynatrace={onDrillDownToDynatrace} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.sloExpanded)}>
                <ServiceLevelObjectivesSection testRun={testRun} testRunId={testRunId} sloExpanded={expansionState.sloExpanded} setSloExpanded={(val) => { const wasCollapsed = !expansionState.sloExpanded; setExpansion('sloExpanded', val); if (wasCollapsed && val) scrollToCard('slo-section-expanded'); }} hasDistributedTracing={configurationStatus.hasDistributedTracing} hasDynatrace={configurationStatus.hasDynatrace} onDrillDownToDistributedTracing={onDrillDownToDistributedTracing} onDrillDownToDynatrace={onDrillDownToDynatrace} />
              </Box>
              {hasDeepLinks && (
                <Box sx={cardBoxStyle(expansionState.deepLinksExpanded)}>
                  <DeepLinksCard testRun={testRun} expanded={expansionState.deepLinksExpanded} onExpand={() => { const wasCollapsed = !expansionState.deepLinksExpanded; toggleExpansion('deepLinksExpanded'); if (wasCollapsed) scrollToCard('deep-links-card-expanded'); }} />
                </Box>
              )}
              {events.length > 0 && (
                <Box sx={cardBoxStyle(expansionState.eventsExpanded)}>
                  <EventsCard testRun={testRun} testRunId={testRunId} expanded={expansionState.eventsExpanded} onExpand={() => { const wasCollapsed = !expansionState.eventsExpanded; toggleExpansion('eventsExpanded'); if (wasCollapsed) scrollToCard('events-card-expanded'); }} showToast={showToast} />
                </Box>
              )}
            </Box>
            </TabBody>
            </TabErrorBoundary>
            </TabActiveContext.Provider>
          )}
        </Box>

        {/* Root Cause Analysis Tab */}
        <Box role="tabpanel" hidden={activeTab !== TAB.rca} id={TAB_PANEL_IDS[TAB.rca]} aria-labelledby="tab-rca">
          {visitedTabs.includes(TAB.rca) && (
            <TabActiveContext.Provider value={activeTab === TAB.rca}>
            <TabErrorBoundary key={testRunId}>
            <TabBody active={activeTab === TAB.rca}>
            <Box sx={gridStyle}>
              <DynatraceCard key={`dynatrace-${drillDownSeq.dynatrace}`} testRun={testRun} expanded={expansionState.dynatraceExpanded} onExpand={() => { const wasCollapsed = !expansionState.dynatraceExpanded; toggleExpansion('dynatraceExpanded'); if (wasCollapsed) scrollToCard('dynatrace-card-expanded'); }} initialFilters={drillDownFilters.dynatrace} onConfigurationStatus={setHasDynatrace} />
              <DistributedTracingCard key={`tracing-${drillDownSeq.distributedTracing}`} testRun={testRun as unknown as Parameters<typeof DistributedTracingCard>[0]['testRun']} expanded={expansionState.distributedTracingExpanded} onExpand={() => { const wasCollapsed = !expansionState.distributedTracingExpanded; toggleExpansion('distributedTracingExpanded'); if (wasCollapsed) scrollToCard('distributed-tracing-card-expanded'); }} initialFilters={drillDownFilters.distributedTracing} onConfigurationStatus={setHasDistributedTracing} />
              {(testRun.systems_under_test?.pyroscope_instance_id || testRun.system_under_test?.pyroscope_instance_id) && (
                <PyroscopeCard testRun={testRun as unknown as Parameters<typeof PyroscopeCard>[0]['testRun']} expanded={expansionState.pyroscopeExpanded} onExpand={() => { const wasCollapsed = !expansionState.pyroscopeExpanded; toggleExpansion('pyroscopeExpanded'); if (wasCollapsed) scrollToCard('pyroscope-card-expanded'); }} />
              )}
              <Box sx={cardBoxStyle(expansionState.awrExpanded)}>
                <AwrReportCard testRun={testRun} expanded={expansionState.awrExpanded} onExpand={() => { const wasCollapsed = !expansionState.awrExpanded; toggleExpansion('awrExpanded'); if (wasCollapsed) scrollToCard('awr-report-card-expanded'); }} />
              </Box>
            </Box>
            </TabBody>
            </TabErrorBoundary>
            </TabActiveContext.Provider>
          )}
        </Box>

        {/* Reporting Tab */}
        <Box role="tabpanel" hidden={activeTab !== TAB.reporting} id={TAB_PANEL_IDS[TAB.reporting]} aria-labelledby="tab-reporting">
          {visitedTabs.includes(TAB.reporting) && (
            <TabActiveContext.Provider value={activeTab === TAB.reporting}>
            <TabErrorBoundary key={testRunId}>
            <TabBody active={activeTab === TAB.reporting}>
            <Box sx={gridStyle}>
              <Box sx={cardBoxStyle(expansionState.reportExpanded)}>
                <ReportCard
                  testRun={testRun}
                  expanded={expansionState.reportExpanded}
                  onExpand={() => {
                    const wasCollapsed = !expansionState.reportExpanded;
                    toggleExpansion('reportExpanded');
                    if (wasCollapsed) scrollToCard('report-card-expanded');
                  }}
                  onGenerateReport={() => setGenerateReportDialogOpen(true)}
                  onSnackbar={onReportSnackbar}
                  refreshTrigger={reportRefreshTrigger}
                />
              </Box>
              <Box sx={cardBoxStyle(expansionState.trendsExpanded)}>
                <TrendsCard testRun={testRun} testRunId={testRunId} trendsExpanded={expansionState.trendsExpanded} onTrendsExpand={() => { const wasCollapsed = !expansionState.trendsExpanded; toggleExpansion('trendsExpanded'); if (wasCollapsed) scrollToCard('trends-card-expanded'); }} showToast={showToast} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.compareExpanded)}>
                <CompareCard testRun={testRun} testRunId={testRunId} compareExpanded={expansionState.compareExpanded} onCompareExpand={() => { const wasCollapsed = !expansionState.compareExpanded; toggleExpansion('compareExpanded'); if (wasCollapsed) scrollToCard('compare-card-expanded'); }} showToast={showToast} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.graphsExpanded)}>
                <GraphsCard testRun={testRun} testRunId={testRunId} graphsExpanded={expansionState.graphsExpanded} onGraphsExpand={() => { const wasCollapsed = !expansionState.graphsExpanded; toggleExpansion('graphsExpanded'); if (wasCollapsed) scrollToCard('graphs-card-expanded'); }} showToast={showToast} events={events} />
              </Box>
            </Box>
            </TabBody>
            </TabErrorBoundary>
            </TabActiveContext.Provider>
          )}
        </Box>
      </Box>

      {/* Report generation progress — stays up until every pending report is ready or has failed */}
      <PendingReports ids={pendingReportIds} onReady={handleReportReady} onSettled={handleReportSettled} showToast={showToast} />

      {/* Snackbar */}
      <Snackbar open={snackbarOpen} autoHideDuration={4000} onClose={handleCloseSnackbar} message={snackbarMessage} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />

      {/* Generate Report Dialog */}
      {testRun && (
        <GenerateReportDialog
          open={generateReportDialogOpen}
          onClose={() => setGenerateReportDialogOpen(false)}
          // The human test_run_id, as every other consumer on this page and the compare card
          // pass it. The report endpoints accept either form, but the URL-panel series lookup
          // reads test_run_sampler_stats, which keys on this one — with the UUID it matched
          // nothing and "URL RT" offered no series at all.
          testRunId={testRun.test_run_id}
          scope={{
            systemId: testRun.system_under_test?.id || testRun.system_under_test_id,
            testEnvironment: testRun.test_environment || '',
            workload: testRun.workload || '',
          }}
          onSuccess={(reportId, _jobId) => {
            setGenerateReportDialogOpen(false);
            // Start polling for report completion; the progress panel takes it from here
            setPendingReportIds(prev => prev.includes(reportId) ? prev : [...prev, reportId]);
          }}
          onError={(error) => {
            showToast(`Failed to generate report: ${error}`);
          }}
        />
      )}

      {/* Report Viewer Modal */}
      <HtmlReportViewerModal
        open={reportViewerOpen}
        onClose={() => {
          setReportViewerOpen(false);
          setReportViewerReportId(undefined);
        }}
        reportId={reportViewerReportId}
        reportName={testRun?.test_run_id || 'Report'}
        defaultFullscreen={true}
        onError={(error) => showToast(error)}
      />
    </Box>
    </CardLinkRequestContext.Provider>
    </OpenCardLinkContext.Provider>
    </PerformanceAnalysisDrillDownContext.Provider>
  );
}
