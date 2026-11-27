'use client';

// Loki connection management for the Integrations page: one hook and its dialogs.
// A Loki connection is a Loki datasource on a Grafana instance Perfana already has; it holds no
// credentials of its own, so the form is: which Grafana, which datasource, which level label.
// ponytail: plain useState form like SplunkIntegration; the API validates and its 400 is shown verbatim.

import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, TextField, Typography,
} from '@mui/material';
import {
  LOKI_LEVEL_PARSERS, LokiConfig, LokiConnectionTest, LokiDatasource, LokiLevelParser, createLokiConfig, deleteLokiConfig, fetchLokiConfigs, fetchLokiDatasources,
  testLokiConnection, testSavedLokiConnection, updateLokiConfig,
} from '@/lib/loki';
import type { GrafanaInstance } from '@/lib/grafana-instances';
import type { SnackbarState } from '../types';
import { getErrorMessage } from '@/lib/errors';

export interface LokiFormState {
  label: string;
  grafanaInstanceId: string;
  datasourceUid: string;
  datasourceName: string;
  levelLabel: string;
  levelParser: LokiLevelParser;
  serviceLabel: string;
  maxConcurrentQueries: number;
}

const EMPTY: LokiFormState = {
  label: '', grafanaInstanceId: '', datasourceUid: '', datasourceName: '', levelLabel: 'detected_level', levelParser: 'none', serviceLabel: 'service_name', maxConcurrentQueries: 2,
};

function formFrom(c: LokiConfig): LokiFormState {
  return {
    label: c.label,
    grafanaInstanceId: c.grafanaInstanceId,
    datasourceUid: c.datasourceUid,
    datasourceName: c.datasourceName ?? '',
    levelLabel: c.levelLabel,
    levelParser: c.levelParser ?? 'none',
    serviceLabel: c.serviceLabel ?? 'service_name',
    maxConcurrentQueries: c.maxConcurrentQueries,
  };
}

export function useLokiIntegration({
  onSnackbar,
  organizationId,
}: {
  onSnackbar: (s: SnackbarState) => void;
  organizationId?: string | null;
}) {
  const [configs, setConfigs] = useState<LokiConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LokiConfig | null>(null);
  const [deleting, setDeleting] = useState<LokiConfig | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const all = await fetchLokiConfigs();
      setConfigs(organizationId ? all.filter((c) => c.organizationId === organizationId) : all);
    } catch {
      // A deploy whose API predates Loki answers 404; that is "no Loki", not an error to show.
      setConfigs([]);
    }
  }, [organizationId]);

  const save = async (form: LokiFormState) => {
    const input = {
      label: form.label.trim(),
      datasourceUid: form.datasourceUid.trim(),
      datasourceName: form.datasourceName.trim() || null,
      levelLabel: form.levelLabel.trim() || 'detected_level',
      levelParser: form.levelParser,
      serviceLabel: form.serviceLabel.trim() || 'service_name',
      maxConcurrentQueries: form.maxConcurrentQueries,
    };
    if (editing) await updateLokiConfig(editing.id, input);
    else await createLokiConfig({ ...input, grafanaInstanceId: form.grafanaInstanceId });
    onSnackbar({ open: true, message: `Loki connection ${editing ? 'updated' : 'added'}`, severity: 'success' });
    setDialogOpen(false);
    setEditing(null);
    await loadConfigs();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteLokiConfig(deleting.id);
      onSnackbar({ open: true, message: 'Loki connection deleted', severity: 'success' });
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
    openEdit: (c: LokiConfig) => { setEditing(c); setDialogOpen(true); },
    closeDialog: () => { setDialogOpen(false); setEditing(null); },
    save,
    openDelete: setDeleting,
    closeDelete: () => setDeleting(null),
    confirmDelete,
  };
}

