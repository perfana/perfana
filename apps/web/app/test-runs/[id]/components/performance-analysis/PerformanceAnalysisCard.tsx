'use client';

import { useRef } from 'react';
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
} from './components';
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
  realtimeTrigger?: number;
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
  realtimeTrigger = 0,
  expanded,
  onExpand,
  showToast,
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: PerformanceAnalysisCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Events data for chart annotations
  const { events } = useEventsData(testRunId);

  // Data hook
  const {
    transactions,
    loading,
    error,
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
  } = usePerformanceAnalysisData({ testRunId, testRun, realtimeTrigger });

  // Handlers hook
  const {
    activeTab,
    setActiveTab,
    configDialogOpen,
    setConfigDialogOpen,
    selectedTransaction,
    handleOpenTransactionConfig,
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
              <Tooltip title="Exclude data during ramp-up time period from all statistics" arrow>
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
                  label="Exclude Ramp-up"
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
            {/* Live time-window selector — only shown when test is running */}
            {expanded && isRunning && (
              <Box sx={{ position: 'absolute', right: 48 }} onClick={(e) => e.stopPropagation()}>
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
            />
          )}

          {/* Expandable details */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />

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
                {/* Aggregated Test Metrics */}
                {!loading && !error && transactions.length > 0 && (
                  <OverallTestMetrics
                    transactions={transactions}
                    throughputStats={throughputStats}
                    virtualUserStats={virtualUserStats}
                    testLevelThreshold={testLevelThreshold}
                  />
                )}

                {loading ? (
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
                        ? 'No data outside the configured ramp-up period. All data points fall within the ramp-up window and are excluded from analysis. Reduce the ramp-up value in the Test Run Info card to include data.'
                        : 'No transaction data available for this test run.'}
                    </Typography>
                  </Box>
                ) : (
                  <TransactionsTable
                    scenarioGroups={scenarioGroups}
                    transactions={transactions}
                    throughputStats={throughputStats}
                    virtualUserStats={virtualUserStats}
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
                hasDistributedTracing={hasDistributedTracing}
                hasDynatrace={hasDynatrace}
                onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
                onDrillDownToDynatrace={onDrillDownToDynatrace}
              />
            )}

            {/* Tab Panel 3: Top 10 Lists URLs */}
            {activeTab === 3 && (
              <Top10ListsUrls testRunId={testRunId} />
            )}

            {/* Tab Panel 4: Error Analysis */}
            {activeTab === 4 && (
              <ErrorAnalysisCard testRunId={testRunId} />
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
        baselineDialogOpen={baselineDialogOpen}
        onBaselineDialogClose={() => setBaselineDialogOpen(false)}
        thresholdsManagementDialogOpen={thresholdsManagementDialogOpen}
        onThresholdsManagementDialogClose={() => setThresholdsManagementDialogOpen(false)}
        errorsModalOpen={errorsModalOpen}
        onErrorsModalClose={() => setErrorsModalOpen(false)}
        errorModalConfig={errorModalConfig}
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
