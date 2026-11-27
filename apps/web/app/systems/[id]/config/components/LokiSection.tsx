'use client';

// The system config page's Loki tab: which Loki streams belong to this system (label matchers,
// mapped at system / environment / workload level) and which log panels each workload collects.
// Spec: docs/reference/Features/Loki Log Metrics (spec).md, "Selecting Loki streams".

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormLabel, IconButton, InputLabel, MenuItem, Paper, Radio, RadioGroup,
  Select, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import {
  LOKI_MATCHER_OPS, LokiConfig, LokiMappingLevel, LokiMatcher, LokiMatcherOp, LokiPreview, LokiQuery, LokiStreamMapping,
  buildStreamSelector, createLokiMapping, createLokiQuery, createLokiStarterQueries, deleteLokiMapping, deleteLokiQuery,
  fetchLokiConfigs, fetchLokiLabelValues, fetchLokiLabels, fetchLokiMappings, fetchLokiQueries, previewLokiQuery,
  updateLokiQuery, validateLogqlPipeline, validateMatchers,
} from '@/lib/loki';
import { getErrorMessage } from '@/lib/errors';

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };

const LEVEL_LABEL: Record<LokiMappingLevel, string> = {
  sut: 'System',
  environment: 'Environment',
  workload: 'Workload',
};

interface LokiSectionProps {
  systemId: string;
  systemName: string;
  /** The system's organization: only its Loki connections may be used (the API refuses others). */
  organizationId?: string;
  selectedEnvironment?: string | null;
  selectedWorkload?: string | null;
}

