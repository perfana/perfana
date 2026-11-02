'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  applySeriesGrouping,
  compileSeriesGroupingRule,
  evaluateGroupingPresets,
  SERIES_GROUPING_PRESET_ORDER,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { getErrorMessage } from '@/lib/errors';
import {
  applyRules,
  createRule,
  updateRule,
  type SeriesGroupingCopySkipReason,
  type SeriesGroupingCopyTarget,
  type SeriesGroupingRuleResponse,
} from '@/lib/api/series-grouping';
import { useSeriesGroupingPreview } from './useSeriesGroupingPreview';
import { AGGREGATION_LABELS, presetLabel } from './labels';

export interface SeriesGroupingDialogContext {
  systemId: string;
  environment: string;
  workload: string;
  applicationDashboardId: string;
  dashboardLabel: string;
  /** The panel the dialog was opened for; null opens it for the whole dashboard. */
  panelId: number | null;
  panelTitle?: string;
  /** The run being looked at. Without one, the preview uses the workload's latest completed run and no recalculation is offered. */
  testRunId?: string;
}

export interface SeriesGroupingSavedResult {
  rule: SeriesGroupingRuleResponse;
  /** Runs handed to the re-evaluate batch (0 when recalculation was off or failed). */
  enqueued: number;
  /** One sentence for a toast or an inline Alert: what was saved, copied, skipped and recalculated. */
  summary: string;
}

export interface SeriesGroupingDialogProps {
  open: boolean;
  onClose: () => void;
  context: SeriesGroupingDialogContext;
  /** Edit mode: the slot is fixed, only the rule itself changes. */
  existingRule?: SeriesGroupingRuleResponse;
  /** From a suggestion: preselected and marked "(suggested)". */
  initialPreset?: SeriesGroupingPreset;
  origin: 'manual' | 'suggestion';
  /** The system's other workloads, offered as "also create for". */
  copyTargets: SeriesGroupingCopyTarget[];
  onSaved: (result: SeriesGroupingSavedResult) => void;
  /** The test-run page passes one; the config page shows the summary in an inline Alert instead. */
  showToast?: (message: string) => void;
}

const COPY_SKIP_LABELS: Record<SeriesGroupingCopySkipReason, string> = {
  exists: 'already has a rule',
  'no-dashboard': 'no such dashboard',
  'ambiguous-dashboard': 'dashboard is ambiguous',
  'unknown-workload': 'no such workload',
  'not-writable': 'no permission',
  'same-slot': 'same workload',
};

/** Rows the preview table renders before it summarises the rest. */
const MAX_PREVIEW_ROWS = 50;
/** Member names listed in a cell before "+N more". */
const MAX_MEMBERS_SHOWN = 3;

const targetKey = (t: SeriesGroupingCopyTarget): string => `${t.testEnvironment}\u0000${t.workload}`;
const targetLabel = (t: SeriesGroupingCopyTarget): string => `${t.testEnvironment} / ${t.workload}`;

interface PreviewRow {
  panelId: number;
  group: string;
  members: string[];
  baselineMembers: string[];
  inBaseline: boolean;
}

function MemberList({ names }: { names: string[] }) {
  if (names.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        —
      </Typography>
    );
  }
  const shown = names.slice(0, MAX_MEMBERS_SHOWN);
  const rest = names.length - shown.length;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {shown.map((name) => (
        <Typography key={name} variant="caption" sx={{ wordBreak: 'break-all' }}>
          {name}
        </Typography>
      ))}
      {rest > 0 && (
        <Tooltip title={names.slice(MAX_MEMBERS_SHOWN).join(', ')}>
          <Typography variant="caption" color="text.secondary">
            +{rest} more
          </Typography>
        </Tooltip>
      )}
    </Box>
  );
}

