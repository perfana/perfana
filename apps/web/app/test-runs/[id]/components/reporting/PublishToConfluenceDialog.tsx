'use client';

import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Link, MenuItem, TextField, Typography,
} from '@mui/material';
import { ConfluenceConfig, ConfluencePublication, fetchConfluenceConfigs, publishReportToConfluence, safeConfluenceHref } from '@/lib/confluence';
import { getErrorMessage } from '@/lib/errors';

/**
 * Publishes one generated report to a Confluence connection. A report published before to the same
 * connection updates its page; the API decides that, so the dialog only says so.
 */
export function PublishToConfluenceDialog({
  report,
  onClose,
  onPublished,
}: {
  report: { id: string; name: string; confluence_page_url?: string | null } | null;
  onClose: () => void;
  onPublished: (reportId: string, publication: ConfluencePublication) => void;
}) {
  const [configs, setConfigs] = useState<ConfluenceConfig[] | null>(null);
  const [configId, setConfigId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<ConfluencePublication | null>(null);

  useEffect(() => {
    if (!report) return;
    setError(null);
    setPublished(null);
    setTitle('');
    setConfigs(null);
    let cancelled = false;
    fetchConfluenceConfigs()
      .then((list) => {
        if (cancelled) return;
        setConfigs(list);
        setConfigId(list[0]?.id ?? '');
      })
      .catch(() => { if (!cancelled) setConfigs([]); });
    return () => { cancelled = true; };
  }, [report]);

  const publish = async () => {
    if (!report || !configId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishReportToConfluence(report.id, configId, title);
      setPublished(result);
      onPublished(report.id, result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!report} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Publish to Confluence</DialogTitle>
      <DialogContent>
        {configs === null && <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
        {configs?.length === 0 && (
          <Alert severity="info">
            No Confluence connection is set up. Add one under <Link href="/integrations">Integrations</Link>.
          </Alert>
        )}
        {configs && configs.length > 0 && !published && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField select label="Connection" value={configId} onChange={(e) => setConfigId(e.target.value)} disabled={busy}>
              {configs.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.label} (space {c.spaceKey})</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Page title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              placeholder={report?.name}
              helperText="Defaults to the report name and test run id. Confluence titles must be unique within a space."
            />
            {safeConfluenceHref(report?.confluence_page_url) && (
              <Typography variant="body2" color="text.secondary">
                This report was published before; publishing to the same connection updates{' '}
                <Link href={safeConfluenceHref(report?.confluence_page_url)} target="_blank" rel="noopener noreferrer">that page</Link> as a new version.
              </Typography>
            )}
            {busy && (
              <Typography variant="body2" color="text.secondary">
                Rendering the charts and uploading them. A large report takes a minute.
              </Typography>
            )}
          </Box>
        )}
        {published && (
          <Alert severity="success">
            Published with {published.charts} chart{published.charts === 1 ? '' : 's'}.{' '}
            {safeConfluenceHref(published.url) && (
              <Link href={safeConfluenceHref(published.url)} target="_blank" rel="noopener noreferrer">Open the page in Confluence</Link>
            )}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{published ? 'Close' : 'Cancel'}</Button>
        {!published && (
          <Button
            variant="contained"
            onClick={publish}
            disabled={busy || !configId}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            Publish
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