export default function LokiSection({ systemId, systemName, organizationId, selectedEnvironment, selectedWorkload }: LokiSectionProps) {
  const [configs, setConfigs] = useState<LokiConfig[] | null>(null);
  const [configId, setConfigId] = useState<string>('');
  const [mappings, setMappings] = useState<LokiStreamMapping[]>([]);
  const [queries, setQueries] = useState<LokiQuery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [streamDialog, setStreamDialog] = useState(false);
  const [panelDialog, setPanelDialog] = useState<LokiQuery | 'new' | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);

  const env = selectedEnvironment ?? '';
  const workload = selectedWorkload ?? '';
  const scope = useMemo(() => ({ systemUnderTestId: systemId, testEnvironment: env, workload }), [systemId, env, workload]);

  useEffect(() => {
    fetchLokiConfigs()
      .then((all) => {
        const usable = organizationId ? all.filter((c) => c.organizationId === organizationId) : all;
        setConfigs(usable);
        // Explicit choice when there are several; only a single connection is picked for the user.
        setConfigId((current) => current || (usable.length === 1 ? usable[0]!.id : ''));
      })
      .catch((err) => {
        setConfigs([]);
        setError(getErrorMessage(err));
      });
  }, [organizationId]);

  const reload = useCallback(async () => {
    if (!env || !workload) return;
    try {
      const [m, q] = await Promise.all([fetchLokiMappings(systemId, env, workload), fetchLokiQueries(scope)]);
      setMappings(m);
      setQueries(q);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [systemId, env, workload, scope]);

  useEffect(() => { void reload(); }, [reload]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      if (done) setNotice(done);
      await reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (!env || !workload) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Typography variant="h6" gutterBottom>Loki</Typography>
        <Alert severity="info">Select an environment and a workload to configure Loki log metrics.</Alert>
      </Paper>
    );
  }

  if (configs === null) {
    return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>;
  }

  const config = configs.find((c) => c.id === configId);
  const configLabel = (id: string) => configs.find((c) => c.id === id)?.label ?? 'another connection';
  const scopedQueries = queries.filter((q) => !configId || q.lokiConfigId === configId);
  const scopedMappings = mappings.filter((m) => !configId || m.lokiConfigId === configId);

  return (
    <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h6" gutterBottom>Loki log metrics</Typography>
          <Typography variant="body2" color="text.secondary">
            Log lines from the Loki streams mapped to {systemName}, counted per time bucket for each test run of {env} · {workload}.
            The run page also keeps the run&apos;s top log patterns and latest error lines.
          </Typography>
        </Box>
        {configs.length > 1 && (
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="loki-config-label">Loki connection</InputLabel>
            <Select labelId="loki-config-label" label="Loki connection" value={configId} onChange={(e) => setConfigId(e.target.value)}>
              {configs.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
            </Select>
          </FormControl>
        )}
      </Box>

      {configs.length === 0 && !error && (
        <Alert severity="info">This organization has no Loki connection yet. Add one on the Integrations page.</Alert>
      )}
      {configs.length > 1 && !configId && <Alert severity="info">Choose the Loki connection to configure.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {configId && config && (
        <>
          {/* --- streams ------------------------------------------------------- */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, mb: 1 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>Streams</Typography>
              <Typography variant="caption" color="text.secondary">
                What <code>$entities</code> reads for a run of this workload: system-level streams, plus this environment&apos;s, plus this workload&apos;s.
              </Typography>
            </Box>
            <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => setStreamDialog(true)}>Add streams</Button>
          </Box>
          {scopedMappings.length === 0 ? (
            <Alert severity="warning" sx={{ mb: 2 }}>No Loki streams are mapped for this workload, so its panels collect nothing.</Alert>
          ) : (
            <Table size="small" sx={{ mb: 3 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Selector</TableCell>
                  <TableCell>Applies to</TableCell>
                  <TableCell>Tags</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {scopedMappings.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ ...MONO, wordBreak: 'break-word' }}>{m.selector}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={LEVEL_LABEL[m.level]} />{' '}
                      <Typography variant="caption" color="text.secondary">
                        {m.level === 'sut' ? 'every environment' : m.level === 'environment' ? m.testEnvironment : `${m.testEnvironment} · ${m.workload}`}
                      </Typography>
                    </TableCell>
                    <TableCell>{m.labels.map((l) => <Chip key={l} size="small" label={l} sx={{ mr: 0.5 }} />)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Remove these streams">
                        <IconButton size="small" aria-label={`Remove ${m.selector}`} onClick={() => run(() => deleteLokiMapping(m.id), 'Streams removed')}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* --- panels -------------------------------------------------------- */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>Panels</Typography>
              <Typography variant="caption" color="text.secondary">
                Each panel is one LogQL metric query per run, per time bucket, stored like any other metric.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => setStarterOpen(true)}>Add starter panels</Button>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setPanelDialog('new')}>Add panel</Button>
            </Box>
          </Box>
          {scopedQueries.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No panels yet. The starter panels count lines by level, error lines by service and log volume by service.
              Add the one split by <code>{config.levelLabel}</code> to get the error rate on the run page.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Panel</TableCell>
                  <TableCell>LogQL</TableCell>
                  <TableCell>Series</TableCell>
                  <TableCell>Collect</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {scopedQueries.map((q) => (
                  <TableRow key={q.id} hover>
                    <TableCell>{q.panelTitle}</TableCell>
                    <TableCell sx={{ ...MONO, maxWidth: 360, wordBreak: 'break-word' }}>{q.logql}</TableCell>
                    <TableCell sx={MONO}>{q.aggregation}{q.splitBy ? ` by ${q.splitBy}` : ''}</TableCell>
                    <TableCell>
                      <Switch
                        size="small"
                        checked={q.enabled}
                        inputProps={{ 'aria-label': `Collect ${q.panelTitle}` }}
                        onChange={(e) => run(() => updateLokiQuery(q.id, { enabled: e.target.checked }))}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton size="small" aria-label={`Edit ${q.panelTitle}`} onClick={() => setPanelDialog(q)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton
                        size="small"
                        aria-label={`Delete ${q.panelTitle}`}
                        onClick={() => run(() => deleteLokiQuery(q.id), `Deleted “${q.panelTitle}”. Metrics already collected are kept.`)}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {queries.length > scopedQueries.length && (
            <Typography variant="caption" color="text.secondary">
              {queries.length - scopedQueries.length} more panel(s) use {configLabel(queries.find((q) => q.lokiConfigId !== configId)!.lokiConfigId)}.
            </Typography>
          )}

          <AddStreamsDialog
            open={streamDialog}
            configId={configId}
            systemId={systemId}
            env={env}
            workload={workload}
            onClose={() => setStreamDialog(false)}
            onAdded={() => { setStreamDialog(false); void run(async () => undefined, 'Streams mapped'); }}
          />
          <StarterDialog
            open={starterOpen}
            levelLabel={config.levelLabel}
            configId={configId}
            onClose={() => setStarterOpen(false)}
            onCreate={(serviceLabel) => run(async () => {
              const created = await createLokiStarterQueries({ ...scope, lokiConfigId: configId, serviceLabel });
              setStarterOpen(false);
              setNotice(created.length ? `Added ${created.length} starter panel(s)` : 'The starter panels already exist');
            })}
          />
          <PanelDialog
            target={panelDialog}
            configId={configId}
            levelLabel={config.levelLabel}
            scope={scope}
            onClose={() => setPanelDialog(null)}
            onSaved={() => { setPanelDialog(null); void run(async () => undefined, 'Panel saved'); }}
          />
        </>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Add streams: build a selector from label matchers, with names and values from Loki
// ---------------------------------------------------------------------------

const emptyMatcher = (): LokiMatcher => ({ label: '', op: '=', value: '' });

function AddStreamsDialog({ open, configId, systemId, env, workload, onClose, onAdded }: {
  open: boolean; configId: string; systemId: string; env: string; workload: string;
  onClose: () => void; onAdded: () => void;
}) {
  const [labelNames, setLabelNames] = useState<string[]>([]);
  const [values, setValues] = useState<Record<number, string[]>>({});
  const [matchers, setMatchers] = useState<LokiMatcher[]>([emptyMatcher()]);
  // Environment by default: test environments usually run in their own namespace.
  const [level, setLevel] = useState<LokiMappingLevel>('environment');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadLabels = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setLabelNames(await fetchLokiLabels(configId, 24, refresh));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    if (!open) return;
    setMatchers([emptyMatcher()]); setValues({}); setLevel('environment'); setTags(''); setError(null);
    void loadLabels();
  }, [open, loadLabels]);

  const complete = matchers.filter((m) => m.label.trim());
  const problem = complete.length === 0 ? null : validateMatchers(complete);
  const selector = complete.length > 0 && !problem ? buildStreamSelector(complete) : null;

  const update = (i: number, patch: Partial<LokiMatcher>) =>
    setMatchers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  // Values of a row's label, narrowed by the other complete rows, so each pick narrows the next.
  const loadValues = async (i: number) => {
    const m = matchers[i];
    if (!m?.label.trim()) return;
    const others = matchers.filter((x, j) => j !== i && x.label.trim() && x.value && !validateMatchers([x]));
    try {
      const v = await fetchLokiLabelValues(configId, m.label.trim(), others);
      setValues((prev) => ({ ...prev, [i]: v }));
    } catch {
      setValues((prev) => ({ ...prev, [i]: [] }));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await createLokiMapping({
        lokiConfigId: configId,
        systemUnderTestId: systemId,
        level,
        testEnvironment: level === 'sut' ? null : env,
        workload: level === 'workload' ? workload : null,
        matchers: complete.map((m) => ({ label: m.label.trim(), op: m.op, value: m.value })),
        labels: tags.split(',').map((l) => l.trim()).filter(Boolean),
      });
      onAdded();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add Loki streams</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            Label names and values come from Loki over the last 24 hours. Matchers are AND-ed into one stream selector.
            Use a regex (<code>=~</code>) for pods, whose names change every deploy.
          </Typography>
          <Tooltip title="Ask Loki again (cached for 10 minutes)">
            <span><IconButton aria-label="Refresh the label list" onClick={() => loadLabels(true)} disabled={loading}><RefreshIcon /></IconButton></span>
          </Tooltip>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}>
          {matchers.map((m, i) => (
            <Box key={i} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 90px 3fr auto' }, gap: 1, alignItems: 'center' }}>
              <Autocomplete
                freeSolo
                size="small"
                options={labelNames}
                value={m.label}
                onInputChange={(_e, v) => update(i, { label: v })}
                onBlur={() => void loadValues(i)}
                renderInput={(params) => <TextField {...params} label="Label" slotProps={{ htmlInput: { ...params.inputProps, style: MONO } }} />}
              />
              <TextField select size="small" label="Op" value={m.op} onChange={(e) => update(i, { op: e.target.value as LokiMatcherOp })}>
                {LOKI_MATCHER_OPS.map((op) => <MenuItem key={op} value={op} sx={MONO}>{op}</MenuItem>)}
              </TextField>
              <Autocomplete
                freeSolo
                size="small"
                options={values[i] ?? []}
                value={m.value}
                onOpen={() => { if (!values[i]) void loadValues(i); }}
                onInputChange={(_e, v) => update(i, { value: v })}
                renderInput={(params) => <TextField {...params} label={m.op.includes('~') ? 'Regex' : 'Value'} slotProps={{ htmlInput: { ...params.inputProps, style: MONO } }} />}
              />
              <IconButton
                size="small"
                aria-label="Remove this matcher"
                disabled={matchers.length === 1}
                onClick={() => setMatchers((ms) => ms.filter((_x, j) => j !== i))}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setMatchers((ms) => [...ms, emptyMatcher()])}>Add matcher</Button>
          </Box>
        </Box>
        <Box sx={{ mt: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">Stream selector</Typography>
          <Typography sx={{ ...MONO, wordBreak: 'break-word' }}>{selector ?? '—'}</Typography>
          {problem && <Typography variant="caption" color="error">{problem}</Typography>}
        </Box>
        <FormControl sx={{ mt: 2 }}>
          <FormLabel id="loki-level-label">Applies to</FormLabel>
          <RadioGroup row aria-labelledby="loki-level-label" value={level} onChange={(e) => setLevel(e.target.value as LokiMappingLevel)}>
            <FormControlLabel value="sut" control={<Radio size="small" />} label="Every environment of this system" />
            <FormControlLabel value="environment" control={<Radio size="small" />} label={`Environment ${env}`} />
            <FormControlLabel value="workload" control={<Radio size="small" />} label={`Workload ${workload} only`} />
          </RadioGroup>
        </FormControl>
        <TextField
          size="small"
          fullWidth
          sx={{ mt: 1 }}
          label="Tags (optional, comma separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          helperText="A panel can read only tagged streams with $entities[backend]"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!selector || saving}>Add streams</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Starter panels
// ---------------------------------------------------------------------------

function StarterDialog({ open, levelLabel, configId, onClose, onCreate }: {
  open: boolean; levelLabel: string; configId: string; onClose: () => void; onCreate: (serviceLabel: string) => void;
}) {
  const [field, setField] = useState('service_name');
  const [labelNames, setLabelNames] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setField('service_name');
    fetchLokiLabels(configId).then(setLabelNames).catch(() => setLabelNames([]));
  }, [open, configId]);
  const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add starter panels</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Adds <strong>Log lines by level</strong> (split by <code>{levelLabel}</code>, the connection&apos;s level label),
          {' '}<strong>Error lines by service</strong> and <strong>Log volume by service</strong>. A panel with the same title is left alone.
        </Typography>
        <Autocomplete
          freeSolo
          options={labelNames}
          value={field}
          onInputChange={(_e, v) => setField(v)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Label that names a service"
              error={!valid}
              helperText={valid ? 'Often service_name (Loki 3), app, container or job.' : 'A Loki label name'}
              slotProps={{ htmlInput: { ...params.inputProps, style: MONO } }}
            />
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onCreate(field)}>Add panels</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a panel, with a preview over the last hour
// ---------------------------------------------------------------------------

const AGGREGATION_HELP = 'count (lines), bytes, or sum(f), avg(f), max(f), min(f), p95(f) of a number a parser extracts';

function PanelDialog({ target, configId, levelLabel, scope, onClose, onSaved }: {
  target: LokiQuery | 'new' | null;
  configId: string;
  levelLabel: string;
  scope: { systemUnderTestId: string; testEnvironment: string; workload: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target && target !== 'new' ? target : null;
  const [title, setTitle] = useState('');
  const [logql, setLogql] = useState('$entities');
  const [splitBy, setSplitBy] = useState('');
  const [aggregation, setAggregation] = useState('count');
  const [unit, setUnit] = useState('short');
  const [maxSeries, setMaxSeries] = useState(20);
  const [preview, setPreview] = useState<LokiPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setTitle(editing?.panelTitle ?? '');
    setLogql(editing?.logql ?? '$entities');
    setSplitBy(editing?.splitBy ?? '');
    setAggregation(editing?.aggregation ?? 'count');
    setUnit(editing?.metricUnit ?? 'short');
    setMaxSeries(editing?.maxSeries ?? 20);
    setPreview(null);
    setError(null);
  }, [target, editing]);

  const logqlProblem = logql.trim() ? validateLogqlPipeline(logql) : null;

  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await previewLokiQuery({
        ...scope, lokiConfigId: configId, logql, splitBy: splitBy.trim() || null, aggregation: aggregation.trim(), maxSeries, minutes: 60,
      }));
    } catch (err) {
      setError(getErrorMessage(err));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    const fields = { panelTitle: title.trim(), logql, splitBy: splitBy.trim() || null, aggregation: aggregation.trim() || 'count', metricUnit: unit.trim() || 'short', maxSeries };
    try {
      if (editing) await updateLokiQuery(editing.id, fields);
      else await createLokiQuery({ ...scope, lokiConfigId: configId, ...fields });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!target} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? `Edit “${editing.panelTitle}”` : 'Add a Loki panel'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Panel title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Timeouts by service" />
          <TextField
            label="LogQL"
            multiline
            minRows={2}
            value={logql}
            onChange={(e) => setLogql(e.target.value)}
            error={!!logqlProblem}
            helperText={logqlProblem ?? `Start with $entities, the streams mapped above, then pipeline stages: |= "timeout", | json, | ${levelLabel}="error". Perfana adds the aggregation and the time range, so leave out {…}, [5m], unwrap and count_over_time.`}
            slotProps={{ htmlInput: { style: MONO, spellCheck: false } }}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 2fr 1fr 1fr' }, gap: 2 }}>
            <TextField label="Value" value={aggregation} onChange={(e) => setAggregation(e.target.value)} helperText={AGGREGATION_HELP} slotProps={{ htmlInput: { style: MONO } }} />
            <TextField label="One series per (optional)" value={splitBy} onChange={(e) => setSplitBy(e.target.value)} helperText={`A label, e.g. ${levelLabel} or service_name`} slotProps={{ htmlInput: { style: MONO } }} />
            <TextField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            <TextField
              label="Max series"
              type="number"
              value={maxSeries}
              onChange={(e) => setMaxSeries(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              helperText="Counts beyond go to OTHER"
              slotProps={{ htmlInput: { min: 1, max: 100 } }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button variant="outlined" onClick={runPreview} disabled={!logql.trim() || !!logqlProblem || busy !== null} startIcon={busy === 'preview' ? <CircularProgress size={14} /> : undefined}>
              Preview last hour
            </Button>
            <Typography variant="caption" color="text.secondary">Runs the query once through Grafana; nothing is stored.</Typography>
          </Box>
          {preview && <PreviewResult preview={preview} onPickLabel={setSplitBy} />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!title.trim() || !logql.trim() || !!logqlProblem || busy !== null}>
          {editing ? 'Save' : 'Add panel'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PreviewResult({ preview, onPickLabel }: { preview: LokiPreview; onPickLabel: (f: string) => void }) {
  if (preview.exprs.length === 0) return <Alert severity="warning">{preview.message ?? 'Nothing to query.'}</Alert>;
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="caption" color="text.secondary">
        LogQL sent{preview.exprs.length > 1 ? ` (one per mapped selector, ${preview.exprs.length})` : ''}
      </Typography>
      {preview.exprs.map((e) => <Typography key={e} sx={{ ...MONO, mb: 0.5, wordBreak: 'break-word' }}>{e}</Typography>)}
      {preview.message || preview.series.length === 0 ? (
        <Alert severity="warning" sx={{ mt: 1 }}>{preview.message ?? 'No lines in the last hour.'}</Alert>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary">
            Series over the last hour ({preview.bucketSeconds}s buckets{preview.seriesBeforeCap && preview.seriesBeforeCap > preview.series.length ? `, ${preview.seriesBeforeCap} before the cap` : ''})
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5, mb: 1.5 }}>
            {preview.series.map((s) => <Chip key={s.name} size="small" label={`${s.name}: ${Math.round(s.total).toLocaleString()}`} />)}
          </Box>
        </>
      )}
      {preview.labels.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary">Labels Loki has (click to split by one)</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
            {preview.labels.map((l) => <Chip key={l} size="small" variant="outlined" label={l} onClick={() => onPickLabel(l)} />)}
          </Box>
        </>
      )}
    </Box>
  );
}
