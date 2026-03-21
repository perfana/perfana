'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Divider,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Grid,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Timeline as TimelineIcon,
  TrendingUp as TrendingUpIcon,
  CheckCircle as CheckCircleIcon,
  Block as BlockIcon,
  ChangeHistory as ChangeHistoryIcon,
  OpenInNew as OpenInNewIcon,
  Apps as AppsIcon,
  Speed as SpeedIcon,
  Computer as ComputerIcon,
  Public as PublicIcon,
} from '@mui/icons-material';
import UnresolvedRegressionTable from './TrackedRegressionTable';
import Link from 'next/link';

interface TrackedRegression {
  id: string;
  testRunId: string;
  trackedTestRunId: string;
  metricName: string;
  dashboardLabel?: string;
  panelTitle?: string;
  unit?: string;
  testRunStart: Date;
  updatedAt: Date;
  conclusion?: any;
  trackedConclusion?: any;
  // Additional test run info
  version?: string;
  annotations?: string;
  systemUnderTest?: string;
  environment?: string;
  workload?: string;
}

interface GroupedTrackedRegressions {
  trackedTestRunId: string;
  testRunStart: string;
  regressions: TrackedRegression[];
  redetectionCount: number;
  isResolved: boolean;
  canResolve: boolean;
}

interface TrackedRegressionSectionProps {
  group: GroupedTrackedRegressions;
  onResolve: (trackedTestRunId: string, resolution: string) => void;
  onMarkChangepoint: (trackedTestRunId: string) => void;
  trendsData?: Record<string, any[]>;
}

