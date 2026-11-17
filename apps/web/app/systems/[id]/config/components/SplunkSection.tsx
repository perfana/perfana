'use client';

// The system config page's Splunk tab: which Splunk sources belong to this system (mappings, at
// system / environment / workload level) and which log panels each workload collects.
// Spec: docs/reference/Features/Splunk Log Metrics (spec).md, "Selecting Splunk entities".

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, FormLabel, IconButton, InputLabel, MenuItem, Paper, Radio, RadioGroup,
  Select, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import {
  SplunkConfig, SplunkDiscoveredSource, SplunkEntityMapping, SplunkMappingLevel, SplunkPreview, SplunkQuery,
  buildSourceTree, createSplunkMapping, createSplunkQuery, createSplunkStarterQueries, deleteSplunkMapping,
  deleteSplunkQuery, describeMapping, discoverSplunkSources, fetchSplunkConfigs, fetchSplunkMappings,
  fetchSplunkQueries, previewSplunkQuery, updateSplunkQuery,
} from '@/lib/splunk';

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };

const LEVEL_LABEL: Record<SplunkMappingLevel, string> = {
  sut: 'System',
  environment: 'Environment',
  workload: 'Workload',
};

interface SplunkSectionProps {
  systemId: string;
  systemName: string;
  /** The system's organization: only its Splunk connections may be used (the API refuses others). */
  organizationId?: string;
  selectedEnvironment?: string | null;
  selectedWorkload?: string | null;
}

