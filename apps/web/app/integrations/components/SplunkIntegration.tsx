'use client';

// Splunk connection management for the Integrations page: one hook and its dialogs.
// ponytail: plain useState form, not react-hook-form + zod like the older dialogs; the API
// validates every field and its 400 message is shown verbatim, so a second schema would only drift.

import { useCallback, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Switch, TextField, Typography,
} from '@mui/material';
import {
  SPLUNK_MASK, SplunkConfig, SplunkConfigInput, createSplunkConfig, deleteSplunkConfig,
  fetchSplunkConfigs, testSplunkConnection, testSavedSplunkConnection, updateSplunkConfig,
} from '@/lib/splunk';
import type { SnackbarState } from '../types';

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');

interface FormState {
  label: string;
  host: string;
  clientUrl: string;
  apiToken: string;
  username: string;
  password: string;
  splunkApp: string;
  useProxy: boolean;
  maxConcurrentSearches: number;
}

const EMPTY: FormState = {
  label: '', host: '', clientUrl: '', apiToken: '', username: '', password: '', splunkApp: 'search', useProxy: false,
  maxConcurrentSearches: 2,
};

function formFrom(c: SplunkConfig): FormState {
  return {
    label: c.label,
    host: c.host,
    clientUrl: c.clientUrl ?? '',
    apiToken: c.apiToken ?? '',
    username: c.username ?? '',
    password: c.password ?? '',
    splunkApp: c.splunkApp,
    useProxy: c.useProxy,
    maxConcurrentSearches: c.maxConcurrentSearches,
  };
}

/** What goes over the wire. A masked credential is sent back as the mask, which the API reads as "unchanged". */
export function toSplunkInput(form: FormState, organizationId?: string | null): SplunkConfigInput {
  return {
    label: form.label.trim(),
    host: form.host.trim(),
    clientUrl: form.clientUrl.trim() || null,
    apiToken: form.apiToken.trim() || null,
    username: form.username.trim() || null,
    password: form.password || null,
    splunkApp: form.splunkApp.trim() || 'search',
    useProxy: form.useProxy,
    maxConcurrentSearches: form.maxConcurrentSearches,
    ...(organizationId ? { organizationId } : {}),
  };
}

export function useSplunkIntegration({
  onSnackbar,
  organizationId,
}: {
  onSnackbar: (s: SnackbarState) => void;
  organizationId?: string | null;
}) {
  const [configs, setConfigs] = useState<SplunkConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SplunkConfig | null>(null);
  const [deleting, setDeleting] = useState<SplunkConfig | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const all = await fetchSplunkConfigs();
      setConfigs(organizationId ? all.filter((c) => c.organizationId === organizationId) : all);
    } catch {
      // A deploy whose API predates Splunk answers 404; that is "no Splunk", not an error to show.
      setConfigs([]);
    }
  }, [organizationId]);

  const save = async (form: FormState) => {
    const input = toSplunkInput(form, editing ? null : organizationId);
    if (editing) await updateSplunkConfig(editing.id, input);
    else await createSplunkConfig(input);
    onSnackbar({ open: true, message: `Splunk connection ${editing ? 'updated' : 'added'}`, severity: 'success' });
    setDialogOpen(false);
    setEditing(null);
    await loadConfigs();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSplunkConfig(deleting.id);
      onSnackbar({ open: true, message: 'Splunk connection deleted', severity: 'success' });
      await loadConfigs();
    } catch (err) {
      onSnackbar({ open: true, message: errorText(err), severity: 'error' });
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
    openEdit: (c: SplunkConfig) => { setEditing(c); setDialogOpen(true); },
    closeDialog: () => { setDialogOpen(false); setEditing(null); },
    save,
    openDelete: setDeleting,
    closeDelete: () => setDeleting(null),
    confirmDelete,
    organizationId,
  };
}

