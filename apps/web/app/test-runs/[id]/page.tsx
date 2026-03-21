'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Box, CircularProgress, Alert, Snackbar, Tabs, Tab } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { getReport } from '@/lib/api/reports';

// Hooks
import {
  useTestRunData,
  useExpansionState,
  useConfigurationStatus,
  useRelatedTestRuns,
  scrollToCard,
} from './hooks';
import { useEventsData } from './components/events/hooks';

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
import { JobProgressIndicator } from '@/components/job-progress/JobProgressIndicator';
import { GenerateReportDialog } from '@/components/reports/report-generation/GenerateReportDialog';
import { HtmlReportViewerModal } from '@/components/reports/HtmlReportViewerModal';

export default function TestRunDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const testRunId = params.id as string;

  // Tab state
  const [activeTab, setActiveTab] = useState(0);

  // Toast notification state
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Report generation dialog state
  const [generateReportDialogOpen, setGenerateReportDialogOpen] = useState(false);
  const [reportRefreshTrigger, setReportRefreshTrigger] = useState(0);

  // Report viewer state (for viewing generated reports)
  const [reportViewerOpen, setReportViewerOpen] = useState(false);
  const [reportViewerReportId, setReportViewerReportId] = useState<string | undefined>(undefined);
  const [pendingReportId, setPendingReportId] = useState<string | undefined>(undefined);

  // Custom hooks
  const { configurationStatus, setHasDistributedTracing, setHasDynatrace, checkConfigurationStatus } =
    useConfigurationStatus();

  const { previousTestRun, nextTestRun, loadRelatedTestRuns } = useRelatedTestRuns(testRunId);

  const {
    expansionState,
    anomalyState,
    drillDownFilters,
    toggleExpansion,
    setExpansion,
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

  const { testRun, loading, error, setTestRun, refreshTestRun, editingState, setEditingState, realtimeTrigger } =
    useTestRunData({ testRunId, onLoadComplete: handleTestRunLoaded });

  const { events } = useEventsData(testRunId);

  // Handlers
  const handleBack = useCallback(() => {
    const params = new URLSearchParams();
    if (testRun) {
      const systemName = testRun.systems_under_test?.name;
      if (systemName) params.set('system', systemName);
      if (testRun.test_environment) params.set('environment', testRun.test_environment);
      if (testRun.workload) params.set('workload', testRun.workload);
    }
    const query = params.toString();
    router.push(query ? `/test-runs?${query}` : '/test-runs');
  }, [router, testRun]);

  const showToast = useCallback((message: string) => {
    setSnackbarMessage(message);
    setSnackbarOpen(true);
  }, []);

  const handleTestRunUpdate = useCallback((updatedTestRun: TestRun) => {
    setTestRun(updatedTestRun);
  }, [setTestRun]);

  const handleCloseSnackbar = useCallback(() => setSnackbarOpen(false), []);

  // Poll for report completion after generation
  useEffect(() => {
    if (!pendingReportId) return;

    let isCancelled = false;
    let pollCount = 0;
    const maxPolls = 60; // 60 seconds max

    const pollReport = async () => {
      try {
        const report = await getReport(pendingReportId);

        if (isCancelled) return;

        // Check if HTML is ready
        if (report.status === 'html_complete' || report.status === 'pdf_complete') {
          setPendingReportId(undefined);
          setReportViewerReportId(report.id);
          setReportViewerOpen(true);
          setReportRefreshTrigger(prev => prev + 1);
          showToast('Report ready');
        } else if (report.status === 'failed') {
          setPendingReportId(undefined);
          showToast('Report generation failed');
          setReportRefreshTrigger(prev => prev + 1);
        } else {
          // Still processing, poll again
          pollCount++;
          if (pollCount < maxPolls) {
            setTimeout(() => pollReport(), 1000);
          } else {
            // Timeout
            setPendingReportId(undefined);
            showToast('Report generation is taking longer than expected');
            setReportRefreshTrigger(prev => prev + 1);
          }
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to poll report:', error);
          // Retry after delay
          pollCount++;
          if (pollCount < maxPolls) {
            setTimeout(() => pollReport(), 1000);
          } else {
            setPendingReportId(undefined);
            showToast('Failed to check report status');
          }
        }
      }
    };

    pollReport();

    return () => {
      isCancelled = true;
    };
  }, [pendingReportId, showToast]);

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
    <Box sx={{ backgroundColor: 'background.default', pb: 4 }}>
      {/* Header */}
      <TestRunHeader
        testRun={testRun}
        onBack={handleBack}
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
            <Tab label="Results" id="tab-results" aria-controls="tabpanel-results" />
            <Tab label="Root Cause Analysis" id="tab-rca" aria-controls="tabpanel-rca" />
            <Tab label="Reporting" id="tab-reporting" aria-controls="tabpanel-reporting" />
          </Tabs>
        </Box>

        {/* Results Tab */}
        <Box role="tabpanel" hidden={activeTab !== 0} id="tabpanel-results" aria-labelledby="tab-results">
          {activeTab === 0 && (
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
              <Box sx={cardBoxStyle(expansionState.deepLinksExpanded)}>
                <DeepLinksCard testRun={testRun} expanded={expansionState.deepLinksExpanded} onExpand={() => { const wasCollapsed = !expansionState.deepLinksExpanded; toggleExpansion('deepLinksExpanded'); if (wasCollapsed) scrollToCard('deep-links-card-expanded'); }} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.performanceExpanded)}>
                <PerformanceAnalysisCard testRunId={testRunId} testRun={testRun} realtimeTrigger={realtimeTrigger} expanded={expansionState.performanceExpanded} onExpand={() => { const wasCollapsed = !expansionState.performanceExpanded; toggleExpansion('performanceExpanded'); if (wasCollapsed) scrollToCard('performance-analysis-card-expanded'); }} showToast={showToast} hasDistributedTracing={configurationStatus.hasDistributedTracing} hasDynatrace={configurationStatus.hasDynatrace} onDrillDownToDistributedTracing={onDrillDownToDistributedTracing} onDrillDownToDynatrace={onDrillDownToDynatrace} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.sloExpanded)}>
                <ServiceLevelObjectivesSection testRun={testRun} testRunId={testRunId} sloExpanded={expansionState.sloExpanded} setSloExpanded={(val) => { const wasCollapsed = !expansionState.sloExpanded; setExpansion('sloExpanded', val); if (wasCollapsed && val) scrollToCard('slo-section-expanded'); }} hasDistributedTracing={configurationStatus.hasDistributedTracing} hasDynatrace={configurationStatus.hasDynatrace} onDrillDownToDistributedTracing={onDrillDownToDistributedTracing} onDrillDownToDynatrace={onDrillDownToDynatrace} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.anomalyExpanded)}>
                <AnomalyDetectionSection testRun={testRun} testRunId={testRunId} anomalyExpanded={expansionState.anomalyExpanded} onAnomalyExpand={onAnomalyExpand} activeTab={anomalyState.activeTab} onActiveTabChange={setAnomalyActiveTab} conclusionFilter={anomalyState.conclusionFilter} setConclusionFilter={setAnomalyConclusionFilter} showToast={showToast} onTestRunUpdate={handleTestRunUpdate} hasDistributedTracing={configurationStatus.hasDistributedTracing} hasDynatrace={configurationStatus.hasDynatrace} onDrillDownToDistributedTracing={onDrillDownToDistributedTracing} onDrillDownToDynatrace={onDrillDownToDynatrace} />
              </Box>
              <Box sx={cardBoxStyle(expansionState.eventsExpanded)}>
                <EventsCard testRun={testRun} testRunId={testRunId} expanded={expansionState.eventsExpanded} onExpand={() => { const wasCollapsed = !expansionState.eventsExpanded; toggleExpansion('eventsExpanded'); if (wasCollapsed) scrollToCard('events-card-expanded'); }} showToast={showToast} />
              </Box>
            </Box>
          )}
        </Box>

        {/* Root Cause Analysis Tab */}
        <Box role="tabpanel" hidden={activeTab !== 1} id="tabpanel-rca" aria-labelledby="tab-rca">
          {activeTab === 1 && (
            <Box sx={gridStyle}>
              <DynatraceCard testRun={testRun} expanded={expansionState.dynatraceExpanded} onExpand={() => { const wasCollapsed = !expansionState.dynatraceExpanded; toggleExpansion('dynatraceExpanded'); if (wasCollapsed) scrollToCard('dynatrace-card-expanded'); }} initialFilters={drillDownFilters.dynatrace} onConfigurationStatus={setHasDynatrace} />
              <DistributedTracingCard testRun={testRun} expanded={expansionState.distributedTracingExpanded} onExpand={() => { const wasCollapsed = !expansionState.distributedTracingExpanded; toggleExpansion('distributedTracingExpanded'); if (wasCollapsed) scrollToCard('distributed-tracing-card-expanded'); }} initialFilters={drillDownFilters.distributedTracing} onConfigurationStatus={setHasDistributedTracing} />
              {(testRun?.systems_under_test?.pyroscope_instance_id || testRun?.system_under_test?.pyroscope_instance_id) && (
                <PyroscopeCard testRun={testRun} expanded={expansionState.pyroscopeExpanded} onExpand={() => { const wasCollapsed = !expansionState.pyroscopeExpanded; toggleExpansion('pyroscopeExpanded'); if (wasCollapsed) scrollToCard('pyroscope-card-expanded'); }} />
              )}
              <Box sx={cardBoxStyle(expansionState.awrExpanded)}>
                <AwrReportCard testRun={testRun} expanded={expansionState.awrExpanded} onExpand={() => { const wasCollapsed = !expansionState.awrExpanded; toggleExpansion('awrExpanded'); if (wasCollapsed) scrollToCard('awr-report-card-expanded'); }} />
              </Box>
            </Box>
          )}
        </Box>

        {/* Reporting Tab */}
        <Box role="tabpanel" hidden={activeTab !== 2} id="tabpanel-reporting" aria-labelledby="tab-reporting">
          {activeTab === 2 && (
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
                  onSnackbar={(message, severity) => showToast(message)}
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
          )}
        </Box>
      </Box>

      {/* Snackbar */}
      <Snackbar open={snackbarOpen} autoHideDuration={4000} onClose={handleCloseSnackbar} message={snackbarMessage} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />

      {/* Generate Report Dialog */}
      {testRun && (
        <GenerateReportDialog
          open={generateReportDialogOpen}
          onClose={() => setGenerateReportDialogOpen(false)}
          testRunId={testRun.id}
          scope={{
            systemId: testRun.system_under_test?.id || testRun.system_under_test_id,
            testEnvironment: testRun.test_environment || '',
            workload: testRun.workload || '',
          }}
          onSuccess={(reportId, jobId) => {
            setGenerateReportDialogOpen(false);
            showToast('Generating report...');
            // Start polling for report completion
            setPendingReportId(reportId);
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
        onLoad={() => console.log('Report loaded')}
        onError={(error) => showToast(error)}
      />
    </Box>
  );
}
