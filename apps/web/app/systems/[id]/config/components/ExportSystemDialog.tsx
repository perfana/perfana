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

/** The slice of the writable we use. Narrow on purpose: the full stream is awkward to fake in a test. */
type DiskSink = Pick<FileSystemWritableFileStream, 'write' | 'close' | 'abort'>;

/**
 * A cancel — the user dismissing the save dialog, or aborting the fetch — not a failure.
 * Read `name` off the value rather than gating on `instanceof Error`: jsdom's DOMException
 * does not inherit from Error, so the instanceof form makes the cancel paths untestable.
 */
function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === 'AbortError';
}

/** The picker rejects a suggestedName carrying path separators, and a SUT name is free text. */
function safeFilePart(name: string): string {
  return name.replace(/[^a-z0-9._-]/gi, '-');
}

/**
 * Ask the browser for a file to stream the bundle into, so a multi-GB export never lands in the
 * tab's heap. Chrome/Edge only; anywhere else (and in a non-secure context or a cross-origin
 * iframe) this returns null and the caller falls back to buffering a Blob.
 *
 * Must be called straight out of the click handler — the picker needs transient user activation.
 */
export async function pickDiskSink(suggestedName: string): Promise<DiskSink | null> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<DiskSink> }>;
  }).showSaveFilePicker;
  if (!picker) return null;
  const handle = await picker({
    suggestedName,
    types: [{ description: 'Gzipped NDJSON', accept: { 'application/gzip': ['.gz'] } }],
  });
  return handle.createWritable();
}

/**
 * The export is a piped gzip stream with no Content-Length, so there is no percentage to show —
 * only how much has arrived. Reading it chunk by chunk (instead of response.blob()) is what turns
 * a dialog that looks hung into one that visibly counts up.
 *
 * With a `sink` the chunks go straight to disk and nothing is retained: buffering them all and
 * then copying them into a Blob costs ~2x the bundle in tab memory, and a large run's ds_metrics
 * (always exported — it is a `core` resource, not covered by the raw-data checkbox) is enough to
 * kill the tab. fetch reports that as a bare "network error", indistinguishable from a real one.
 */
export async function readWithProgress(
  response: Response,
  onBytes: (bytes: number) => void,
  sink?: DiskSink | null,
): Promise<Blob | null> {
  if (!response.body) {
    // No streams (old browser / jsdom). With a sink already open this is not a success: the
    // picker truncated the target file at createWritable(), so returning null here would close
    // the dialog over a 0-byte file and leave the writable holding its swap file. Give the file
    // back and fail loudly instead.
    if (sink) {
      await sink.abort().catch(() => undefined);
      throw new Error('This browser cannot stream the export. Try Chrome or Edge.');
    }
    return response.blob();
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (sink) await sink.write(value);
    else chunks.push(value as BlobPart);
    total += value.byteLength;
    // ponytail: 256 kB step keeps a 1 GB export at ~4k renders instead of ~16k chunk renders.
    if (total - reported >= 256 * 1024) {
      reported = total;
      onBytes(total);
    }
  }
  onBytes(total);
  if (!sink) return new Blob(chunks);
  await sink.close();
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
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
  const [buffering, setBuffering] = useState(false);
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
      setBuffering(false);
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
    // Clear stale state BEFORE the picker: dismissing the save dialog returns early, and a
    // previous attempt's error banner would otherwise sit there describing the action just taken.
    setExportError(null);
    setExportedBytes(0);

    const filename = `sut-${safeFilePart(systemName)}-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
    // Before any await, while the click still counts as user activation.
    let sink: DiskSink | null = null;
    try {
      sink = await pickDiskSink(filename);
    } catch (err) {
      // Dismissing the save dialog is a cancel, not a failure.
      if (isAbortError(err)) return;
      // Anything else (insecure origin, cross-origin iframe, a rejected suggestedName) falls back
      // to buffering. Log it: otherwise a picker regression is indistinguishable from a tab OOM.
      console.warn('Save picker unavailable — buffering the export in memory instead', err);
      sink = null;
    }
    setBuffering(sink === null);
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting(true);
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
      const blob = await readWithProgress(response, setExportedBytes, sink);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      onClose();
    } catch (err) {
      // Close the socket, not just the file. Without this the server keeps streaming into a
      // reader that has stopped draining: no read() is outstanding, so the connection never
      // closes, res.on('close') never fires, and the export's Postgres cursor and pooled
      // connection stay held until the tab dies. A disk-full mid-write is enough to trigger it.
      controller.abort();
      // Discards the swap file. It does NOT remove the entry the picker already created, so a
      // cancelled export can still leave a 0-byte file at the chosen location.
      await sink?.abort().catch(() => undefined);
      // A cancel is a choice, not a failure — abort surfaces here as an AbortError.
      if (!isAbortError(err)) {
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
            {/* The only signal that a multi-minute export is moving rather than hung — announce it. */}
            <Typography
              variant="caption"
              color="text.secondary"
              role="status"
              aria-live="polite"
              sx={{ display: 'block', mt: 0.5 }}
            >
              {exportedBytes === 0
                ? 'Collecting data on the server… this can take a while for large test runs.'
                : `Downloading bundle… ${formatBytes(exportedBytes)} received.`}
              {' '}You can cancel at any time.
            </Typography>
            {/* Without a save picker the whole bundle is held in the tab, which is what kills a
                large export. Say so, rather than letting it fail as a bare "network error". */}
            {buffering && (
              <Alert severity="info" sx={{ mt: 1 }}>
                This browser has no save-to-disk picker, so the bundle is held in memory. For a very
                large export use Chrome or Edge, or select fewer test runs.
              </Alert>
            )}
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