export function SplunkFormDialog({
  open,
  editing,
  organizationId,
  proxyConfigured,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: SplunkConfig | null;
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
  const hostChanged = !!editing && form.host.trim() !== editing.host;
  const hasCredentials = !!form.apiToken.trim() || (!!form.username.trim() && !!form.password);
  const canSave = !!form.label.trim() && !!form.host.trim() && hasCredentials && busy === null;

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      // A saved connection with masked credentials is tested server-side with what is stored.
      const masked = form.apiToken === SPLUNK_MASK || form.password === SPLUNK_MASK;
      if (editing && masked && !hostChanged) {
        setTest(await testSavedSplunkConnection(editing.id));
      } else {
        setTest(
          await testSplunkConnection({
            host: form.host.trim(),
            apiToken: form.apiToken.trim() && form.apiToken !== SPLUNK_MASK ? form.apiToken.trim() : undefined,
            username: form.username.trim() || undefined,
            password: form.password && form.password !== SPLUNK_MASK ? form.password : undefined,
            useProxy: form.useProxy,
            ...(organizationId ? { organizationId } : {}),
          }),
        );
      }
    } catch (err) {
      setTest({ success: false, message: errorText(err) });
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
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const secretProps = (k: 'apiToken' | 'password') => ({
    type: 'password' as const,
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
    // Clicking into a masked field clears it, so a half-edited mask is never sent as a credential.
    onFocus: () => { if (form[k] === SPLUNK_MASK) set(k, ''); },
  });

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit Splunk connection' : 'Add Splunk connection'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Label" autoFocus value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g., Production Splunk" />
          <TextField
            label="Management URL"
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
            placeholder="https://splunk.example.com:8089"
            helperText="The REST API port, usually 8089. Not Splunk Web on 8000."
          />
          <TextField
            label="Splunk Web URL (optional)"
            value={form.clientUrl}
            onChange={(e) => set('clientUrl', e.target.value)}
            placeholder="https://splunk.example.com"
            helperText="For “Open in Splunk” links. Defaults to the management URL."
          />
          <TextField label="Authentication token" {...secretProps('apiToken')} helperText="A Splunk authentication token. Used instead of username and password when set." />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="Username" fullWidth value={form.username} onChange={(e) => set('username', e.target.value)} />
            <TextField label="Password" fullWidth {...secretProps('password')} />
          </Box>
          {hostChanged && (
            <Alert severity="info">Changing the URL needs the token or password entered again.</Alert>
          )}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField label="App" fullWidth value={form.splunkApp} onChange={(e) => set('splunkApp', e.target.value)} helperText="Search namespace, usually “search”" />
            <TextField
              label="Concurrent searches"
              type="number"
              fullWidth
              value={form.maxConcurrentSearches}
              onChange={(e) => set('maxConcurrentSearches', Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              helperText="Keep under the token's search quota"
              slotProps={{ htmlInput: { min: 1, max: 20 } }}
            />
          </Box>
          <FormControlLabel
            control={<Switch checked={form.useProxy} onChange={(e) => set('useProxy', e.target.checked)} disabled={!proxyConfigured && !form.useProxy} />}
            label={proxyConfigured ? 'Connect through the organization proxy' : 'Connect through the organization proxy (no proxy configured)'}
          />
          <Typography variant="caption" color="text.secondary">
            On Splunk Cloud the REST API needs a paid stack, port 8089 opened through a support case, and Perfana&apos;s
            address on the <code>search-api</code> IP allow list, which is closed by default.
          </Typography>
          {test && <Alert severity={test.success ? 'success' : 'error'}>{test.message}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={runTest} disabled={!form.host.trim() || busy !== null} startIcon={busy === 'test' ? <CircularProgress size={14} /> : undefined}>
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

export function SplunkDeleteDialog({ config, onClose, onConfirm }: { config: SplunkConfig | null; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={!!config} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Splunk connection?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Deleting <strong>{config?.label}</strong> also removes every source mapping and Splunk panel that uses it.
          Log metrics already collected for past test runs are kept.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Delete</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SplunkExpandedContent({ config }: { config: SplunkConfig }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Connection details</Typography>
      <Typography variant="caption" color="text.secondary">Management URL</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all', mb: 1 }}>{config.host}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" variant="outlined" label={config.apiToken ? 'Token' : 'Username and password'} />
        <Chip size="small" variant="outlined" label={`App: ${config.splunkApp}`} />
        <Chip size="small" variant="outlined" label={`${config.maxConcurrentSearches} concurrent searches`} />
        {config.useProxy && <Chip size="small" variant="outlined" label="Via proxy" />}
      </Box>
    </Box>
  );
}
