'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import type { CompareTemplateScope } from '@/lib/compare-templates';

export interface CopyTarget {
  key: string;
  label: string;
  scope: CompareTemplateScope;
}

interface CopyTemplateDialogProps {
  open: boolean;
  /** Every scope but the template's own: a copy in the same scope has the same key and is refused. */
  targets: CopyTarget[];
  provisioned: boolean;
  onClose: () => void;
  /** Rejects with the server's message, which the dialog shows. */
  onCopy: (target: CopyTarget) => Promise<void>;
}

/**
 * Copies a template into another scope, where it can be edited. For a provisioned template this is
 * the only way to change it in the UI; to change it in place, edit the YAML file.
 */
export function CopyTemplateDialog({ open, targets, provisioned, onClose, onCopy }: CopyTemplateDialogProps) {
  const [targetKey, setTargetKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetKey(targets[0]?.key ?? '');
    setError(null);
  }, [open, targets]);

  const handleCopy = async () => {
    const target = targets.find((t) => t.key === targetKey);
    if (!target) return;
    setCopying(true);
    setError(null);
    try {
      await onCopy(target);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to copy the template');
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onClose={copying ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="copy-template-dialog-title">
      <DialogTitle id="copy-template-dialog-title">Copy to an editable scope</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Typography variant="body2" color="text.secondary">
          {provisioned
            ? 'A provisioned template is changed in template_ds_compare_configs.yaml. To change it here, copy it to another scope and edit the copy. '
            : ''}
          The copy must go to a different scope: in this one it would have the same dashboard, panel and metric as the template itself.
        </Typography>
        {targets.length === 0 ? (
          <Alert severity="info">There is no other scope you can copy to.</Alert>
        ) : (
          <FormControl size="small" fullWidth>
            <InputLabel id="copy-template-target-label">Copy to</InputLabel>
            <Select labelId="copy-template-target-label" label="Copy to" value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              {targets.map((t) => (
                <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={copying}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCopy}
          disabled={copying || !targetKey}
          startIcon={copying ? <CircularProgress size={16} /> : null}
        >
          Copy
        </Button>
      </DialogActions>
    </Dialog>
  );
}
