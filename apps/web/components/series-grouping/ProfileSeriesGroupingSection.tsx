'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import {
  compileSeriesGroupingRule,
  normalizeAggregations,
  SERIES_GROUPING_AGGREGATIONS,
  SERIES_GROUPING_PRESET_ORDER,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { getErrorMessage } from '@/lib/errors';
import { fetchGrafanaDashboardByUid } from '@/lib/grafana-dashboards';
import {
  createProfileRule,
  deleteProfileRule,
  listProfileRules,
  updateProfileRule,
  type ProfileSeriesGroupingRuleResponse,
} from '@/lib/api/series-grouping';
import { AGGREGATION_LABELS, presetLabel } from './labels';

export interface ProfileSeriesGroupingSectionProps {
  profileId: string;
  profileDashboardId: string;
  /** The profile dashboard's Grafana template, for the panel list. */
  dashboardUid: string;
  /** Scopes the uid lookup: a uid is unique only within one Grafana (root CLAUDE.md #43). */
  grafanaInstanceId?: string;
}

interface PanelOption {
  id: number;
  title: string;
}

/** Same default as the workload dialog: the pair that tells "each pod slower" from "more pods". */
const DEFAULT_AGGREGATIONS: SeriesGroupingAggregation[] = ['avg', 'count'];
const ALL_PANELS = 'all';

type FormState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; rule: ProfileSeriesGroupingRuleResponse };

/**
 * The "Series grouping" section of a profile dashboard. A rule here is a template: grafana-sync
 * writes it as a workload rule on every application dashboard built from this profile dashboard,
 * for the workload of each run the profile matches. Editing or deleting it here reaches every such
 * rule nobody has edited on the system page since; an edited one is left alone.
 *
 * There is no run to preview against, so unlike `SeriesGroupingDialog` this form only validates
 * the rule (`compileSeriesGroupingRule`, the function the API and the worker use).
 */
