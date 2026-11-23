'use client';

// Confluence connection management for the Integrations page: one hook and its dialogs.
// ponytail: plain useState form like SplunkIntegration; the API validates every field and its
// 400 message is shown verbatim.

import { useCallback, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Switch, TextField, Typography,
} from '@mui/material';
import {
  CONFLUENCE_MASK, ConfluenceConfig, ConfluenceConfigInput, ConfluenceDeployment, createConfluenceConfig,
  deleteConfluenceConfig, fetchConfluenceConfigs, testConfluenceConnection, testSavedConfluenceConnection,
  updateConfluenceConfig,
} from '@/lib/confluence';
import type { SnackbarState } from '../types';
import { getErrorMessage } from '@/lib/errors';

interface FormState {
  label: string;
  deployment: ConfluenceDeployment;
  baseUrl: string;
  username: string;
  apiToken: string;
  spaceKey: string;
  parentPageId: string;
  useProxy: boolean;
}

const EMPTY: FormState = {
  label: '', deployment: 'datacenter', baseUrl: '', username: '', apiToken: '', spaceKey: '', parentPageId: '', useProxy: false,
};

function formFrom(c: ConfluenceConfig): FormState {
  return {
    label: c.label,
    deployment: c.deployment,
    baseUrl: c.baseUrl,
    username: c.username ?? '',
    apiToken: c.apiToken,
    spaceKey: c.spaceKey,
    parentPageId: c.parentPageId ?? '',
    useProxy: c.useProxy,
  };
}

/** What goes over the wire. A masked token is sent back as the mask, which the API reads as "unchanged". */
export function toConfluenceInput(form: FormState, organizationId?: string | null): ConfluenceConfigInput {
  return {
    label: form.label.trim(),
    deployment: form.deployment,
    baseUrl: form.baseUrl.trim(),
    username: form.deployment === 'cloud' ? form.username.trim() || null : null,
    apiToken: form.apiToken.trim(),
    spaceKey: form.spaceKey.trim(),
    parentPageId: form.parentPageId.trim() || null,
    useProxy: form.useProxy,
    ...(organizationId ? { organizationId } : {}),
  };
}

