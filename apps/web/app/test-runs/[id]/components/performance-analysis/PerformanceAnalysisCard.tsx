'use client';

import { useMemo, useRef, useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Divider,
  CircularProgress,
  Alert,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  MoreVert as MoreVertIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { DrillDownFilters } from './types/performance-analysis.types';
import { getApdexColor } from './utils/performance-formatters';
import { usePerformanceAnalysisData } from './hooks/usePerformanceAnalysisData';
import { usePerformanceAnalysisHandlers } from './hooks/usePerformanceAnalysisHandlers';
import {
  PerformanceAnalysisCollapsedView,
  TransactionsTable,
  PerformanceAnalysisDialogs,
  PerformanceAnalysisMenus,
  OverallTestMetrics,
  ScenarioFilter,
} from './components';
import {
  deriveAvailableScenarios,
  matchesSelectedScenarios,
  filterThroughputStats,
  filterVirtualUserStats,
} from './utils/scenario-filter';
import { LiveWindowSelector } from './components/LiveWindowSelector';
import Top10ListsTable from './Top10ListsTable';
import Top10ListsRequests from './Top10ListsRequests';
import Top10ListsUrls from './Top10ListsUrls';
import ErrorAnalysisCard from './ErrorAnalysisCard';
import { useEventsData } from '../events/hooks';
import { TestRun } from '@/types/test-runs';

interface PerformanceAnalysisCardProps {
  testRunId: string;
  testRun?: TestRun | null;
  expanded: boolean;
  onExpand: () => void;
  showToast: (message: string) => void;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

export default function PerformanceAnalysisCard({
  testRunId,
  testRun,
  expanded,
  onExpand,
  showToast,
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: PerformanceAnalysisCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [aggregatedSloDialogOpen, setAggregatedSloDialogOpen] = useState(false);
  const toggleScenarioFilter = useCallback((scenario: string) => {
    setSelectedScenarios((prev) =>
      prev.includes(scenario) ? prev.filter((s) => s !== scenario) : [...prev, scenario],
    );
  }, []);

  // Events data for chart annotations
  const { events } = useEventsData(testRunId);

  // Data hook
  const {
    transactions,
    loading,
    error,
    rollupPending,
    testLevelThreshold,
    virtualUserStats,
    throughputStats,
    hasExplicitThreshold,
    excludeRampUp,
    setExcludeRampUp,
    sortField,
    sortOrder,
    handleSort,
    scenarioGroups,
    expandedRows,
    rowSamples,
    loadingSamples,
    samplesError,
    handleRowClick,
    expandedScenarios,
    handleToggleScenario,
    overallApdexScore,
    poorApdexTransactions,
    refreshAll,
    isRunning,
    elapsedMinutes,
    sinceMinutes,
    setSinceMinutes,
  } = usePerformanceAnalysisData({ testRunId, testRun });

  const availableScenarios = useMemo(
    () => deriveAvailableScenarios(transactions),
    [transactions],
  );

  const filteredTransactions = useMemo(
    () => transactions.filter((t) => matchesSelectedScenarios(t.scenario_name, selectedScenarios)),
    [transactions, selectedScenarios],
  );

  const filteredScenarioGroups = useMemo<[string, typeof transactions][]>(
    () =>
      scenarioGroups.filter(([scenarioName]) =>
        selectedScenarios.length === 0 || selectedScenarios.includes(scenarioName),
      ),
    [scenarioGroups, selectedScenarios],
  );

  const filteredThroughputStats = useMemo(
    () => filterThroughputStats(throughputStats, selectedScenarios),
    [throughputStats, selectedScenarios],
  );

  const filteredVirtualUserStats = useMemo(
    () => filterVirtualUserStats(virtualUserStats, selectedScenarios),
    [virtualUserStats, selectedScenarios],
  );

  // Handlers hook
  const {
    activeTab,
    setActiveTab,
    configDialogOpen,
    setConfigDialogOpen,
    selectedTransaction,
    _handleOpenTransactionConfig,
    handleConfigSuccess,
    apdexMenuAnchor,
    handleOpenApdexMenu,
    handleCloseApdexMenu,
    thresholdDialogOpen,
    setThresholdDialogOpen,
    sloDialogOpen,
    setSloDialogOpen,
    baselineDialogOpen,
    setBaselineDialogOpen,
    thresholdsManagementDialogOpen,
    setThresholdsManagementDialogOpen,
    handleOpenThresholdDialog,
    handleOpenSloDialog,
    handleOpenBaselineDialog,
    handleOpenThresholdsManagementDialog,
    errorsModalOpen,
    setErrorsModalOpen,
    errorModalConfig,
    handleOpenTransactionErrors,
    handleOpenSamplerErrors,
    graphModalOpen,
    setGraphModalOpen,
    graphModalTransactionName,
    handleOpenGraphModal,
    actionMenuAnchor,
    actionMenuTransaction,
    handleOpenActionMenu,
    handleCloseActionMenu,
    handleConfigureApdex,
    detailsModalOpen,
    setDetailsModalOpen,
    detailsModalTransaction,
    detailsModalSamplers,
    detailsModalLoading,
    handleShowDetails,
    samplerActionMenuAnchor,
    samplerActionMenuData,
    handleOpenSamplerActionMenu,
    handleCloseSamplerActionMenu,
    handleShowSamplerDetails,
    samplerDetailsModalOpen,
    setSamplerDetailsModalOpen,
    samplerDetailsModalData,
    requestGraphModalOpen,
    setRequestGraphModalOpen,
    requestGraphModalData,
    setRequestGraphModalData,
  } = usePerformanceAnalysisHandlers({
    testRunId,
    transactions,
    excludeRampUp,
    refreshAll,
  });

  const handleExpand = () => {
    const wasCollapsed = !expanded;
    onExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="performance-analysis-card-expanded"]');
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  return (
    <Box>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={expanded ? 'performance-analysis-card-expanded' : 'performance-analysis-card-collapsed'}
        elevation={0}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: expanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: expanded ? 'none' : `3px solid ${getApdexColor(overallApdexScore)}`,
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
          p: expanded ? 2 : 3.5,
          pt: expanded ? 2 : 4,
          '&:last-child': { pb: expanded ? 2 : 3.5 }
        }}>
          {/* SECTION 1: Header */}
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            mb={2}
            sx={{
              cursor: expanded ? 'pointer' : 'inherit',
              py: expanded ? 0.5 : 0,
              borderRadius: 2,
              transition: 'all 0.2s ease',
              position: expanded ? 'sticky' : 'relative',
              ...(expanded ? { top: 0, zIndex: 10, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' } : {}),
              '&:hover': expanded ? {
                backgroundColor: 'action.hover'
              } : {}
            }}
            onClick={expanded ? handleExpand : undefined}
          >
            {expanded ? (
              <Box textAlign="center" flex="1">
                <Typography
                  variant="h5"
                  component="h2"
                  sx={{
                    fontWeight: 600,
                    color: 'text.primary',
                    fontSize: '1.25rem',
                    lineHeight: 1.2
                  }}
                >
                  Performance Analysis
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                  Click to collapse
                </Typography>
              </Box>
            ) : (
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
                Performance Analysis
              </Typography>
            )}
            {/* Toggle to exclude ramp-up time */}
            {expanded && (
              <Tooltip title="Show only the configured analysis timerange — excludes ramp-up and ramp-down periods from all statistics" arrow>
                <FormControlLabel
                  control={
                    <Switch
                      checked={excludeRampUp}
                      onChange={(e) => {
                        e.stopPropagation();
                        setExcludeRampUp(e.target.checked);
                      }}
                      size="small"
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': {
                          color: 'primary.main',
                        },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                          backgroundColor: 'primary.main',
                        },
                      }}
                    />
                  }
                  label="Analysis timerange"
                  onClick={(e) => e.stopPropagation()}
                  sx={{
                    position: 'absolute',
                    left: 16,
                    margin: 0,
                    '& .MuiFormControlLabel-label': {
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: 'text.secondary',
                    },
                  }}
                />
              </Tooltip>
            )}
            {/* Live-test controls: manual refresh + time-window selector. Anchored at
                right:96 to clear the Apdex-options menu (right:48, ~36px wide). The
                refresh button replaces the prior auto-refetch on every realtime entity
                update, which was causing visible re-renders of the whole table during
                live tests. */}
            {expanded && isRunning && (
              <Box
                sx={{ position: 'absolute', right: 96, display: 'flex', gap: 0.5, alignItems: 'center' }}
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip title="Refresh metrics" arrow>
                  <span>
                    <IconButton
                      onClick={refreshAll}
                      size="small"
                      disabled={loading}
                      sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                    >
                      {loading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
                <LiveWindowSelector
                  elapsedMinutes={elapsedMinutes}
                  sinceMinutes={sinceMinutes}
                  onChange={setSinceMinutes}
                />
              </Box>
            )}
            {/* Apdex actions menu button */}
            {expanded && (
              <Tooltip title="Apdex Options" arrow>
                <IconButton
                  onClick={handleOpenApdexMenu}
                  size="small"
                  sx={{
                    position: 'absolute',
                    right: 48,
                    width: 36,
                    height: 36,
                    backgroundColor: (theme) => `${theme.palette.secondary.main}14`,
                    color: 'secondary.main',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: (theme) => `0 2px 6px ${theme.palette.secondary.main}26`,
                    '&:hover': {
                      backgroundColor: 'secondary.main',
                      color: 'secondary.contrastText',
                      transform: 'scale(1.1)',
                      boxShadow: (theme) => `0 4px 12px ${theme.palette.secondary.main}4D`,
                    }
                  }}
                >
                  <MoreVertIcon />
                </IconButton>
              </Tooltip>
            )}
            {!expanded && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleExpand();
                }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 0,
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: `${getApdexColor(overallApdexScore)}15`,
                    color: getApdexColor(overallApdexScore),
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandMore />
              </IconButton>
            )}
            {expanded && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleExpand();
                }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 0,
                  width: 36,
                  height: 36,
                  backgroundColor: (theme) => `${theme.palette.primary.main}14`,
                  color: 'primary.main',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: (theme) => `0 2px 6px ${theme.palette.primary.main}26`,
                  '&:hover': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    transform: 'scale(1.1)',
                    boxShadow: (theme) => `0 4px 12px ${theme.palette.primary.main}4D`,
                  }
                }}
              >
                <ExpandLess />
              </IconButton>
            )}
          </Box>

          {/* Collapsed state content */}
          {!expanded && (
            <PerformanceAnalysisCollapsedView
              loading={loading}
              error={error}
              transactions={transactions}
              throughputStats={throughputStats}
              overallApdexScore={overallApdexScore}
              poorApdexTransactions={poorApdexTransactions}
              testRun={testRun}
              excludeRampUp={excludeRampUp}
              onExcludeRampUpChange={setExcludeRampUp}
              rollupPending={rollupPending}
            />
          )}

          {/* Expandable details */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />

            {/* Scenario filter — applies to all tabs */}
            {availableScenarios.length > 1 && (
              <ScenarioFilter
                availableScenarios={availableScenarios}
                selectedScenarios={selectedScenarios}
                onToggle={toggleScenarioFilter}
                totalItems={transactions.length}
                filteredItems={filteredTransactions.length}
              />
            )}

            {/* Tabs */}
            <Box sx={{ mb: 2 }}>
              <Tabs
                value={activeTab}
                onChange={(_e, newValue) => setActiveTab(newValue)}
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  '& .MuiTab-root': {
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                  },
                }}
              >
                <Tab label="Overview" />
                <Tab label="Top 10 Lists Transactions" />
                <Tab label="Top 10 Lists Requests" />
                <Tab label="Top 10 Lists URLs" />
                <Tab label="Error Analysis" />
              </Tabs>
            </Box>

            {/* Tab Panel 0: Transactions */}
            {activeTab === 0 && (
              <>
                {/* Aggregated Test Metrics — kept mounted across refreshes so the live
                    numbers update in place. The `!loading` gate from the previous
                    realtime-auto-refetch era would unmount this on every refresh. */}
                {!error && !rollupPending && filteredTransactions.length > 0 && (
                  <OverallTestMetrics
                    transactions={filteredTransactions}
                    throughputStats={filteredThroughputStats}
                    virtualUserStats={filteredVirtualUserStats}
                    testLevelThreshold={testLevelThreshold}
                  />
                )}

                {rollupPending ? (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Performance analysis becomes available once the post-test rollup
                    completes
                    {rollupPending.progress
                      ? ` — stage ${rollupPending.progress.stageIndex} of ${rollupPending.progress.totalStages}: ${rollupPending.progress.stageName}`
                      : ''}.
                    The page will refresh automatically.
                  </Alert>
                ) : loading && transactions.length === 0 ? (
                  // Page-level spinner only on the first fetch (no data yet). Subsequent
                  // refreshes flip `loading` true→false but keep the table mounted so the
                  // numbers update in place; the spinner inside the Refresh button
                  // signals the in-flight fetch.
                  <Box textAlign="center" py={4}>
                    <CircularProgress size={32} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Loading transaction data...
                    </Typography>
                  </Box>
                ) : error ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                  </Alert>
                ) : transactions.length === 0 ? (
                  <Box textAlign="center" py={4}>
                    <Typography variant="body2" color="text.secondary">
                      {testRun?.reasons_not_valid?.some(r => r.includes('ramp-up') || r.includes('steady-state'))
                        ? 'No data within the configured analysis timerange. All data points fall outside the analysis window. Adjust the ramp-up or ramp-down values in the Test Run Info card.'
                        : 'No transaction data available for this test run.'}
                    </Typography>
                  </Box>
                ) : filteredTransactions.length === 0 ? (
                  <Box textAlign="center" py={4}>
                    <Typography variant="body2" color="text.secondary">
                      No transactions match the selected scenarios.
                    </Typography>
                  </Box>
                ) : (
                  <TransactionsTable
                    scenarioGroups={filteredScenarioGroups}
                    transactions={filteredTransactions}
                    throughputStats={filteredThroughputStats}
                    virtualUserStats={filteredVirtualUserStats}
                    sortField={sortField}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                    expandedRows={expandedRows}
                    rowSamples={rowSamples}
                    loadingSamples={loadingSamples}
                    samplesError={samplesError}
                    onRowClick={handleRowClick}
                    expandedScenarios={expandedScenarios}
                    onToggleScenario={handleToggleScenario}
                    onOpenActionMenu={handleOpenActionMenu}
                    onOpenTransactionErrors={handleOpenTransactionErrors}
                    onOpenSamplerActionMenu={handleOpenSamplerActionMenu}
                    onOpenSamplerErrors={handleOpenSamplerErrors}
                  />
                )}
              </>
            )}

            {/* Tab Panel 1: Top 10 Lists Transactions */}
            {activeTab === 1 && (
              <Top10ListsTable
                testRunId={testRunId}
                selectedScenarios={selectedScenarios}
                hasDistributedTracing={hasDistributedTracing}
                hasDynatrace={hasDynatrace}
                onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
                onDrillDownToDynatrace={onDrillDownToDynatrace}
              />
            )}

            {/* Tab Panel 2: Top 10 Lists Requests */}
            {activeTab === 2 && (
              <Top10ListsRequests
                testRunId={testRunId}
                selectedScenarios={selectedScenarios}
                hasDistributedTracing={hasDistributedTracing}
                hasDynatrace={hasDynatrace}
                onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
                onDrillDownToDynatrace={onDrillDownToDynatrace}
              />
            )}

            {/* Tab Panel 3: Top 10 Lists URLs */}
            {activeTab === 3 && (
              <Top10ListsUrls testRunId={testRunId} selectedScenarios={selectedScenarios} />
            )}

            {/* Tab Panel 4: Error Analysis */}
            {activeTab === 4 && (
              <ErrorAnalysisCard testRunId={testRunId} selectedScenarios={selectedScenarios} />
            )}
          </Collapse>
        </CardContent>
      </Card>

      {/* Menus */}
      <PerformanceAnalysisMenus
        transactions={transactions}
        hasDistributedTracing={hasDistributedTracing}
        hasDynatrace={hasDynatrace}
        hasExplicitThreshold={hasExplicitThreshold}
        onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
        onDrillDownToDynatrace={onDrillDownToDynatrace}
        apdexMenuAnchor={apdexMenuAnchor}
        onCloseApdexMenu={handleCloseApdexMenu}
        onOpenThresholdDialog={handleOpenThresholdDialog}
        onOpenSloDialog={handleOpenSloDialog}
        onOpenBaselineDialog={handleOpenBaselineDialog}
        onOpenThresholdsManagementDialog={handleOpenThresholdsManagementDialog}
        onOpenAggregatedSloDialog={() => setAggregatedSloDialogOpen(true)}
        actionMenuAnchor={actionMenuAnchor}
        actionMenuTransaction={actionMenuTransaction}
        onCloseActionMenu={handleCloseActionMenu}
        onOpenGraphModal={handleOpenGraphModal}
        onConfigureApdex={handleConfigureApdex}
        onShowDetails={handleShowDetails}
        samplerActionMenuAnchor={samplerActionMenuAnchor}
        samplerActionMenuData={samplerActionMenuData}
        onCloseSamplerActionMenu={handleCloseSamplerActionMenu}
        onSetRequestGraphModalData={setRequestGraphModalData}
        onSetRequestGraphModalOpen={setRequestGraphModalOpen}
        onShowSamplerDetails={handleShowSamplerDetails}
        onOpenSamplerErrors={handleOpenSamplerErrors}
      />

      {/* Dialogs */}
      <PerformanceAnalysisDialogs
        testRunId={testRunId}
        transactions={transactions}
        testLevelThreshold={testLevelThreshold}
        showToast={showToast}
        onConfigSuccess={handleConfigSuccess}
        configDialogOpen={configDialogOpen}
        onConfigDialogClose={() => setConfigDialogOpen(false)}
        selectedTransaction={selectedTransaction}
        thresholdDialogOpen={thresholdDialogOpen}
        onThresholdDialogClose={() => setThresholdDialogOpen(false)}
        sloDialogOpen={sloDialogOpen}
        onSloDialogClose={() => setSloDialogOpen(false)}
        aggregatedSloDialogOpen={aggregatedSloDialogOpen}
        onAggregatedSloDialogClose={() => setAggregatedSloDialogOpen(false)}
        baselineDialogOpen={baselineDialogOpen}
        onBaselineDialogClose={() => setBaselineDialogOpen(false)}
        thresholdsManagementDialogOpen={thresholdsManagementDialogOpen}
        onThresholdsManagementDialogClose={() => setThresholdsManagementDialogOpen(false)}
        errorsModalOpen={errorsModalOpen}
        onErrorsModalClose={() => setErrorsModalOpen(false)}
        errorModalConfig={errorModalConfig}
        excludeRampUp={excludeRampUp}
        graphModalOpen={graphModalOpen}
        onGraphModalClose={() => setGraphModalOpen(false)}
        graphModalTransactionName={graphModalTransactionName}
        events={events}
        requestGraphModalOpen={requestGraphModalOpen}
        onRequestGraphModalClose={() => setRequestGraphModalOpen(false)}
        requestGraphModalData={requestGraphModalData}
        detailsModalOpen={detailsModalOpen}
        onDetailsModalClose={() => setDetailsModalOpen(false)}
        detailsModalTransaction={detailsModalTransaction}
        detailsModalSamplers={detailsModalSamplers}
        detailsModalLoading={detailsModalLoading}
        samplerDetailsModalOpen={samplerDetailsModalOpen}
        onSamplerDetailsModalClose={() => setSamplerDetailsModalOpen(false)}
        samplerDetailsModalData={samplerDetailsModalData}
      />
    </Box>
  );
}