export default function SplunkSection({ systemId, systemName, organizationId, selectedEnvironment, selectedWorkload }: SplunkSectionProps) {
  const [configs, setConfigs] = useState<SplunkConfig[] | null>(null);
  const [configId, setConfigId] = useState<string>('');
  const [mappings, setMappings] = useState<SplunkEntityMapping[]>([]);
  const [queries, setQueries] = useState<SplunkQuery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceDialog, setSourceDialog] = useState(false);
  const [panelDialog, setPanelDialog] = useState<SplunkQuery | 'new' | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);

  const env = selectedEnvironment ?? '';
  const workload = selectedWorkload ?? '';
  const scope = useMemo(() => ({ systemUnderTestId: systemId, testEnvironment: env, workload }), [systemId, env, workload]);

  useEffect(() => {
    fetchSplunkConfigs()
      .then((all) => {
        const usable = organizationId ? all.filter((c) => c.organizationId === organizationId) : all;
        setConfigs(usable);
        // Explicit choice when there are several; only a single connection is picked for the user.
        setConfigId((current) => current || (usable.length === 1 ? usable[0]!.id : ''));
      })
      .catch((err) => setError(errorText(err)));
  }, [organizationId]);

  const reload = useCallback(async () => {
    if (!env || !workload) return;
    try {
      const [m, q] = await Promise.all([fetchSplunkMappings(systemId, env, workload), fetchSplunkQueries(scope)]);
      setMappings(m);
      setQueries(q);
    } catch (err) {
      setError(errorText(err));
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
      setError(errorText(err));
    }
  };

  if (!env || !workload) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Typography variant="h6" gutterBottom>Splunk</Typography>
        <Alert severity="info">Select an environment and a workload to configure Splunk log metrics.</Alert>
      </Paper>
    );
  }

  if (configs === null) {
    return <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>;
  }

  const configLabel = (id: string) => configs.find((c) => c.id === id)?.label ?? 'another connection';
  const scopedQueries = queries.filter((q) => !configId || q.splunkConfigId === configId);
  const scopedMappings = mappings.filter((m) => !configId || m.splunkConfigId === configId);

  return (
    <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h6" gutterBottom>Splunk log metrics</Typography>
          <Typography variant="body2" color="text.secondary">
            Log events from the sources mapped to {systemName}, counted per time bucket for each test run of {env} · {workload}.
          </Typography>
        </Box>
        {configs.length > 1 && (
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="splunk-config-label">Splunk connection</InputLabel>
            <Select labelId="splunk-config-label" label="Splunk connection" value={configId} onChange={(e) => setConfigId(e.target.value)}>
              {configs.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
            </Select>
          </FormControl>
        )}
      </Box>

      {configs.length === 0 && (
        <Alert severity="info">
          This organization has no Splunk connection yet. Add one on the Integrations page.
        </Alert>
      )}
      {configs.length > 1 && !configId && <Alert severity="info">Choose the Splunk connection to configure.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {configId && (
        <>
          {/* --- sources ------------------------------------------------------- */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, mb: 1 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>Sources</Typography>
              <Typography variant="caption" color="text.secondary">
                What <code>$entities</code> reads for a run of this workload: system-level sources, plus this environment&apos;s, plus this workload&apos;s.
              </Typography>
            </Box>
            <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => setSourceDialog(true)}>Add source</Button>
          </Box>
          {scopedMappings.length === 0 ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              No Splunk sources are mapped for this workload, so its panels collect nothing.
            </Alert>
          ) : (
            <Table size="small" sx={{ mb: 3 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Source</TableCell>
                  <TableCell>Applies to</TableCell>
                  <TableCell>Labels</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {scopedMappings.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell sx={MONO}>{describeMapping(m)}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={LEVEL_LABEL[m.level]} />{' '}
                      <Typography variant="caption" color="text.secondary">
                        {m.level === 'sut' ? 'every environment' : m.level === 'environment' ? m.testEnvironment : `${m.testEnvironment} · ${m.workload}`}
                      </Typography>
                    </TableCell>
                    <TableCell>{m.labels.map((l) => <Chip key={l} size="small" label={l} sx={{ mr: 0.5 }} />)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Remove this source">
                        <IconButton
                          size="small"
                          aria-label={`Remove ${describeMapping(m)}`}
                          onClick={() => run(() => deleteSplunkMapping(m.id), 'Source removed')}
                        >
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
                Each panel is one search per run, counted per time bucket and stored like any other metric.
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => setStarterOpen(true)}>Add starter panels</Button>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setPanelDialog('new')}>Add panel</Button>
            </Box>
          </Box>
          {scopedQueries.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No panels yet. The starter panels count events by log level, errors by host and exceptions by type.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Panel</TableCell>
                  <TableCell>Filter</TableCell>
                  <TableCell>Series</TableCell>
                  <TableCell>Collect</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {scopedQueries.map((q) => (
                  <TableRow key={q.id} hover>
                    <TableCell>{q.panelTitle}</TableCell>
                    <TableCell sx={{ ...MONO, maxWidth: 360, wordBreak: 'break-word' }}>{q.spl}</TableCell>
                    <TableCell sx={MONO}>{q.aggregation}{q.splitBy ? ` by ${q.splitBy}` : ''}</TableCell>
                    <TableCell>
                      <Switch
                        size="small"
                        checked={q.enabled}
                        inputProps={{ 'aria-label': `Collect ${q.panelTitle}` }}
                        onChange={(e) => run(() => updateSplunkQuery(q.id, { enabled: e.target.checked }))}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton size="small" aria-label={`Edit ${q.panelTitle}`} onClick={() => setPanelDialog(q)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton
                        size="small"
                        aria-label={`Delete ${q.panelTitle}`}
                        onClick={() => run(() => deleteSplunkQuery(q.id), `Deleted “${q.panelTitle}”. Metrics already collected are kept.`)}
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
              {queries.length - scopedQueries.length} more panel(s) use {configLabel(queries.find((q) => q.splunkConfigId !== configId)!.splunkConfigId)}.
            </Typography>
          )}

          <AddSourceDialog
            open={sourceDialog}
            configId={configId}
            systemId={systemId}
            env={env}
            workload={workload}
            onClose={() => setSourceDialog(false)}
            onAdded={() => { setSourceDialog(false); void run(async () => undefined, 'Source mapped'); }}
          />
          <StarterDialog
            open={starterOpen}
            onClose={() => setStarterOpen(false)}
            onCreate={(levelField) => run(async () => {
              const created = await createSplunkStarterQueries({ ...scope, splunkConfigId: configId, levelField });
              setStarterOpen(false);
              setNotice(created.length ? `Added ${created.length} starter panel(s)` : 'The starter panels already exist');
            })}
          />
          <PanelDialog
            target={panelDialog}
            configId={configId}
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
// Add source: pick from what Splunk has (one tstats search), or type a pattern
// ---------------------------------------------------------------------------

function AddSourceDialog({ open, configId, systemId, env, workload, onClose, onAdded }: {
  open: boolean; configId: string; systemId: string; env: string; workload: string;
  onClose: () => void; onAdded: () => void;
}) {
  const [sources, setSources] = useState<SplunkDiscoveredSource[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [indexName, setIndexName] = useState('');
  const [sourcetype, setSourcetype] = useState('');
  const [hostPattern, setHostPattern] = useState('');
  // Environment by default: test environments usually have their own hosts and workloads share them.
  const [level, setLevel] = useState<SplunkMappingLevel>('environment');
  const [labels, setLabels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const discover = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setSources(await discoverSplunkSources(configId, 24, refresh));
    } catch (err) {
      setError(errorText(err));
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, [configId]);

  useEffect(() => {
    if (!open) return;
    setFilter(''); setIndexName(''); setSourcetype(''); setHostPattern(''); setLevel('environment'); setLabels(''); setError(null);
    void discover();
  }, [open, discover]);

  const tree = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matching = (sources ?? []).filter((s) => !f || `${s.index} ${s.sourcetype} ${s.host}`.toLowerCase().includes(f));
    return buildSourceTree(matching);
  }, [sources, filter]);

  const pick = (index: string, st = '', host = '') => { setIndexName(index); setSourcetype(st); setHostPattern(host); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await createSplunkMapping({
        splunkConfigId: configId,
        systemUnderTestId: systemId,
        level,
        testEnvironment: level === 'sut' ? null : env,
        workload: level === 'workload' ? workload : null,
        indexName: indexName.trim(),
        sourcetype: sourcetype.trim() || null,
        hostPattern: hostPattern.trim() || null,
        labels: labels.split(',').map((l) => l.trim()).filter(Boolean),
      });
      onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add a Splunk source</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, mb: 1 }}>
          <TextField size="small" fullWidth label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="index, sourcetype or host" />
          <Tooltip title="Ask Splunk again (the list is cached for 10 minutes)">
            <span>
              <IconButton aria-label="Refresh the source list" onClick={() => discover(true)} disabled={loading}><RefreshIcon /></IconButton>
            </span>
          </Tooltip>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Event counts over the last 24 hours, from the indexes the connection&apos;s token may search. Click a row to fill in the source below.
        </Typography>
        <Box sx={{ maxHeight: 280, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, my: 1 }}>
          {loading && <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} /></Box>}
          {!loading && tree.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {sources?.length ? 'Nothing matches the filter.' : 'Splunk returned no sources. You can still type one below.'}
            </Typography>
          )}
          {!loading && tree.map((ix) => (
            <Box key={ix.index}>
              <SourceRow depth={0} label={`index=${ix.index}`} count={ix.count} onClick={() => pick(ix.index)} />
              {ix.sourcetypes.map((st) => (
                <Box key={st.sourcetype}>
                  <SourceRow depth={1} label={`sourcetype=${st.sourcetype}`} count={st.count} onClick={() => pick(ix.index, st.sourcetype)} />
                  {st.hosts.map((h) => (
                    <SourceRow key={h.host} depth={2} label={`host=${h.host}`} count={h.count} onClick={() => pick(ix.index, st.sourcetype, h.host)} />
                  ))}
                </Box>
              ))}
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mt: 2 }}>
          <TextField size="small" label="Index" required value={indexName} onChange={(e) => setIndexName(e.target.value)} slotProps={{ htmlInput: { style: MONO } }} />
          <TextField size="small" label="Sourcetype (optional)" value={sourcetype} onChange={(e) => setSourcetype(e.target.value)} slotProps={{ htmlInput: { style: MONO } }} />
          <TextField
            size="small"
            label="Host or pattern (optional)"
            value={hostPattern}
            onChange={(e) => setHostPattern(e.target.value)}
            helperText="Wildcards work: app-*. Use one for pods, whose names change every deploy."
            slotProps={{ htmlInput: { style: MONO } }}
          />
        </Box>
        <FormControl sx={{ mt: 2 }}>
          <FormLabel id="splunk-level-label">Applies to</FormLabel>
          <RadioGroup row aria-labelledby="splunk-level-label" value={level} onChange={(e) => setLevel(e.target.value as SplunkMappingLevel)}>
            <FormControlLabel value="sut" control={<Radio size="small" />} label="Every environment of this system" />
            <FormControlLabel value="environment" control={<Radio size="small" />} label={`Environment ${env}`} />
            <FormControlLabel value="workload" control={<Radio size="small" />} label={`Workload ${workload} only`} />
          </RadioGroup>
        </FormControl>
        <TextField
          size="small"
          fullWidth
          sx={{ mt: 1 }}
          label="Labels (optional, comma separated)"
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
          helperText="A panel can read only labelled sources with $entities[backend]"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!indexName.trim() || saving}>Add source</Button>
      </DialogActions>
    </Dialog>
  );
}

function SourceRow({ depth, label, count, onClick }: { depth: number; label: string; count: number; onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'flex', width: '100%', justifyContent: 'space-between', gap: 2, border: 0, bgcolor: 'transparent',
        color: 'text.primary', textAlign: 'left', cursor: 'pointer', py: 0.5, pr: 1.5, pl: 1.5 + depth * 2.5,
        '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
      }}
    >
      <Typography component="span" sx={{ ...MONO, fontWeight: depth === 0 ? 600 : 400 }}>{label}</Typography>
      <Typography component="span" variant="caption" color="text.secondary">{count.toLocaleString()}</Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Starter panels
// ---------------------------------------------------------------------------

function StarterDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (levelField: string) => void }) {
  const [field, setField] = useState('log_level');
  useEffect(() => { if (open) setField('log_level'); }, [open]);
  const valid = /^[A-Za-z_][\w.]*$/.test(field);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add starter panels</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Adds <strong>Log events by level</strong>, <strong>Errors by host</strong> and <strong>Exceptions by type</strong>. A panel with the same title is left alone.
        </Typography>
        <TextField
          fullWidth
          label="Field that holds the log level"
          value={field}
          onChange={(e) => setField(e.target.value)}
          error={!valid}
          helperText={valid ? 'Often log_level, level or severity. The panel preview lists the fields your logs have.' : 'A Splunk field name'}
          slotProps={{ htmlInput: { style: MONO } }}
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

function PanelDialog({ target, configId, scope, onClose, onSaved }: {
  target: SplunkQuery | 'new' | null;
  configId: string;
  scope: { systemUnderTestId: string; testEnvironment: string; workload: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target && target !== 'new' ? target : null;
  const [title, setTitle] = useState('');
  const [spl, setSpl] = useState('$entities');
  const [splitBy, setSplitBy] = useState('');
  const [aggregation, setAggregation] = useState('count');
  const [unit, setUnit] = useState('short');
  const [maxSeries, setMaxSeries] = useState(20);
  const [preview, setPreview] = useState<SplunkPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setTitle(editing?.panelTitle ?? '');
    setSpl(editing?.spl ?? '$entities');
    setSplitBy(editing?.splitBy ?? '');
    setAggregation(editing?.aggregation ?? 'count');
    setUnit(editing?.metricUnit ?? 'short');
    setMaxSeries(editing?.maxSeries ?? 20);
    setPreview(null);
    setError(null);
  }, [target, editing]);

  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await previewSplunkQuery({
        ...scope, splunkConfigId: configId, spl, splitBy: splitBy.trim() || null, aggregation: aggregation.trim(), maxSeries, minutes: 60,
      }));
    } catch (err) {
      setError(errorText(err));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    const fields = { panelTitle: title.trim(), spl, splitBy: splitBy.trim() || null, aggregation: aggregation.trim() || 'count', metricUnit: unit.trim() || 'short', maxSeries };
    try {
      if (editing) await updateSplunkQuery(editing.id, fields);
      else await createSplunkQuery({ ...scope, splunkConfigId: configId, ...fields });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!target} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? `Edit “${editing.panelTitle}”` : 'Add a Splunk panel'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Panel title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Timeouts by service" />
          <TextField
            label="Filter (SPL)"
            multiline
            minRows={2}
            value={spl}
            onChange={(e) => setSpl(e.target.value)}
            helperText="Start from $entities, the sources mapped above. Perfana adds the run's time window and the timechart, so leave out earliest, latest and | timechart. After a pipe: search, where, rex, eval, fields, rename, regex, spath, fillnull."
            slotProps={{ htmlInput: { style: MONO, spellCheck: false } }}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 2fr 1fr 1fr' }, gap: 2 }}>
            <TextField label="Value" value={aggregation} onChange={(e) => setAggregation(e.target.value)} helperText="count, or avg(field), p95(field), max(field), dc(field)" slotProps={{ htmlInput: { style: MONO } }} />
            <TextField label="One series per (optional)" value={splitBy} onChange={(e) => setSplitBy(e.target.value)} helperText="A field, e.g. log_level or host" slotProps={{ htmlInput: { style: MONO } }} />
            <TextField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            <TextField
              label="Max series"
              type="number"
              value={maxSeries}
              onChange={(e) => setMaxSeries(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              helperText="The rest go to OTHER"
              slotProps={{ htmlInput: { min: 1, max: 100 } }}
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button variant="outlined" onClick={runPreview} disabled={!spl.trim() || busy !== null} startIcon={busy === 'preview' ? <CircularProgress size={14} /> : undefined}>
              Preview last hour
            </Button>
            <Typography variant="caption" color="text.secondary">Runs the search once against Splunk; nothing is stored.</Typography>
          </Box>
          {preview && <PreviewResult preview={preview} onPickField={setSplitBy} />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!title.trim() || !spl.trim() || busy !== null}>
          {editing ? 'Save' : 'Add panel'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PreviewResult({ preview, onPickField }: { preview: SplunkPreview; onPickField: (f: string) => void }) {
  if (!preview.search) return <Alert severity="warning">{preview.message ?? 'Nothing to search.'}</Alert>;
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="caption" color="text.secondary">Search sent</Typography>
      <Typography sx={{ ...MONO, mb: 1.5, wordBreak: 'break-word' }}>{preview.search}</Typography>
      {preview.series.length === 0 ? (
        <Alert severity="info">
          No events in the last hour. If the sources have events, the filter or the field names may not match.
        </Alert>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary">
            Series over the last hour ({preview.bucketSeconds}s buckets)
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5, mb: 1.5 }}>
            {preview.series.map((s) => <Chip key={s.name} size="small" label={`${s.name}: ${s.total.toLocaleString()}`} />)}
          </Box>
        </>
      )}
      {preview.fields.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary">Fields in these sources (click to split by one)</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
            {preview.fields.map((f) => (
              <Tooltip key={f.field} title={f.values.slice(0, 10).join(', ') || 'no sample values'}>
                <Chip size="small" variant="outlined" label={`${f.field} (${f.distinctCount})`} onClick={() => onPickField(f.field)} />
              </Tooltip>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
