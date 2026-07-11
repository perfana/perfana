'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, CircularProgress, Alert,
  Checkbox, FormControlLabel, FormGroup, List, ListItem, ListItemButton, ListItemText,
  Divider,
} from '@mui/material';
import { FileDownload as FileDownloadIcon } from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

interface TestRunRow {
  id: string;
  testRunId: string;
}

interface ExportSystemDialogProps {
  open: boolean;
  onClose: () => void;
  systemId: string;
  systemName: string;
}

export default function ExportSystemDialog({ open, onClose, systemId, systemName }: ExportSystemDialogProps) {
  const [runs, setRuns] = useState<TestRunRow[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeOptional, setIncludeOptional] = useState(true);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '100', // /test-runs caps pageSize at 100
        system: systemName,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });
      const response = await authenticatedFetch(`/test-runs?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to load test runs: ${response.statusText}`);
      }
      const data = await response.json();
      // Handle both paginated response ({ data: TestRun[], total }) and plain array (backward compat)
      const rows: TestRun[] = Array.isArray(data) ? data : (data.data ?? []);
      setRuns(rows.map((r) => ({ id: r.id, testRunId: r.test_run_id })));
      setRunsTotal(Array.isArray(data) ? rows.length : (data.total ?? rows.length));
    } catch (err) {
      setRunsError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load test runs',
      );
    } finally {
      setRunsLoading(false);
    }
  }, [systemName]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setExportError(null);
      setIncludeOptional(true);
      setIncludeRaw(false);
      fetchRuns();
    }
  }, [open, fetchRuns]);

  const toggleRun = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === runs.length ? new Set() : new Set(runs.map((r) => r.id))));
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await authenticatedFetch(`/systems-under-test/${systemId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testRunIds: Array.from(selected),
          includeOptional,
          includeRaw,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || `Export failed: ${response.statusText}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sut-${systemName}-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setExportError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to export system',
      );
    } finally {
      setExporting(false);
    }
  };

  const allSelected = runs.length > 0 && selected.size === runs.length;

  return (
    <Dialog open={open} onClose={exporting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FileDownloadIcon color="primary" />
        Export System Under Test
      </DialogTitle>

      <DialogContent>
        {runsLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {runsError && <Alert severity="error" sx={{ mb: 2 }}>{runsError}</Alert>}
        {exportError && <Alert severity="error" sx={{ mb: 2 }}>{exportError}</Alert>}

        {!runsLoading && !runsError && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Export <strong>{systemName}</strong> as a downloadable bundle. Select the test runs to include.
            </Typography>

            {runs.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No test runs found for this system.
              </Typography>
            ) : (
              <>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={allSelected}
                      indeterminate={selected.size > 0 && !allSelected}
                      onChange={toggleSelectAll}
                      disabled={exporting}
                    />
                  )}
                  label={`Select all (${runs.length})`}
                />
                {runsTotal > runs.length && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Showing the {runs.length} most recent of {runsTotal} test runs.
                  </Typography>
                )}
                <Divider sx={{ mb: 1 }} />
                <List dense sx={{ maxHeight: 240, overflowY: 'auto', mb: 2 }}>
                  {runs.map((r) => (
                    <ListItem key={r.id} disablePadding>
                      <ListItemButton onClick={() => toggleRun(r.id)} disabled={exporting} dense>
                        <Checkbox
                          edge="start"
                          checked={selected.has(r.id)}
                          tabIndex={-1}
                          disableRipple
                          size="small"
                        />
                        <ListItemText primary={r.testRunId} />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            <FormGroup sx={{ mb: 1 }}>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={includeOptional}
                    onChange={(e) => setIncludeOptional(e.target.checked)}
                    disabled={exporting}
                  />
                )}
                label="Include optional resources (events, deep links, Dynatrace, presets…)"
              />
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={includeRaw}
                    onChange={(e) => setIncludeRaw(e.target.checked)}
                    disabled={exporting}
                  />
                )}
                label="Include raw sample data (large: requests, transactions, virtual users)"
              />
            </FormGroup>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={exporting}>
          Cancel
        </Button>
        <Button
          onClick={handleExport}
          variant="contained"
          disabled={exporting || runsLoading || selected.size === 0}
        >
          {exporting ? <CircularProgress size={20} color="inherit" /> : 'Export'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