export function useConfluenceIntegration({
  onSnackbar,
  organizationId,
}: {
  onSnackbar: (s: SnackbarState) => void;
  organizationId?: string | null;
}) {
  const [configs, setConfigs] = useState<ConfluenceConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConfluenceConfig | null>(null);
  const [deleting, setDeleting] = useState<ConfluenceConfig | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setConfigs(await fetchConfluenceConfigs(organizationId));
    } catch {
      // An API that predates Confluence publishing answers 404; that is "none", not an error.
      setConfigs([]);
    }
  }, [organizationId]);

  const save = async (form: FormState) => {
    const input = toConfluenceInput(form, editing ? null : organizationId);
    if (editing) await updateConfluenceConfig(editing.id, input);
    else await createConfluenceConfig(input);
    onSnackbar({ open: true, message: `Confluence connection ${editing ? 'updated' : 'added'}`, severity: 'success' });
    setDialogOpen(false);
    setEditing(null);
    await loadConfigs();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteConfluenceConfig(deleting.id);
      onSnackbar({ open: true, message: 'Confluence connection deleted', severity: 'success' });
      await loadConfigs();
    } catch (err) {
      onSnackbar({ open: true, message: getErrorMessage(err), severity: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  return {
    configs,
    loadConfigs,
    dialogOpen,
    editing,
    deleting,
    openCreate: () => { setEditing(null); setDialogOpen(true); },
    openEdit: (c: ConfluenceConfig) => { setEditing(c); setDialogOpen(true); },
    closeDialog: () => { setDialogOpen(false); setEditing(null); },
    save,
    openDelete: setDeleting,
    closeDelete: () => setDeleting(null),
    confirmDelete,
  };
}

export function ConfluenceFormDialog({
  open,
  editing,
  organizationId,
  proxyConfigured,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: ConfluenceConfig | null;
  organizationId?: string | null;
  proxyConfigured: boolean;
  onClose: () => void;
  onSave: (form: FormState) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [openedFor, setOpenedFor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  // Reset on every open, during render: an effect would show the previous connection for a frame.
  const key = open ? editing?.id ?? 'new' : undefined;
  if (key !== openedFor) {
    setOpenedFor(key);
    setForm(editing ? formFrom(editing) : EMPTY);
    setError(null);
    setTest(null);
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const cloud = form.deployment === 'cloud';
  const urlChanged = !!editing && form.baseUrl.trim() !== editing.baseUrl;
  const masked = form.apiToken === CONFLUENCE_MASK;
  const canSave =
    !!form.label.trim() && !!form.baseUrl.trim() && !!form.apiToken.trim() && !!form.spaceKey.trim() &&
    (!cloud || !!form.username.trim()) && !(urlChanged && masked) && busy === null;

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      // A saved connection with a masked token is tested server-side with what is stored.
      if (editing && masked && !urlChanged) {
        setTest(await testSavedConfluenceConnection(editing.id));
      } else {
        const input = toConfluenceInput(form, organizationId);
        setTest(await testConfluenceConnection({
          deployment: input.deployment, baseUrl: input.baseUrl, username: input.username, apiToken: input.apiToken,
          spaceKey: input.spaceKey, useProxy: input.useProxy, ...(organizationId ? { organizationId } : {}),
        }));
      }
    } catch (err) {
      setTest({ success: false, message: getErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy('save');
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit Confluence connection' : 'Add Confluence connection'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Label" autoFocus value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g., Team wiki" />
          <TextField select label="Deployment" value={form.deployment} onChange={(e) => set('deployment', e.target.value as ConfluenceDeployment)}>
            <MenuItem value="datacenter">Data Center / Server (self-hosted, 7.9 or later)</MenuItem>
            <MenuItem value="cloud">Cloud (atlassian.net)</MenuItem>
          </TextField>
          <TextField
            label="Confluence URL"
            value={form.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder={cloud ? 'https://your-site.atlassian.net' : 'https://wiki.example.com/confluence'}
            helperText={cloud ? 'Your Atlassian site URL.' : 'The address you open Confluence at, including any path such as /confluence.'}
          />
          {cloud && (
            <TextField label="Atlassian account email" value={form.username} onChange={(e) => set('username', e.target.value)} />
          )}
          <TextField
            label={cloud ? 'API token' : 'Personal access token'}
            type="password"
            value={form.apiToken}
            onChange={(e) => set('apiToken', e.target.value)}
            // Clicking into a masked field clears it, so a half-edited mask is never sent as a token.
            onFocus={() => { if (masked) set('apiToken', ''); }}
            helperText={cloud
              ? 'Create one at id.atlassian.com → Security → API tokens.'
              : 'Create one in Confluence: your avatar → Settings → Personal Access Tokens. The account needs permission to add pages and attachments in the space.'}
          />
          {urlChanged && masked && <Alert severity="info">Changing the URL needs the token entered again.</Alert>}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="Space key" fullWidth value={form.spaceKey} onChange={(e) => set('spaceKey', e.target.value)} placeholder="PERF" />
            <TextField
              label="Parent page id (optional)"
              fullWidth
              value={form.parentPageId}
              onChange={(e) => set('parentPageId', e.target.value.replace(/\D/g, ''))}
              helperText="Reports are created under this page; empty = space root"
            />
          </Box>
          <FormControlLabel
            control={<Switch checked={form.useProxy} onChange={(e) => set('useProxy', e.target.checked)} disabled={!proxyConfigured && !form.useProxy} />}
            label={proxyConfigured ? 'Connect through the organization proxy' : 'Connect through the organization proxy (no proxy configured)'}
          />
          {test && <Alert severity={test.success ? 'success' : 'error'}>{test.message}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={runTest}
          disabled={!form.baseUrl.trim() || !form.apiToken.trim() || !form.spaceKey.trim() || busy !== null}
          startIcon={busy === 'test' ? <CircularProgress size={14} /> : undefined}
        >
          Test connection
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSave}>
          {editing ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ConfluenceDeleteDialog({ config, onClose, onConfirm }: { config: ConfluenceConfig | null; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={!!config} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Confluence connection?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Deleting <strong>{config?.label}</strong> stops publishing to it. Pages already published stay in Confluence.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Delete</Button>
      </DialogActions>
    </Dialog>
  );
}

export function ConfluenceExpandedContent({ config }: { config: ConfluenceConfig }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Connection details</Typography>
      <Typography variant="caption" color="text.secondary">Confluence URL</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all', mb: 1 }}>{config.baseUrl}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" variant="outlined" label={config.deployment === 'cloud' ? 'Cloud' : 'Data Center'} />
        <Chip size="small" variant="outlined" label={`Space: ${config.spaceKey}`} />
        {config.parentPageId && <Chip size="small" variant="outlined" label={`Under page ${config.parentPageId}`} />}
        {config.useProxy && <Chip size="small" variant="outlined" label="Via proxy" />}
      </Box>
    </Box>
  );
}
