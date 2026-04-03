'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Box, CircularProgress,
  Alert, Table, TableBody, TableCell, TableRow,
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';

interface DeletePreviewCounts {
  testRuns: number;
  applicationDashboards: number;
  benchmarks: number;
  deepLinks: number;
  events: number;
  expectedConfigChanges: number;
  tracingServices: number;
  notificationChannels: number;
  dynatraceEntityMappings: number;
  dsMetrics: number;
  dsChangePoints: number;
  dsControlGroups: number;
  checkResults: number;
  testRunConfigs: number;
  requestsRaw: number;
  transactions: number;
  apdexThresholds: number;
  graphPresets: number;
  filterPresets: number;
}

interface DeletePreviewResult {
  systemName: string;
  counts: DeletePreviewCounts;
}

interface DeleteSystemDialogProps {
  open: boolean;
  onClose: () => void;
  systemId: string;
  systemName: string;
}

const RESOURCE_LABELS: Record<keyof DeletePreviewCounts, string> = {
  testRuns: 'Test Runs',
  applicationDashboards: 'Application Dashboards',
  benchmarks: 'Service Level Objectives',
  deepLinks: 'Deep Links',
  events: 'Events',
  expectedConfigChanges: 'Expected Config Changes',
  tracingServices: 'Tracing Services',
  notificationChannels: 'Notification Channels',
  dynatraceEntityMappings: 'Dynatrace Entity Mappings',
  dsMetrics: 'Metric Data Points',
  dsChangePoints: 'Change Points',
  dsControlGroups: 'Control Groups',
  checkResults: 'Check Results',
  testRunConfigs: 'Test Run Configurations',
  requestsRaw: 'Request Data Points',
  transactions: 'Transaction Data Points',
  apdexThresholds: 'Apdex Thresholds',
  graphPresets: 'Graph Presets',
  filterPresets: 'Filter Presets',
};

export default function DeleteSystemDialog({ open, onClose, systemId, systemName }: DeleteSystemDialogProps) {
  const router = useRouter();
  const [preview, setPreview] = useState<DeletePreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await authenticatedFetch(
        `/systems-under-test/${systemId}/delete-preview`,
      );
      if (!response.ok) {
        throw new Error(`Failed to load preview: ${response.statusText}`);
      }
      const data: DeletePreviewResult = await response.json();
      setPreview(data);
    } catch (err) {
      setPreviewError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load delete preview',
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    if (open) {
      setConfirmText('');
      setDeleteError(null);
      setPreview(null);
      fetchPreview();
    }
  }, [open, fetchPreview]);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await authenticatedFetch(
        `/systems-under-test/${systemId}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || `Delete failed: ${response.statusText}`);
      }
      onClose();
      router.push('/systems');
    } catch (err) {
      setDeleteError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete system',
      );
    } finally {
      setDeleting(false);
    }
  };

  const isConfirmed = confirmText === systemName;
  const nonZeroCounts = preview
    ? (Object.entries(preview.counts) as [keyof DeletePreviewCounts, number][]).filter(([, v]) => v > 0)
    : [];
  const totalResources = nonZeroCounts.reduce((sum, [, v]) => sum + v, 0);

  return (
    <Dialog open={open} onClose={deleting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
        <WarningIcon color="error" />
        Delete System Under Test
      </DialogTitle>

      <DialogContent>
        {previewLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {previewError && <Alert severity="error" sx={{ mb: 2 }}>{previewError}</Alert>}
        {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}

        {preview && !previewLoading && (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              This will permanently delete <strong>{systemName}</strong> and all associated data.
              This action cannot be undone.
            </Alert>

            {nonZeroCounts.length > 0 ? (
              <>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  The following resources ({totalResources.toLocaleString()} total) will be deleted:
                </Typography>
                <Table size="small" sx={{ mb: 2 }}>
                  <TableBody>
                    {nonZeroCounts.map(([key, count]) => (
                      <TableRow key={key}>
                        <TableCell sx={{ py: 0.5 }}>{RESOURCE_LABELS[key]}</TableCell>
                        <TableCell align="right" sx={{ py: 0.5, fontWeight: 'bold' }}>
                          {count.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No related resources found. Only the system record itself will be deleted.
              </Typography>
            )}

            <Typography variant="body2" sx={{ mb: 1 }}>
              Type <strong>{systemName}</strong> to confirm:
            </Typography>
            <TextField
              fullWidth
              size="small"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={systemName}
              disabled={deleting}
              autoFocus
            />
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          Cancel
        </Button>
        <Button
          onClick={handleDelete}
          color="error"
          variant="contained"
          disabled={!isConfirmed || deleting || previewLoading || !!previewError}
        >
          {deleting ? <CircularProgress size={20} color="inherit" /> : 'Delete System'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