export default function ProfileSeriesGroupingSection({
  profileId,
  profileDashboardId,
  dashboardUid,
  grafanaInstanceId,
}: ProfileSeriesGroupingSectionProps) {
  const [rules, setRules] = useState<ProfileSeriesGroupingRuleResponse[]>([]);
  const [panels, setPanels] = useState<PanelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [deleting, setDeleting] = useState<ProfileSeriesGroupingRuleResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRules(await listProfileRules(profileId, profileDashboardId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [profileId, profileDashboardId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetchGrafanaDashboardByUid(dashboardUid, grafanaInstanceId)
      .then((row) => {
        if (cancelled) return;
        const list = ((row?.panels ?? []) as Array<{ id?: number; title?: string }>)
          .filter((p): p is { id: number; title?: string } => typeof p.id === 'number')
          .map((p) => ({ id: p.id, title: p.title || `Panel ${p.id}` }));
        setPanels(list);
      })
      // Without the list the panel picker offers "All panels" only; nothing else depends on it.
      .catch(() => !cancelled && setPanels([]));
    return () => {
      cancelled = true;
    };
  }, [dashboardUid, grafanaInstanceId]);

  const panelLabel = (panelId: number | null): string =>
    panelId === null ? 'All panels' : (panels.find((p) => p.id === panelId)?.title ?? `Panel ${panelId}`);

  const toggleEnabled = async (rule: ProfileSeriesGroupingRuleResponse) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateProfileRule(profileId, profileDashboardId, rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setNotice(
        updated.enabled
          ? 'Rule enabled here and on every system copy nobody has edited. It takes effect on the next analysis of each run.'
          : 'Rule disabled here and on every system copy nobody has edited. Runs analysed under it keep their grouped statistics until they are recalculated.',
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProfileRule(profileId, profileDashboardId, deleting.id);
      setDeleting(null);
      setNotice('Rule deleted, with every system copy nobody has edited. Runs analysed under it keep their grouped statistics until they are recalculated.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-testid="profile-series-grouping-section">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle1">Series grouping</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setForm({ mode: 'add' })}>
          Add rule
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Treat series whose names differ only by a generated part, such as a Kubernetes pod name, as one series. Each rule
        is created on the systems this profile applies to, per workload; a change here reaches every copy nobody has
        edited on the system page. Rules are saved as you change them, separately from this dialog&rsquo;s Save.
      </Typography>
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 1 }}>
          {notice}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {loading ? (
        <CircularProgress size={20} />
      ) : rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No series grouping rules.
        </Typography>
      ) : (
        <Table size="small" aria-label="Profile series grouping rules">
          <TableHead>
            <TableRow>
              <TableCell>Applies to</TableCell>
              <TableCell>Pattern</TableCell>
              <TableCell>Combine</TableCell>
              <TableCell>Enabled</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id} data-testid="profile-series-grouping-rule-row">
                <TableCell>{panelLabel(rule.panelId)}</TableCell>
                <TableCell>
                  {presetLabel(rule.preset)}
                  {rule.preset === 'custom' && rule.pattern && (
                    <Typography variant="caption" component="code" display="block" sx={{ wordBreak: 'break-all' }}>
                      {rule.pattern}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {(rule.aggregations ?? []).map((a) => (
                    <Typography key={a} variant="body2" display="block">
                      {AGGREGATION_LABELS[a] ?? a}
                    </Typography>
                  ))}
                </TableCell>
                <TableCell>
                  <Switch
                    size="small"
                    checked={rule.enabled}
                    disabled={busy}
                    onChange={() => void toggleEnabled(rule)}
                    inputProps={{ 'aria-label': `Enabled: ${presetLabel(rule.preset)}` }}
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit rule">
                    <span>
                      <IconButton size="small" aria-label="Edit rule" disabled={busy} onClick={() => setForm({ mode: 'edit', rule })}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete rule">
                    <span>
                      <IconButton size="small" aria-label="Delete rule" disabled={busy} onClick={() => setDeleting(rule)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {form.mode !== 'closed' && (
        <ProfileRuleFormDialog
          rule={form.mode === 'edit' ? form.rule : undefined}
          panels={panels}
          takenPanels={rules.filter((r) => form.mode !== 'edit' || r.id !== form.rule.id).map((r) => r.panelId)}
          onClose={() => setForm({ mode: 'closed' })}
          onSave={async (spec, panelId) => {
            if (form.mode === 'edit') {
              await updateProfileRule(profileId, profileDashboardId, form.rule.id, spec);
            } else {
              await createProfileRule(profileId, profileDashboardId, { ...spec, panelId });
            }
            setForm({ mode: 'closed' });
            setNotice(
              form.mode === 'edit'
                ? 'Rule saved here and on every system copy nobody has edited. It takes effect on the next analysis of each run.'
                : 'Rule saved. It is created on each matching system at its next tagged run, and takes effect on that run\'s analysis.',
            );
            await load();
          }}
        />
      )}

      <Dialog open={deleting !== null} onClose={busy ? undefined : () => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete series grouping rule?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The rules this profile created on systems are deleted too, except ones someone has edited there. Runs analysed
            under them keep their grouped statistics until they are recalculated.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={busy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={busy}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface ProfileRuleFormDialogProps {
  rule?: ProfileSeriesGroupingRuleResponse;
  panels: PanelOption[];
  /** Panels (null = all) that already carry a rule on this profile dashboard. */
  takenPanels: Array<number | null>;
  onClose: () => void;
  onSave: (spec: SeriesGroupingRuleSpec, panelId: number | null) => Promise<void>;
}

function ProfileRuleFormDialog({ rule, panels, takenPanels, onClose, onSave }: ProfileRuleFormDialogProps) {
  const editing = rule !== undefined;
  const [preset, setPreset] = useState<SeriesGroupingPreset>(rule?.preset ?? 'k8s-pod');
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [replacement, setReplacement] = useState(rule?.preset === 'custom' ? rule.replacement : '');
  const [aggregations, setAggregations] = useState<SeriesGroupingAggregation[]>(rule?.aggregations ?? DEFAULT_AGGREGATIONS);
  // A new rule starts on the first slot that is still free. The panel list loads asynchronously, so
  // the default is re-derived when it arrives, until the user picks a slot themselves.
  const freeSlot = (): string => {
    if (!takenPanels.includes(null)) return ALL_PANELS;
    const free = panels.find((p) => !takenPanels.includes(p.id));
    return free ? String(free.id) : ALL_PANELS;
  };
  const [panel, setPanel] = useState<string>(() =>
    rule ? (rule.panelId != null ? String(rule.panelId) : ALL_PANELS) : freeSlot(),
  );
  const [panelTouched, setPanelTouched] = useState(false);
  useEffect(() => {
    if (!rule && !panelTouched) setPanel(freeSlot());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive only when the panel list changes
  }, [panels]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selected = useMemo(() => normalizeAggregations(aggregations), [aggregations]);
  const spec: SeriesGroupingRuleSpec = useMemo(
    () => (preset === 'custom' ? { preset, pattern, replacement, aggregations: selected } : { preset, aggregations: selected }),
    [preset, pattern, replacement, selected],
  );
  const compiled = useMemo(() => compileSeriesGroupingRule(spec), [spec]);
  const panelId = panel === ALL_PANELS ? null : Number(panel);
  const slotTaken = !editing && takenPanels.includes(panelId);
  // The stored panel may be gone from the dashboard; keep it selectable so the form shows it.
  const panelOptions =
    rule?.panelId != null && !panels.some((p) => p.id === rule.panelId)
      ? [...panels, { id: rule.panelId, title: `Panel ${rule.panelId}` }]
      : panels;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(spec, panelId);
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit series grouping rule' : 'Add series grouping rule'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {saveError && <Alert severity="error">{saveError}</Alert>}
          <FormControl fullWidth size="small" disabled={editing}>
            <InputLabel id="profile-grouping-panel-label">Applies to</InputLabel>
            <Select
              labelId="profile-grouping-panel-label"
              label="Applies to"
              value={panel}
              onChange={(e) => {
                setPanelTouched(true);
                setPanel(e.target.value);
              }}
            >
              <MenuItem value={ALL_PANELS} disabled={!editing && takenPanels.includes(null)}>
                All panels{!editing && takenPanels.includes(null) ? ' (has a rule)' : ''}
              </MenuItem>
              {panelOptions.map((p) => {
                const taken = !editing && takenPanels.includes(p.id);
                return (
                  <MenuItem key={p.id} value={String(p.id)} disabled={taken}>
                    {p.title}
                    {taken ? ' (has a rule)' : ''}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          {slotTaken && (
            <Alert severity="warning">
              {panelId === null
                ? panels.length === 0
                  ? 'All panels already has a rule, and the panel list could not be loaded to offer a single panel. Edit that rule instead.'
                  : 'All panels already has a rule on this dashboard. Pick a panel, or edit that rule instead.'
                : 'This panel already has a rule on this dashboard. Edit that one instead.'}
            </Alert>
          )}
          <FormControl fullWidth size="small">
            <InputLabel id="profile-grouping-preset-label">Pattern</InputLabel>
            <Select
              labelId="profile-grouping-preset-label"
              label="Pattern"
              value={preset}
              onChange={(e) => setPreset(e.target.value as SeriesGroupingPreset)}
            >
              {[...SERIES_GROUPING_PRESET_ORDER, 'custom' as const].map((p) => (
                <MenuItem key={p} value={p}>
                  {presetLabel(p)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {preset === 'custom' && (
            <>
              <TextField
                size="small"
                label="Regular expression"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                error={Boolean(pattern) && !compiled.ok}
                helperText={pattern && !compiled.ok ? compiled.error : 'JavaScript syntax; every match is replaced'}
                inputProps={{ spellCheck: false }}
              />
              <TextField
                size="small"
                label="Replace with"
                helperText="$1 allowed; empty removes the match"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                inputProps={{ spellCheck: false }}
              />
            </>
          )}
          <FormControl component="fieldset">
            <FormLabel component="legend">Series per group</FormLabel>
            <FormGroup row>
              {SERIES_GROUPING_AGGREGATIONS.map((a) => (
                <FormControlLabel
                  key={a}
                  label={`${AGGREGATION_LABELS[a]} as "… (${a})"`}
                  control={
                    <Checkbox
                      checked={selected.includes(a)}
                      onChange={(e) =>
                        setAggregations((prev) => (e.target.checked ? [...prev, a] : prev.filter((x) => x !== a)))
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
          </FormControl>
          {!compiled.ok && preset !== 'custom' && <Alert severity="error">{compiled.error}</Alert>}
          {selected.length === 0 && <Alert severity="warning">Pick at least one series.</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={saving || !compiled.ok || selected.length === 0 || slotTaken}
        >
          {saving ? <CircularProgress size={20} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
