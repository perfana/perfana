'use client';

/**
 * AWR Report Card Component
 *
 * Main orchestrator component for AWR (Automatic Workload Repository) report
 * _analysis. Displays a collapsible card with upload functionality, tabbed
 * interface for different analysis views, and report management.
 *
 * Features:
 * - Collapsed view: Shows report count, severity summary, parsing status
 * - Expanded view: Upload zone, report selector, tabbed analysis interface
 * - Auto-focus on expand (per CLAUDE.md UI standards)
 * - Support for multiple reports per test run
 *
 * @example
 * ```tsx
 * <AwrReportCard
 *   testRun={testRun}
 *   expanded={expanded}
 *   onExpand={() => setExpanded(!expanded)}
 * />
 * ```
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Divider,
  CircularProgress,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Alert,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Add as AddIcon,
  Assessment as AssessmentIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import type {
  AwrReportCardProps,
  AwrTabId,
  SnackbarSeverity,
  AwrTabConfig,
} from './types';
import { useAwrReports} from './hooks/useAwrReports';
import { useAwrAnalysis } from './hooks/useAwrAnalysis';
import { deleteAwrReport } from '@/lib/api/awr-reports';
import {
  TopSqlTab,
  WaitEventsTab,
  SegmentsTab,
  InsightsTab,
  CompareTab,
} from './tabs';
import AwrUploadZone from './AwrUploadZone';
import AwrParsingStatus from './AwrParsingStatus';
import KPIDisplay from '../shared/KPIDisplay';
import SoftBadge from '../shared/SoftBadge';

// ==================== Constants ====================

const TAB_CONFIGS: AwrTabConfig[] = [
  { id: 'insights', label: 'Insights' },
  { id: 'top-sql', label: 'Top SQL' },
  { id: 'wait-events', label: 'Wait Events' },
  { id: 'segments', label: 'Segments' },
  { id: 'compare', label: 'Compare' },
];

// ==================== Main Component ====================

/**
 * AwrReportCard - Main orchestrator component for AWR report analysis
 */