export default function TrackedRegressionSection({
  group,
  onResolve,
  onMarkChangepoint,
  trendsData,
}: TrackedRegressionSectionProps) {
  console.log('TrackedRegressionSection debug:', {
    trackedTestRunId: group.trackedTestRunId,
    testRunStart: group.testRunStart,
    regressionsCount: group.regressions.length,
    regressionTestRunIds: group.regressions.map(r => r.testRunId),
    uniqueTestRunIds: [...new Set(group.regressions.map(r => r.testRunId))],
    regressionTrackedTestRunIds: group.regressions.map(r => r.trackedTestRunId),
    uniqueTrackedTestRunIds: [...new Set(group.regressions.map(r => r.trackedTestRunId))]
  });

  const theme = useTheme();

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: 'variability' | 'regression' | 'changepoint' | null;
    title: string;
    message: string;
  }>({
    open: false,
    action: null,
    title: '',
    message: '',
  });
  const [loading, setLoading] = useState(false);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const handleResolveClick = (action: 'variability' | 'regression' | 'changepoint') => {
    const actionLabels = {
      variability: {
        title: 'Mark as Variability',
        message: `Are you sure you want to mark test run ${group.trackedTestRunId} as variability? This will resolve all unresolved regressions from this test run.`,
      },
      regression: {
        title: 'Accept as Regression',
        message: `Are you sure you want to accept test run ${group.trackedTestRunId} as a valid regression? This will resolve all unresolved regressions from this test run.`,
      },
      changepoint: {
        title: 'Mark as Changepoint',
        message: `Are you sure you want to mark test run ${group.trackedTestRunId} as a changepoint? This will trigger a re-evaluation job and update the baseline.`,
      },
    };

    setConfirmDialog({
      open: true,
      action,
      title: actionLabels[action].title,
      message: actionLabels[action].message,
    });
  };

  const handleConfirm = async () => {
    if (!confirmDialog.action) return;

    setLoading(true);
    try {
      if (confirmDialog.action === 'changepoint') {
        await onMarkChangepoint(group.trackedTestRunId);
      } else {
        await onResolve(group.trackedTestRunId, confirmDialog.action);
      }
    } finally {
      setLoading(false);
      setConfirmDialog({ open: false, action: null, title: '', message: '' });
    }
  };

  const handleCancel = () => {
    setConfirmDialog({ open: false, action: null, title: '', message: '' });
  };

  const getStatusColor = () => {
    if (group.isResolved) return 'success';
    return 'error';
  };

  const getStatusIcon = () => {
    if (group.isResolved) return <CheckCircleIcon />;
    return <TrendingUpIcon />;
  };

  const getStatusText = () => {
    if (group.isResolved) return 'Resolved';
    return `${group.regressions.length} Active Regression${group.regressions.length !== 1 ? 's' : ''}`;
  };

  return (
    <>
      <Card
        sx={{
          border: '1px solid',
          borderColor: group.isResolved ? 'success.main' : 'error.main',
          borderRadius: 2,
          boxShadow: group.isResolved
            ? `0 2px 8px ${alpha(theme.palette.success.main, 0.15)}`
            : `0 2px 8px ${alpha(theme.palette.error.main, 0.15)}`,
          width: '100%',
        }}
      >
        <CardContent sx={{ pb: 2 }}>
          {/* Header */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                  Test Run {group.trackedTestRunId}
                </Typography>
              </Box>
            </Box>

            {/* Test Run Metadata - Simplified */}
            {group.regressions[0] && (
              <Box sx={{
                p: 2,
                backgroundColor: (t) => alpha(t.palette.text.primary, 0.02),
                borderRadius: 1,
                border: '1px solid',
                borderColor: (t) => alpha(t.palette.text.primary, 0.08),
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start'
              }}>
                <Grid container spacing={2} sx={{ flex: 1 }}>
                  <Grid item xs={12} sm={4}>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Start Date
                      </Typography>
                      <Typography variant="body2">
                        {formatDate(group.testRunStart)}
                      </Typography>
                    </Box>
                  </Grid>

                  {group.regressions[0].version && (
                    <Grid item xs={12} sm={4}>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Version
                        </Typography>
                        <Typography variant="body2">
                          {group.regressions[0].version}
                        </Typography>
                      </Box>
                    </Grid>
                  )}

                  {group.regressions[0].annotations && (
                    <Grid item xs={12} sm={group.regressions[0].version ? 4 : 8}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Annotations
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {group.regressions[0].annotations}
                        </Typography>
                      </Box>
                    </Grid>
                  )}
                </Grid>

                <Button
                  component={Link}
                  href={`/test-runs/${group.trackedTestRunId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  variant="outlined"
                  endIcon={<OpenInNewIcon fontSize="small" />}
                  sx={{
                    ml: 2,
                    flexShrink: 0,
                    borderColor: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.dark'
                    }
                  }}
                >
                  View Test Run
                </Button>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Unresolved Regressions Table */}
          <UnresolvedRegressionTable regressions={group.regressions} trendsData={trendsData} />

          {/* Resolution Controls */}
          {!group.isResolved && (
            <>
              <Divider sx={{ my: 2 }} />

              {/* Resolution explanation */}
              <Box sx={{ mb: 2, p: 1.5, backgroundColor: (t) => alpha(t.palette.secondary.main, 0.04), borderRadius: 1, border: '1px solid', borderColor: (t) => alpha(t.palette.secondary.main, 0.12) }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.primary', fontWeight: 600 }}>
                  Resolution Options:
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    • <strong style={{ color: theme.palette.error.main }}>Mark as Regression:</strong> Accept this as a valid performance degradation that needs to be addressed
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    • <strong style={{ color: theme.palette.success.main }}>Mark as Variability:</strong> Dismiss as normal performance variance, not a true regression
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    • <strong style={{ color: theme.palette.primary.main }}>Mark as Changepoint:</strong> Update the baseline to reflect an intentional performance change
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Resolve unresolved regressions:
                </Typography>

                {!group.canResolve ? (
                  <Alert severity="info" sx={{ flex: 1, ml: 2 }}>
                    <Typography variant="body2">
                      Cannot resolve: older test runs must be resolved first (chronological order)
                    </Typography>
                  </Alert>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      onClick={() => handleResolveClick('regression')}
                    >
                      Mark as Regression
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="success"
                      onClick={() => handleResolveClick('variability')}
                    >
                      Mark as Variability
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="info"
                      onClick={() => handleResolveClick('changepoint')}
                    >
                      Mark as Changepoint
                    </Button>
                  </Box>
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onClose={handleCancel} maxWidth="sm" fullWidth>
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.message}</Typography>
          {confirmDialog.action === 'changepoint' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              This will trigger a re-evaluation job that may take several minutes to complete.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} /> : null}
            color={confirmDialog.action === 'variability' ? 'warning' :
                   confirmDialog.action === 'regression' ? 'error' : 'primary'}
          >
            {loading ? 'Processing...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}