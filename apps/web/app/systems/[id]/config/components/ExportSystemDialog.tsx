'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, CircularProgress, LinearProgress, Alert,
  Checkbox, FormControlLabel, FormGroup, List, ListItem, ListItemButton, ListItemText,
  Divider,
} from '@mui/material';
import { FileDownload as FileDownloadIcon } from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

/**
 * The export is a piped gzip stream with no Content-Length, so there is no percentage to show —
 * only how much has arrived. Reading it chunk by chunk (instead of response.blob()) is what turns
 * a dialog that looks hung into one that visibly counts up.
 */
export async function readWithProgress(response: Response, onBytes: (bytes: number) => void): Promise<Blob> {
  if (!response.body) return response.blob(); // no streams (old browser / jsdom) — fall back
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as BlobPart);
    total += value.byteLength;
    // ponytail: 256 kB step keeps a 1 GB export at ~4k renders instead of ~16k chunk renders.
    if (total - reported >= 256 * 1024) {
      reported = total;
      onBytes(total);
    }
  }
  onBytes(total);
  return new Blob(chunks);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [exportedBytes, setExportedBytes] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

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

  // Navigating away mid-export would otherwise leave the request — and the server-side cursor
  // feeding it — running until the socket happens to close.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setExportError(null);
      setExportedBytes(0);
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
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting(true);
    setExportError(null);
    setExportedBytes(0);
    try {
      const response = await authenticatedFetch(`/systems-under-test/${systemId}/export`, {
        method: 'POST',
        signal: controller.signal,
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
      const blob = await readWithProgress(response, setExportedBytes);
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
      // A cancel is a choice, not a failure — abort surfaces here as an AbortError. Read `name`
      // off the value rather than gating on `instanceof Error`: jsdom's DOMException does not
      // inherit from Error, so the instanceof form makes the cancel path untestable.
      if ((err as { name?: string } | undefined)?.name !== 'AbortError') {
        setExportError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to export system',
        );
      }
    } finally {
      abortRef.current = null;
      setExporting(false);
    }
  };

  /* Aborting closes the socket, which the API turns into a stream teardown — the server stops
     querying too, rather than finishing an export nobody is reading. */
  const handleCancel = () => {
    if (exporting) abortRef.current?.abort();
    else onClose();
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

        {exporting && (
          <Box sx={{ mb: 2 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {exportedBytes === 0
                ? 'Collecting data on the server… this can take a while for large test runs.'
                : `Downloading bundle… ${formatBytes(exportedBytes)} received.`}
              {' '}You can cancel at any time.
            </Typography>
          </Box>
        )}

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
        <Button onClick={handleCancel} color={exporting ? 'error' : 'primary'}>
          {exporting ? 'Cancel export' : 'Cancel'}
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