export default function SeriesGroupingDialog({
  open,
  onClose,
  context,
  existingRule,
  initialPreset,
  origin,
  copyTargets,
  onSaved,
  showToast,
}: SeriesGroupingDialogProps) {
  const editing = existingRule !== undefined;
  const opensOnPanel = context.panelId !== null;

  // Initialised from the props on the first render too, not only by the reset below: the preview
  // fetches on the first commit, and a first render with a placeholder scope would fetch the wrong one.
  const [preset, setPreset] = useState<SeriesGroupingPreset>(() => existingRule?.preset ?? initialPreset ?? 'k8s-pod');
  const [pattern, setPattern] = useState(() => existingRule?.pattern ?? '');
  const [replacement, setReplacement] = useState(() =>
    existingRule?.preset === 'custom' ? existingRule.replacement : '',
  );
  const [aggregation, setAggregation] = useState<SeriesGroupingAggregation>(() => existingRule?.aggregation ?? 'avg');
  const [trackMemberCount, setTrackMemberCount] = useState(() => existingRule?.trackMemberCount ?? true);
  const [appliesTo, setAppliesTo] = useState<number | null>(() =>
    existingRule ? existingRule.panelId : context.panelId,
  );
  const [copyEnabled, setCopyEnabled] = useState(false);
  const [copySelection, setCopySelection] = useState<string[]>([]);
  const [recalculate, setRecalculate] = useState(() => Boolean(context.testRunId));
  const [detected, setDetected] = useState<SeriesGroupingPreset | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detectionDone = useRef(Boolean(existingRule || initialPreset));

  // Every open starts from the props, so a dialog kept mounted between uses never shows the last draft.
  useEffect(() => {
    if (!open) return;
    setPreset(existingRule?.preset ?? initialPreset ?? 'k8s-pod');
    setPattern(existingRule?.pattern ?? '');
    setReplacement(existingRule?.preset === 'custom' ? existingRule.replacement : '');
    setAggregation(existingRule?.aggregation ?? 'avg');
    setTrackMemberCount(existingRule?.trackMemberCount ?? true);
    setAppliesTo(existingRule ? existingRule.panelId : context.panelId);
    setCopyEnabled(false);
    setCopySelection([]);
    setRecalculate(Boolean(context.testRunId));
    setDetected(null);
    setSaving(false);
    setSaveError(null);
    // Preselection only when nothing told us which preset to use.
    detectionDone.current = Boolean(existingRule || initialPreset);
  }, [open, existingRule, initialPreset, context.panelId, context.testRunId]);

  const spec: SeriesGroupingRuleSpec = useMemo(
    () =>
      preset === 'custom'
        ? { preset, pattern, replacement, aggregation, trackMemberCount }
        : { preset, aggregation, trackMemberCount },
    [preset, pattern, replacement, aggregation, trackMemberCount],
  );
  const compiled = useMemo(() => compileSeriesGroupingRule(spec), [spec]);

  // Opened on a panel (or editing a panel rule), the names come per panel; opened on the whole
  // dashboard, they come for every panel once and a panel choice narrows them client-side.
  const fetchPanelId = opensOnPanel || editing ? appliesTo : null;
  const preview = useSeriesGroupingPreview(
    open,
    {
      testRunId: context.testRunId,
      systemId: context.systemId,
      environment: context.environment,
      workload: context.workload,
      applicationDashboardId: context.applicationDashboardId,
      panelId: fetchPanelId,
    },
    spec,
  );

  const scopedPanels = useMemo(
    () => (appliesTo === null ? preview.panels : preview.panels.filter((p) => p.panelId === appliesTo)),
    [preview.panels, appliesTo],
  );

  // "(detected)": the preset that lines the most names up, chosen once the names are in.
  useEffect(() => {
    if (detectionDone.current || !preview.ready || scopedPanels.length === 0) return;
    detectionDone.current = true;
    const current = scopedPanels.flatMap((p) => p.currentNames);
    const baseline = scopedPanels.flatMap((p) => p.baselineNames);
    const [best] = evaluateGroupingPresets(current, baseline);
    if (best && best.matchedAfter > best.matchedBefore) {
      setPreset(best.preset);
      setDetected(best.preset);
    }
  }, [preview.ready, scopedPanels]);

  const panelTitle = (panelId: number): string =>
    preview.panels.find((p) => p.panelId === panelId)?.panelTitle ??
    (panelId === context.panelId ? context.panelTitle : undefined) ??
    `Panel ${panelId}`;

  const analysis = useMemo(() => {
    const rows: PreviewRow[] = [];
    let seriesBefore = 0;
    let matchedBefore = 0;
    let groupsAfter = 0;
    let matchedAfter = 0;
    const collisions = new Set<string>();
    if (!compiled.ok) return { rows, seriesBefore, matchedBefore, groupsAfter, matchedAfter, collisions: [] };
    for (const panel of scopedPanels) {
      const baselineRaw = new Set(panel.baselineNames);
      seriesBefore += panel.currentNames.length;
      matchedBefore += panel.currentNames.filter((n) => baselineRaw.has(n)).length;
      const current = applySeriesGrouping(spec, panel.currentNames);
      const baseline = applySeriesGrouping(spec, panel.baselineNames);
      for (const [group, members] of current.groups) {
        const baselineMembers = baseline.groups.get(group) ?? [];
        const inBaseline = baseline.groups.has(group);
        groupsAfter += 1;
        if (inBaseline) matchedAfter += 1;
        rows.push({ panelId: panel.panelId, group, members, baselineMembers, inBaseline });
        // An old baseline run with an ungrouped series of exactly this name pools it into the group.
        if (members.some((m) => m !== group) && baselineRaw.has(group)) collisions.add(group);
      }
    }
    return {
      rows,
      seriesBefore,
      matchedBefore,
      groupsAfter,
      matchedAfter,
      collisions: Array.from(collisions).sort(),
    };
  }, [compiled.ok, scopedPanels, spec]);

  const scopedPanelIds = new Set(scopedPanels.map((p) => p.panelId));
  const misaligned = preview.alignment.filter((a) => scopedPanelIds.has(a.panelId));
  const baselineCount = preview.baselineRunIds.length;
  const canRecalculate = Boolean(context.testRunId);
  const willRecalculate = canRecalculate && recalculate;
  const multiPanel = scopedPanels.length > 1;

  const selectedTargets = copyTargets.filter((t) => copySelection.includes(targetKey(t)));
  const saveDisabled = saving || !compiled.ok || (copyEnabled && selectedTargets.length === 0);

  const title =
    appliesTo === null
      ? `Group series on all panels of "${context.dashboardLabel}"`
      : `Group series on "${panelTitle(appliesTo)}"`;

  const handleSave = async () => {
    if (saveDisabled) return;
    setSaving(true);
    setSaveError(null);
    const ruleFields =
      preset === 'custom'
        ? { preset, pattern, replacement, aggregation, trackMemberCount }
        : { preset, aggregation, trackMemberCount };
    let rule: SeriesGroupingRuleResponse;
    const parts: string[] = [];
    try {
      if (existingRule) {
        rule = await updateRule(existingRule.id, ruleFields);
        parts.push('Series grouping rule updated.');
      } else {
        const result = await createRule({
          systemUnderTestId: context.systemId,
          testEnvironment: context.environment,
          workload: context.workload,
          applicationDashboardId: context.applicationDashboardId,
          panelId: appliesTo,
          ...ruleFields,
          origin,
          ...(copyEnabled && selectedTargets.length > 0 ? { copyTo: selectedTargets } : {}),
        });
        rule = result.rule;
        parts.push('Series grouping rule saved.');
        const { created, skipped } = result.copies;
        if (created.length > 0 || skipped.length > 0) {
          const copyParts: string[] = [];
          if (created.length > 0) copyParts.push(`Created for ${created.length} more workload${created.length === 1 ? '' : 's'}`);
          if (skipped.length > 0) {
            copyParts.push(
              `skipped ${skipped
                .map((s) => `${targetLabel(s)} (${COPY_SKIP_LABELS[s.reason] ?? s.reason})`)
                .join(', ')}`,
            );
          }
          parts.push(`${copyParts.join('; ')}.`);
        }
      }
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setSaving(false);
      return;
    }

    let enqueued = 0;
    if (willRecalculate && context.testRunId) {
      try {
        const applied = await applyRules({ testRunId: context.testRunId, scope: 'baseline' });
        enqueued = applied.enqueued.length;
        parts.push(`Recalculating ${enqueued} run${enqueued === 1 ? '' : 's'}.`);
      } catch (err) {
        // The rule is saved; saying so and closing beats a retry that would answer 409.
        parts.push(`Recalculation could not be started: ${getErrorMessage(err)}`);
      }
    }

    const summary = parts.join(' ');
    setSaving(false);
    showToast?.(summary);
    onSaved({ rule, enqueued, summary });
  };

  const presetOption = (p: SeriesGroupingPreset): React.ReactNode => {
    const label = presetLabel(p);
    const marker = p === detected ? ' (detected)' : !editing && p === initialPreset ? ' (suggested)' : '';
    return (
      <span>
        {label}
        {marker && (
          <Typography component="span" variant="body2" color="text.secondary">
            {marker}
          </Typography>
        )}
      </span>
    );
  };

  const visibleRows = analysis.rows.slice(0, MAX_PREVIEW_ROWS);
  const hiddenRows = analysis.rows.length - visibleRows.length;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applies to every run of <strong>{context.environment} / {context.workload}</strong>. How should Perfana match
          these series across test runs?
        </Typography>

        <FormControl component="fieldset" sx={{ mb: 2, display: 'block' }}>
          <FormLabel component="legend">Pattern</FormLabel>
          <RadioGroup
            value={preset}
            onChange={(e) => setPreset(e.target.value as SeriesGroupingPreset)}
            name="series-grouping-preset"
          >
            {SERIES_GROUPING_PRESET_ORDER.map((p) => (
              <FormControlLabel key={p} value={p} control={<Radio size="small" />} label={presetOption(p)} />
            ))}
            <FormControlLabel value="custom" control={<Radio size="small" />} label={presetOption('custom')} />
          </RadioGroup>
          {preset === 'custom' && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', pl: 4, mt: 1 }}>
              <TextField
                size="small"
                label="Regular expression"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                error={!compiled.ok}
                helperText={!compiled.ok ? compiled.error : 'JavaScript syntax; every match is replaced'}
                sx={{ flex: 2 }}
                inputProps={{ 'aria-label': 'Regular expression' }}
              />
              <TextField
                size="small"
                label="Replace with"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                helperText="$1 allowed; empty removes the match"
                sx={{ flex: 1 }}
                inputProps={{ 'aria-label': 'Replace with' }}
              />
            </Box>
          )}
        </FormControl>

        <FormControl component="fieldset" sx={{ mb: 2, display: 'block' }}>
          <FormLabel component="legend">Combine</FormLabel>
          <RadioGroup
            row
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value as SeriesGroupingAggregation)}
            name="series-grouping-aggregation"
          >
            {(Object.keys(AGGREGATION_LABELS) as SeriesGroupingAggregation[]).map((a) => (
              <FormControlLabel key={a} value={a} control={<Radio size="small" />} label={AGGREGATION_LABELS[a]} />
            ))}
          </RadioGroup>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={trackMemberCount}
                onChange={(e) => setTrackMemberCount(e.target.checked)}
              />
            }
            label="Also track the number of pods"
          />
        </FormControl>

        <FormControl component="fieldset" sx={{ mb: 2, display: 'block' }}>
          <FormLabel component="legend">Applies to</FormLabel>
          {editing ? (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {appliesTo === null ? 'All panels on this dashboard' : `This panel (${panelTitle(appliesTo)})`}
            </Typography>
          ) : opensOnPanel ? (
            <RadioGroup
              row
              value={appliesTo === null ? 'all' : 'panel'}
              onChange={(e) => setAppliesTo(e.target.value === 'all' ? null : context.panelId)}
              name="series-grouping-scope"
            >
              <FormControlLabel value="panel" control={<Radio size="small" />} label="This panel" />
              <FormControlLabel value="all" control={<Radio size="small" />} label="All panels on this dashboard" />
            </RadioGroup>
          ) : (
            <Select
              size="small"
              value={appliesTo === null ? 'all' : String(appliesTo)}
              onChange={(e) => setAppliesTo(e.target.value === 'all' ? null : Number(e.target.value))}
              sx={{ mt: 0.5, minWidth: 280 }}
              inputProps={{ 'aria-label': 'Applies to' }}
            >
              <MenuItem value="all">All panels on this dashboard</MenuItem>
              {preview.panels.map((p) => (
                <MenuItem key={p.panelId} value={String(p.panelId)}>
                  {p.panelTitle ?? `Panel ${p.panelId}`}
                </MenuItem>
              ))}
            </Select>
          )}
          {!editing && copyTargets.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox size="small" checked={copyEnabled} onChange={(e) => setCopyEnabled(e.target.checked)} />
                }
                label="Also create for other workloads of this system"
              />
              {copyEnabled && (
                <FormGroup row sx={{ pl: 4 }} aria-label="Other workloads">
                  {copyTargets.map((t) => {
                    const key = targetKey(t);
                    return (
                      <FormControlLabel
                        key={key}
                        control={
                          <Checkbox
                            size="small"
                            checked={copySelection.includes(key)}
                            onChange={(e) =>
                              setCopySelection((prev) =>
                                e.target.checked ? [...prev, key] : prev.filter((k) => k !== key),
                              )
                            }
                          />
                        }
                        label={targetLabel(t)}
                      />
                    );
                  })}
                </FormGroup>
              )}
            </Box>
          )}
        </FormControl>

        <Box sx={{ mb: 2 }}>
          {preview.loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Loading this run&apos;s series…
              </Typography>
            </Box>
          ) : preview.error ? (
            <Alert severity="warning">Preview unavailable: {preview.error}</Alert>
          ) : scopedPanels.length === 0 ? (
            <Alert severity="info">No series recorded for this selection in the run.</Alert>
          ) : !compiled.ok ? null : (
            <>
              <Table size="small" aria-label="Series grouping preview">
                <TableHead>
                  <TableRow>
                    <TableCell>This run</TableCell>
                    <TableCell>
                      Baseline ({baselineCount} run{baselineCount === 1 ? '' : 's'})
                    </TableCell>
                    <TableCell>Group</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={`${row.panelId}\u0000${row.group}`} data-testid="series-grouping-preview-row">
                      <TableCell sx={{ verticalAlign: 'top' }}>
                        <MemberList names={row.members} />
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top' }}>
                        <MemberList names={row.baselineMembers} />
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
                          {row.group}
                        </Typography>
                        {multiPanel && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {panelTitle(row.panelId)}
                          </Typography>
                        )}
                        <Typography
                          variant="caption"
                          sx={{ color: row.inBaseline ? 'readable.success' : 'text.secondary' }}
                        >
                          {row.inBaseline ? '✓ in baseline' : 'not in baseline'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hiddenRows > 0 && (
                <Typography variant="caption" color="text.secondary">
                  and {hiddenRows} more group{hiddenRows === 1 ? '' : 's'}
                </Typography>
              )}
              <Typography variant="body2" sx={{ mt: 1 }} data-testid="series-grouping-before-after">
                Before: {analysis.matchedBefore} of {analysis.seriesBefore} series match the baseline · After:{' '}
                {analysis.matchedAfter} of {analysis.groupsAfter} group{analysis.groupsAfter === 1 ? '' : 's'} match
              </Typography>
              {baselineCount === 0 && (
                <Typography variant="caption" color="text.secondary" display="block">
                  This run has no baseline runs yet, so nothing can match.
                </Typography>
              )}
            </>
          )}
        </Box>

        {(preview.sloWarnings.length > 0 ||
          analysis.collisions.length > 0 ||
          misaligned.length > 0 ||
          preview.sloCheckPending) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
            {preview.sloCheckPending ? (
              <Typography variant="caption" color="text.secondary">
                Checking SLOs against this rule…
              </Typography>
            ) : (
              preview.sloWarnings.map((w) => (
                <Alert key={w.benchmarkId} severity="warning">
                  SLO &quot;{w.name}&quot; matches <code>{w.matchPattern}</code> and will match nothing after grouping.
                </Alert>
              ))
            )}
            {analysis.collisions.map((group) => (
              <Alert key={`collision-${group}`} severity="warning">
                &quot;{group}&quot; is also a series name in a baseline run. Until that run is recalculated, its &quot;
                {group}&quot; values are pooled into the group.
              </Alert>
            ))}
            {misaligned.map((a) => (
              <Alert key={`align-${a.panelId}-${a.group}`} severity="warning">
                &quot;{a.group}&quot; on {panelTitle(a.panelId)}: its {a.members} members report at different
                timestamps (on average {a.avgMembers.toFixed(1)} per timestamp), so the group&apos;s values are
                mostly single pods. Grouping assumes a source that aligns its samples.
              </Alert>
            ))}
          </Box>
        )}

        {canRecalculate ? (
          <FormControlLabel
            control={<Checkbox checked={recalculate} onChange={(e) => setRecalculate(e.target.checked)} />}
            label={
              <span>
                Recalculate this run and its {baselineCount} baseline run{baselineCount === 1 ? '' : 's'} now
                <Typography variant="caption" color="text.secondary" display="block">
                  Otherwise anomaly detection has no baseline for these groups until enough new runs exist.
                </Typography>
              </span>
            }
          />
        ) : (
          <Typography variant="caption" color="text.secondary" display="block">
            The rule takes effect on the next analysis. Runs already analysed offer a recalculation on their
            anomaly-detection card.
          </Typography>
        )}

        {saveError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {saveError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saveDisabled}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {willRecalculate ? 'Save and recalculate' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
