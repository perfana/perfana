'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { DynatraceEntityMapping } from '../types';
import { fetchHostLabelOptions, updateHostLabels } from '@/lib/host-labels';

interface EditLabelsDialogProps {
  mapping: DynatraceEntityMapping | null;
  onClose: () => void;
  onSaved: (mappingId: string, labels: string[]) => void;
}

export function EditLabelsDialog({ mapping, onClose, onSaved }: EditLabelsDialogProps) {
  const [options, setOptions] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapping) return;
    setLabels(mapping.labels ?? []);
    setError(null);
    fetchHostLabelOptions().then(setOptions);
  }, [mapping]);

  const handleSave = async () => {
    if (!mapping) return;
    try {
      setSaving(true);
      setError(null);
      const saved = await updateHostLabels(mapping.id, labels);
      onSaved(mapping.id, saved);
      onClose();
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to update labels');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(mapping)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Labels for {mapping?.entityDisplayName}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Autocomplete
          multiple
          freeSolo
          autoSelect
          options={options}
          value={labels}
          onChange={(_event, value) => setLabels(value as string[])}
          renderTags={(value: readonly string[], getTagProps) =>
            value.map((option, index) => {
              // MUI supplies `key` inside the spread; React 18 wants it explicit.
              const { key, ...tagProps } = getTagProps({ index });
              return <Chip key={key} label={option} size="small" {...tagProps} />;
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              autoFocus
              variant="outlined"
              label="Labels"
              placeholder="Type to add a label"
              helperText="Pick a suggestion or type your own — new labels are reusable afterwards."
            />
          )}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