export function LokiFormDialog({
  open,
  editing,
  grafanaInstances,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: LokiConfig | null;
  /** The organization's Grafana instances; Loki is queried through one of them. */
  grafanaInstances: GrafanaInstance[];
  onClose: () => void;
  onSave: (form: LokiFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<LokiFormState>(EMPTY);
  const [openedFor, setOpenedFor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<LokiConnectionTest | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [datasources, setDatasources] = useState<LokiDatasource[] | null>(null);
  const [datasourceError, setDatasourceError] = useState<string | null>(null);

  // Reset on every open, during render: an effect would show the previous connection for a frame.
  const key = open ? editing?.id ?? 'new' : undefined;
  if (key !== openedFor) {
    setOpenedFor(key);
    setForm(editing ? formFrom(editing) : { ...EMPTY, grafanaInstanceId: grafanaInstances.length === 1 ? grafanaInstances[0]!.id : '' });
    setError(null);
    setTest(null);
    setDatasources(null);
    setDatasourceError(null);
  }

  // The Loki datasources on the chosen Grafana. A Viewer service account can list them through
  // /api/frontend/settings; when Grafana refuses, the uid can still be typed.
  useEffect(() => {
    if (!open || !form.grafanaInstanceId) return;
    let cancelled = false;
    setDatasources(null);
    setDatasourceError(null);
    fetchLokiDatasources(form.grafanaInstanceId)
      .then((list) => {
        if (cancelled) return;
        setDatasources(list);
        if (!editing && list.length > 0) {
          setForm((f) => (f.datasourceUid ? f : {
            ...f,
            datasourceUid: (list.find((d) => d.isDefault) ?? list[0]!).uid,
            datasourceName: (list.find((d) => d.isDefault) ?? list[0]!).name,
            label: f.label || (list.find((d) => d.isDefault) ?? list[0]!).name,
          }));
        }
      })
      .catch((err) => { if (!cancelled) { setDatasources([]); setDatasourceError(getErrorMessage(err)); } });
    return () => { cancelled = true; };
  }, [open, form.grafanaInstanceId, editing]);

  const set = <K extends keyof LokiFormState>(k: K, v: LokiFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = !!form.label.trim() && !!form.grafanaInstanceId && !!form.datasourceUid.trim() && busy === null;

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      // The saved test checks the SAVED level settings, so it only stands in while the form still matches them.
      const levelLabel = form.levelLabel.trim() || 'detected_level';
      const serviceLabel = form.serviceLabel.trim() || 'service_name';
      const unchanged = editing && editing.datasourceUid === form.datasourceUid.trim() && editing.levelLabel === levelLabel
        && (editing.levelParser ?? 'none') === form.levelParser && (editing.serviceLabel ?? 'service_name') === serviceLabel;
      setTest(unchanged
        ? await testSavedLokiConnection(editing.id)
        : await testLokiConnection({
          grafanaInstanceId: form.grafanaInstanceId, datasourceUid: form.datasourceUid.trim(), levelLabel, levelParser: form.levelParser, serviceLabel,
        }));
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

  const listed = (datasources?.length ?? 0) > 0;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit Loki connection' : 'Add Loki connection'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {grafanaInstances.length === 0 && !editing ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            Perfana queries Loki through Grafana. Add the Grafana instance that has your Loki datasource first.
          </Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              select
              label="Grafana instance"
              value={form.grafanaInstanceId}
              disabled={!!editing}
              onChange={(e) => setForm((f) => ({ ...f, grafanaInstanceId: e.target.value, datasourceUid: '', datasourceName: '' }))}
              helperText={editing ? 'Fixed once saved: panels are stored under this instance.' : 'Queries run with this instance\'s credentials. A Viewer service account is enough.'}
            >
              {(editing && !grafanaInstances.some((g) => g.id === editing.grafanaInstanceId)
                ? [{ id: editing.grafanaInstanceId, label: editing.grafanaInstanceLabel ?? editing.grafanaInstanceId }]
                : grafanaInstances
              ).map((g) => <MenuItem key={g.id} value={g.id}>{g.label}</MenuItem>)}
            </TextField>
            {form.grafanaInstanceId && datasources === null && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">Looking up Loki datasources…</Typography>
              </Box>
            )}
            {listed ? (
              <TextField
                select
                label="Loki datasource"
                value={form.datasourceUid}
                onChange={(e) => {
                  const d = datasources!.find((x) => x.uid === e.target.value);
                  setForm((f) => ({ ...f, datasourceUid: e.target.value, datasourceName: d?.name ?? '' }));
                }}
              >
                {datasources!.map((d) => <MenuItem key={d.uid} value={d.uid}>{d.name}{d.isDefault ? ' (default)' : ''} · {d.uid}</MenuItem>)}
                {form.datasourceUid && !datasources!.some((d) => d.uid === form.datasourceUid) && (
                  <MenuItem value={form.datasourceUid}>{form.datasourceName || form.datasourceUid}</MenuItem>
                )}
              </TextField>
            ) : (
              <TextField
                label="Loki datasource uid"
                value={form.datasourceUid}
                onChange={(e) => set('datasourceUid', e.target.value)}
                disabled={!form.grafanaInstanceId}
                helperText={datasourceError
                  ? `Grafana did not list its datasources (${datasourceError}). Type the uid: Grafana → Connections → Data sources → Loki, the last part of the URL.`
                  : datasources?.length === 0 ? 'This Grafana lists no Loki datasource the service account may query. Type the uid if you know it.' : ' '}
              />
            )}
            <TextField label="Label" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g., Loki production" />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                select
                label="Level parser"
                sx={{ minWidth: 150 }}
                value={form.levelParser}
                onChange={(e) => set('levelParser', e.target.value as LokiLevelParser)}
                helperText={form.levelParser === 'none' ? 'Level is a label' : `| ${form.levelParser} first`}
              >
                {LOKI_LEVEL_PARSERS.map((p) => <MenuItem key={p} value={p}>{p === 'none' ? 'None (a label)' : p}</MenuItem>)}
              </TextField>
              <TextField
                label="Level label"
                fullWidth
                value={form.levelLabel}
                onChange={(e) => set('levelLabel', e.target.value)}
                helperText={form.levelParser === 'none'
                  ? "The label that holds a line's level: detected_level (Loki 3), level, severity…"
                  : `The field of the ${form.levelParser} line that holds its level: level, severity…`}
              />
              <TextField
                label="Application label"
                fullWidth
                value={form.serviceLabel}
                onChange={(e) => set('serviceLabel', e.target.value)}
                helperText="The label that names an application: service_name (Loki 3), app, container…"
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Concurrent queries"
                type="number"
                fullWidth
                value={form.maxConcurrentQueries}
                onChange={(e) => set('maxConcurrentQueries', Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                helperText="Per collection, to spare Loki's query frontend"
                slotProps={{ htmlInput: { min: 1, max: 20 } }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Log patterns need Loki 3 with the pattern ingester and Grafana 11 or later. Without them Perfana groups
              sampled error lines itself.
            </Typography>
            {test && (
              <Alert
                severity={!test.success ? 'error' : test.level === null ? 'warning' : 'success'}
                action={test.level && (test.level.parser !== form.levelParser || test.level.label !== (form.levelLabel.trim() || 'detected_level')) ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => setForm((f) => ({ ...f, levelParser: test.level!.parser, levelLabel: test.level!.label }))}
                  >
                    Use it
                  </Button>
                ) : undefined}
              >
                {test.message}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={runTest} disabled={!form.grafanaInstanceId || !form.datasourceUid.trim() || busy !== null} startIcon={busy === 'test' ? <CircularProgress size={14} /> : undefined}>
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

export function LokiDeleteDialog({ config, onClose, onConfirm }: { config: LokiConfig | null; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={!!config} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Loki connection?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Deleting <strong>{config?.label}</strong> also removes every stream mapping and Loki panel that uses it.
          Log metrics, patterns and error lines already collected for past test runs are kept.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>Delete</Button>
      </DialogActions>
    </Dialog>
  );
}

export function LokiExpandedContent({ config }: { config: LokiConfig }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Connection details</Typography>
      <Typography variant="caption" color="text.secondary">Through Grafana</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all', mb: 1 }}>
        {config.grafanaInstanceLabel ?? config.grafanaInstanceId}{config.grafanaClientUrl ? ` (${config.grafanaClientUrl})` : ''}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" variant="outlined" label={`Datasource: ${config.datasourceName ?? config.datasourceUid}`} />
        <Chip size="small" variant="outlined" label={`Level: ${config.levelParser && config.levelParser !== 'none' ? `| ${config.levelParser} → ` : ''}${config.levelLabel}`} />
        <Chip size="small" variant="outlined" label={`Application label: ${config.serviceLabel ?? 'service_name'}`} />
        <Chip size="small" variant="outlined" label={`${config.maxConcurrentQueries} concurrent queries`} />
      </Box>
    </Box>
  );
}