export function AwrReportCard({
  testRun,
  expanded,
  onExpand,
  selectedReportId: controlledReportId,
  onReportSelect,
  initialTab = 'insights',
  className,
}: AwrReportCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Internal state for report selection if not controlled
  const [internalReportId, setInternalReportId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AwrTabId>(initialTab);
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Determine if we're controlled or uncontrolled for report selection
  const isControlled = controlledReportId !== undefined;
  const selectedReportId = isControlled ? controlledReportId : internalReportId;

  // Fetch AWR reports for this test run
  const {
    reports,
    total: totalReports,
    loading: reportsLoading,
    error: reportsError,
    refetch: refetchReports,
    invalidateCache: invalidateReportsCache,
  } = useAwrReports(testRun.id, {
    enabled: true,
    refetchInterval: expanded ? 10000 : 0, // Refetch every 10s when expanded
  });

  // Auto-select the first completed report if none selected
  const effectiveReportId = useMemo(() => {
    if (selectedReportId) return selectedReportId;
    // Find first completed report
    const completedReport = reports.find((r) => r.parseStatus === 'completed');
    return completedReport?.id || reports[0]?.id || null;
  }, [selectedReportId, reports]);

  // Fetch analysis for the selected report
  const {
    severitySummary,
    criticalCount,
    warningCount,
    infoCount,
    loading: _analysisLoading,
    hasCriticalIssues,
  } = useAwrAnalysis(effectiveReportId || '', {
    enabled: !!effectiveReportId && expanded,
  });

  // Get the selected report details
  const selectedReport = useMemo(
    () => reports.find((r) => r.id === effectiveReportId) || null,
    [reports, effectiveReportId]
  );

  // Count reports by status
  const statusCounts = useMemo(() => {
    const counts = { completed: 0, parsing: 0, pending: 0, failed: 0 };
    for (const report of reports) {
      counts[report.parseStatus]++;
    }
    return counts;
  }, [reports]);

  // Handle report selection change
  const handleReportChange = useCallback(
    (reportId: string | null) => {
      if (isControlled) {
        onReportSelect?.(reportId);
      } else {
        setInternalReportId(reportId);
      }
    },
    [isControlled, onReportSelect]
  );

  // Handle tab change
  const handleTabChange = useCallback(
    (_: React.SyntheticEvent, newValue: AwrTabId) => {
      setActiveTab(newValue);
    },
    []
  );

  // Handle expand with auto-focus
  const handleExpand = useCallback(() => {
    const wasCollapsed = !expanded;
    onExpand();

    // Auto-focus the card after expansion (only when expanding)
    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector(
          '[data-testid="awr-report-card-expanded"]'
        );
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  }, [expanded, onExpand]);

  // Handle upload success
  const handleUploadSuccess = useCallback(async () => {
    setShowUploadZone(false);
    await invalidateReportsCache();
  }, [invalidateReportsCache]);

  // Snackbar callback (to be connected to parent component)
  const handleSnackbar = useCallback(
    (message: string, severity?: SnackbarSeverity) => {
      // This would typically be connected to a parent snackbar context
      // For now, we'll just log it
      if (severity === 'error') {
        console.error('[AWR]', message);
      }
    },
    []
  );

  // Handle delete button click
  const handleDeleteClick = useCallback(() => {
    if (!selectedReport) return;

    setReportToDelete({
      id: selectedReport.id,
      name: selectedReport.fileName,
    });
    setDeleteDialogOpen(true);
  }, [selectedReport]);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (!reportToDelete) return;

    setIsDeleting(true);
    try {
      await deleteAwrReport(reportToDelete.id);
      handleSnackbar('AWR report deleted successfully', 'success');

      // Clear selection if the deleted report was selected
      if (selectedReportId === reportToDelete.id) {
        handleReportChange(null);
      }

      // Refresh the reports list
      await invalidateReportsCache();
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to delete AWR report';
      handleSnackbar(errorMessage, 'error');
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setReportToDelete(null);
    }
  }, [reportToDelete, selectedReportId, handleReportChange, invalidateReportsCache, handleSnackbar]);

  // Handle delete cancel
  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
    setReportToDelete(null);
  }, []);

  // Get accent color based on status
  const getAccentColor = (): string => {
    if (!reportsLoading && hasCriticalIssues) {
      return '#d32f2f'; // Red for critical
    }
    if (!reportsLoading && warningCount > 0) {
      return '#ff9800'; // Orange for warning
    }
    if (statusCounts.failed > 0) {
      return '#d32f2f'; // Red for failed parsing
    }
    if (statusCounts.parsing > 0 || statusCounts.pending > 0) {
      return '#1976d2'; // Blue for in-progress
    }
    return '#1976d2'; // Default blue
  };

  // Render collapsed view content
  const renderCollapsedContent = () => (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display */}
      <Box sx={{ py: 1 }}>
        <KPIDisplay
          value={reportsLoading ? '—' : reportsError ? 'Error' : totalReports}
          label="AWR Reports"
          loading={reportsLoading}
          color={totalReports === 0 ? 'neutral' : 'primary'}
        />
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'center',
        }}
      >
        {reportsLoading && <SoftBadge label="Loading..." color="blue" />}

        {!reportsLoading && !reportsError && totalReports > 0 && (
          <>
            {/* Show severity counts if analysis exists */}
            {criticalCount > 0 && (
              <SoftBadge count={criticalCount} label="critical" color="red" />
            )}
            {warningCount > 0 && (
              <SoftBadge count={warningCount} label="warnings" color="orange" />
            )}
            {infoCount > 0 && (
              <SoftBadge count={infoCount} label="info" color="blue" />
            )}

            {/* Show parsing status if any reports are pending/parsing */}
            {statusCounts.parsing > 0 && (
              <SoftBadge
                count={statusCounts.parsing}
                label="parsing"
                color="blue"
              />
            )}
            {statusCounts.pending > 0 && (
              <SoftBadge
                count={statusCounts.pending}
                label="pending"
                color="neutral"
              />
            )}
            {statusCounts.failed > 0 && (
              <SoftBadge
                count={statusCounts.failed}
                label="failed"
                color="red"
              />
            )}

            {/* If no insights yet but reports exist, show completed count */}
            {severitySummary === null &&
              statusCounts.completed > 0 &&
              statusCounts.parsing === 0 && (
                <SoftBadge
                  count={statusCounts.completed}
                  label="ready"
                  color="green"
                />
              )}
          </>
        )}

        {!reportsLoading && !reportsError && totalReports === 0 && (
          <SoftBadge label="No reports uploaded" color="neutral" />
        )}
      </Box>
    </Box>
  );

  // Render expanded view content
  const renderExpandedContent = () => (
    <Box>
      {/* Report Selector and Upload Button */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 2,
        }}
      >
        {/* Report Selector */}
        {reports.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 200, flexGrow: 1 }}>
            <InputLabel id="awr-report-select-label">Select Report</InputLabel>
            <Select
              labelId="awr-report-select-label"
              id="awr-report-select"
              value={effectiveReportId || ''}
              label="Select Report"
              onChange={(e) => handleReportChange(e.target.value || null)}
            >
              {reports.map((report) => (
                <MenuItem key={report.id} value={report.id}>
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Typography variant="body2">
                      {report.fileName}
                    </Typography>
                    {report.parseStatus !== 'completed' && (
                      <Chip
                        size="small"
                        label={report.parseStatus}
                        color={
                          report.parseStatus === 'failed'
                            ? 'error'
                            : report.parseStatus === 'parsing'
                            ? 'info'
                            : 'default'
                        }
                        sx={{ ml: 1 }}
                      />
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {/* Upload Button */}
        <Tooltip title="Upload AWR Report">
          <IconButton
            color="primary"
            onClick={() => setShowUploadZone(!showUploadZone)}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              '&:hover': { borderColor: 'primary.main' },
            }}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>

        {/* Delete Button */}
        {selectedReport && (
          <Tooltip title="Delete AWR Report">
            <IconButton
              color="error"
              onClick={handleDeleteClick}
              disabled={isDeleting}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { borderColor: 'error.main' },
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Upload Zone */}
      <Collapse in={showUploadZone || totalReports === 0}>
        <Box sx={{ mb: 2 }}>
          <AwrUploadZone
            testRunId={testRun.id}
            onUploadSuccess={handleUploadSuccess}
            onSnackbar={handleSnackbar}
            compact={totalReports > 0}
          />
        </Box>
      </Collapse>

      {/* Report Content */}
      {selectedReport && (
        <>
          {/* Parsing Status (if not completed) */}
          {selectedReport.parseStatus !== 'completed' && (
            <Box sx={{ mb: 2 }}>
              <AwrParsingStatus
                status={selectedReport.parseStatus}
                error={selectedReport.parseStatus === 'failed' ? 'Parsing failed' : undefined}
                onRetry={() => refetchReports()}
              />
            </Box>
          )}

          {/* Tabbed Interface (only if parsing completed) */}
          {selectedReport.parseStatus === 'completed' && (
            <>
              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs
                  value={activeTab}
                  onChange={handleTabChange}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label="AWR analysis tabs"
                >
                  {TAB_CONFIGS.map((tab) => (
                    <Tab
                      key={tab.id}
                      value={tab.id}
                      label={tab.label}
                      id={`awr-tab-${tab.id}`}
                      aria-controls={`awr-tabpanel-${tab.id}`}
                    />
                  ))}
                </Tabs>
              </Box>

              {/* Tab Panels */}
              <Box role="tabpanel" id={`awr-tabpanel-${activeTab}`}>
                {activeTab === 'insights' && (
                  <InsightsTab
                    reportId={effectiveReportId!}
                    testRunId={testRun.id}
                    onSnackbar={handleSnackbar}
                  />
                )}
                {activeTab === 'top-sql' && (
                  <TopSqlTab
                    reportId={effectiveReportId!}
                    testRunId={testRun.id}
                    onSnackbar={handleSnackbar}
                  />
                )}
                {activeTab === 'wait-events' && (
                  <WaitEventsTab
                    reportId={effectiveReportId!}
                    testRunId={testRun.id}
                    onSnackbar={handleSnackbar}
                  />
                )}
                {activeTab === 'segments' && (
                  <SegmentsTab
                    reportId={effectiveReportId!}
                    testRunId={testRun.id}
                    onSnackbar={handleSnackbar}
                  />
                )}
                {activeTab === 'compare' && (
                  <CompareTab
                    reportId={effectiveReportId!}
                    testRunId={testRun.id}
                    onSnackbar={handleSnackbar}
                  />
                )}
              </Box>
            </>
          )}
        </>
      )}

      {/* Loading State */}
      {reportsLoading && (
        <Box textAlign="center" py={4}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Loading AWR reports...
          </Typography>
        </Box>
      )}

      {/* Error State */}
      {reportsError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {reportsError}
        </Alert>
      )}

      {/* Empty State (no reports and not showing upload zone) */}
      {!reportsLoading && !reportsError && totalReports === 0 && !showUploadZone && (
        <Box textAlign="center" py={4}>
          <AssessmentIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography variant="body2" color="text.secondary">
            No AWR reports uploaded yet.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Upload an AWR report to start analyzing database performance.
          </Typography>
        </Box>
      )}
    </Box>
  );

  return (
    <Box className={className}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={
          expanded ? 'awr-report-card-expanded' : 'awr-report-card-collapsed'
        }
        elevation={0}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: expanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: expanded ? 'none' : `3px solid ${getAccentColor()}`,
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
          {/* Header */}
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            mb={2}
            sx={{
              position: expanded ? 'sticky' : 'relative',
              ...(expanded ? { top: 0, zIndex: 10, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' } : {}),
            }}
          >
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
              AWR Reports
            </Typography>
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
                  backgroundColor: `${getAccentColor()}15`,
                  color: getAccentColor(),
                },
                transition: 'all 0.2s ease',
              }}
            >
              {expanded ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>

          {/* Collapsed Content */}
          {!expanded && renderCollapsedContent()}

          {/* Expanded Content */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />
            {renderExpandedContent()}
          </Collapse>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">Delete AWR Report</DialogTitle>
        <DialogContent>
          <Typography id="delete-dialog-description">
            Are you sure you want to delete the AWR report <strong>{reportToDelete?.name}</strong>?
            This action cannot be undone and will remove all associated analysis data.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={isDeleting}
            autoFocus
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AwrReportCard;
