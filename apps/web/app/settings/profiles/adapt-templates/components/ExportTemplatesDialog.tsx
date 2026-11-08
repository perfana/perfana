'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { Download } from '@mui/icons-material';
import { CopyButton } from '@/components/ui/copy-button';
import { exportCompareTemplatesYaml } from '@/lib/compare-templates';

export const EXPORT_FILE_NAME = 'template_ds_compare_configs.yaml';

/**
 * Saves text as a file through a blob URL. Not `fetch()` on a `data:` URL: the CSP's `connect-src`
 * has no `data:` (apps/web/CLAUDE.md, "Never `fetch()` a `data:` URL").
 */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download only after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The install's whole `template_ds_compare_configs.yaml`, generated from the database (global
 * admin). It is shown before it is saved, because what it declares replaces the installed file.
 */
export function ExportTemplatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setYaml(null);
    setError(null);
    exportCompareTemplatesYaml()
      .then((text) => !cancelled && setYaml(text))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to export the templates file'));
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="export-templates-dialog-title">
      <DialogTitle id="export-templates-dialog-title">Export {EXPORT_FILE_NAME}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2">
          This is the whole file for this install: every ADAPT template, provisioned or created here, in every organization. Commit it in
          place of <code>{EXPORT_FILE_NAME}</code> in the provisioning directory. On the next restart the templates created here are taken
          over and become read-only, and a second restart changes nothing.
        </Typography>
        <Alert severity="warning" variant="outlined">
          Replace the file as a whole. Provisioning deletes every provisioned template a file leaves out, so a partial file would delete
          templates. The first export of a hand-written file drops its comments and reorders its keys; from then on the export is
          byte-for-byte stable.
        </Alert>
        {error && <Alert severity="error">{error}</Alert>}
        {!yaml && !error && (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={28} />
          </Box>
        )}
        {yaml !== null && (
          <Box sx={{ position: 'relative' }}>
            <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
              <CopyButton text={yaml} title="Copy the file" />
            </Box>
            <Box
              component="pre"
              data-testid="compare-templates-yaml"
              sx={{
                m: 0,
                p: 2,
                pr: 5,
                maxHeight: 360,
                overflow: 'auto',
                bgcolor: 'action.hover',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
              }}
            >
              {yaml}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<Download />} disabled={yaml === null} onClick={() => yaml !== null && downloadText(yaml, EXPORT_FILE_NAME)}>
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
}
