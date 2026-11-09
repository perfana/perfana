'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandMore, Lock } from '@mui/icons-material';
import { AGGREGATION_OPTIONS, CLASSIFICATION_OPTIONS } from '@/lib/compare-config-options';
import type { CompareTemplateDefinition } from '@/lib/compare-templates';
import { toDefinition, toFormState, type Direction, type TemplateFormErrors, type TemplateFormState } from '../template-form';
import { ScopeBadge } from './ScopeBadge';

export const TEMPLATE_REACH =
  'Applies on the next completed run of matching workloads, to panels nobody has hand-edited.';

interface CompareTemplateDialogProps {
  open: boolean;
  scopeKind: 'organization' | 'install';
  scopeName: string;
  /** The template to edit or view; absent for a new one. */
  initial?: CompareTemplateDefinition;
  /** A provisioned template: shown, not editable. */
  readOnly?: boolean;
  onClose: () => void;
  /** Rejects with the server's message, which the dialog shows. */
  onSave: (definition: CompareTemplateDefinition) => Promise<void>;
}

/** One forced field: a "set" checkbox, and the control, enabled only while set. */
function OverrideRow({
  label,
  set,
  disabled,
  onSet,
  children,
}: {
  label: string;
  set: boolean;
  disabled: boolean;
  onSet: (set: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '220px 1fr' }, alignItems: 'center', gap: 1, py: 0.5 }}>
      <FormControlLabel
        control={<Checkbox size="small" checked={set} disabled={disabled} onChange={(e) => onSet(e.target.checked)} />}
        label={<Typography variant="body2">{label}</Typography>}
      />
      <Box sx={{ opacity: set ? 1 : 0.5 }}>{children}</Box>
    </Box>
  );
}

export function CompareTemplateDialog({
  open,
  scopeKind,
  scopeName,
  initial,
  readOnly = false,
  onClose,
  onSave,
}: CompareTemplateDialogProps) {
  const [state, setState] = useState<TemplateFormState>(() => toFormState(initial));
  const [errors, setErrors] = useState<TemplateFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setState(toFormState(initial));
    setErrors({});
    setServerError(null);
  }, [open, initial]);

  const patch = (p: Partial<TemplateFormState>) => setState((s) => ({ ...s, ...p }));
  const numberField = (key: 'percentageThreshold' | 'iqrThreshold' | 'minSampleCount' | 'ignoreMeanDiffSmallerThan' | 'defaultValueIfControlGroupMissing') => ({
    set: state[key].set,
    onSet: (set: boolean) => patch({ [key]: { ...state[key], set } } as Partial<TemplateFormState>),
    text: state[key].text,
    onText: (text: string) => patch({ [key]: { ...state[key], text } } as Partial<TemplateFormState>),
  });

  const handleSave = async () => {
    const { definition, errors: found } = toDefinition(state);
    setErrors(found);
    if (!definition) return;
    setSaving(true);
    setServerError(null);
    try {
      await onSave(definition);
    } catch (err) {
      setServerError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to save the template');
    } finally {
      setSaving(false);
    }
  };

  const locked = readOnly || saving;
  const numberInput = (
    f: ReturnType<typeof numberField>,
    label: string,
    error: string | undefined,
    props: { step?: string; helper?: string; endAdornment?: string } = {},
  ) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={f.text}
      disabled={locked || !f.set}
      onChange={(e) => f.onText(e.target.value)}
      error={!!error}
      helperText={error ?? props.helper}
      slotProps={{ htmlInput: { step: props.step ?? 'any' }, input: props.endAdornment ? { endAdornment: <Typography variant="body2" color="text.secondary">{props.endAdornment}</Typography> } : undefined }}
      sx={{ maxWidth: 260 }}
    />
  );

  const idWithoutDashboard = state.panelMode === 'id' && state.dashboardUid.trim() === '' && state.panelId.trim() !== '';

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="compare-template-dialog-title">
      <DialogTitle id="compare-template-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {readOnly && <Lock fontSize="small" color="action" />}
        {readOnly ? 'Provisioned ADAPT template' : initial ? 'Edit ADAPT template' : 'New ADAPT template'}
        <Box sx={{ flex: 1 }} />
        <ScopeBadge kind={scopeKind} />
        <Typography variant="body2" color="text.secondary">{scopeName}</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {readOnly ? (
          <Alert severity="info" icon={<Lock fontSize="small" />}>
            This template comes from <code>template_ds_compare_configs.yaml</code>. Change it in the file, or copy it to another scope
            and edit the copy.
          </Alert>
        ) : (
          <Alert severity="info">{TEMPLATE_REACH}</Alert>
        )}
        {serverError && <Alert severity="error">{serverError}</Alert>}

        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={600}>Which panels</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              label="Dashboard UID"
              value={state.dashboardUid}
              disabled={locked}
              onChange={(e) => patch({ dashboardUid: e.target.value })}
              helperText="Leave empty for every dashboard that has the panel"
              sx={{ flex: '1 1 260px' }}
            />
            <TextField
              size="small"
              label="Dashboard label"
              value={state.dashboardLabel}
              disabled={locked}
              onChange={(e) => patch({ dashboardLabel: e.target.value })}
              helperText="Descriptive only"
              sx={{ flex: '1 1 200px' }}
            />
          </Box>
          <FormControlLabel
            control={<Switch size="small" checked={state.regex} disabled={locked} onChange={(e) => patch({ regex: e.target.checked })} />}
            label={
              <Typography variant="body2">
                Regular expressions: match the dashboard UID, and the panel title when there is no panel id, as patterns
              </Typography>
            }
          />
          <RadioGroup
            row
            value={state.panelMode}
            onChange={(e) => patch({ panelMode: e.target.value as 'id' | 'title' })}
            aria-label="Select panels by"
          >
            <FormControlLabel value="id" control={<Radio size="small" disabled={locked} />} label={<Typography variant="body2">By panel id</Typography>} />
            <FormControlLabel value="title" control={<Radio size="small" disabled={locked} />} label={<Typography variant="body2">By panel title</Typography>} />
          </RadioGroup>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {state.panelMode === 'id' && (
              <TextField
                size="small"
                type="number"
                label="Panel id"
                required
                value={state.panelId}
                disabled={locked}
                onChange={(e) => patch({ panelId: e.target.value })}
                error={!!errors.panelId}
                helperText={errors.panelId}
                slotProps={{ htmlInput: { step: 1 } }}
                sx={{ width: 160 }}
              />
            )}
            <TextField
              size="small"
              label={state.panelMode === 'id' ? 'Panel title (label only)' : state.regex ? 'Panel title pattern' : 'Panel title'}
              required={state.panelMode === 'title'}
              value={state.panelTitle}
              disabled={locked}
              onChange={(e) => patch({ panelTitle: e.target.value })}
              error={!!errors.panelTitle}
              helperText={errors.panelTitle ?? (state.panelMode === 'title' ? 'Resolved per dashboard from its collected panels' : undefined)}
              sx={{ flex: '1 1 260px' }}
            />
          </Box>
          {idWithoutDashboard && (
            <Alert severity="warning" variant="outlined">
              A panel id is unique only within one dashboard. With no dashboard UID this template reaches panel {state.panelId} on every
              dashboard of a workload. Use a panel title for &ldquo;this panel wherever it appears&rdquo;.
            </Alert>
          )}
          <TextField
            size="small"
            label="Metric (series) name"
            value={state.metricName}
            disabled={locked}
            onChange={(e) => patch({ metricName: e.target.value })}
            helperText="Leave empty for the whole panel. A metric-level template replaces the panel's config for that series, so set every field the series needs."
          />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>Classification</Typography>
          <FormControl size="small" required error={!!errors.metricClassification} sx={{ maxWidth: 360 }}>
            <InputLabel id="template-classification-label">Classification category</InputLabel>
            <Select
              labelId="template-classification-label"
              label="Classification category"
              value={state.metricClassification}
              disabled={locked}
              onChange={(e) => patch({ metricClassification: e.target.value })}
            >
              {/* A provisioned file may carry a value the list does not offer. */}
              {state.metricClassification && !CLASSIFICATION_OPTIONS.some((o) => o.value === state.metricClassification) && (
                <MenuItem value={state.metricClassification}>{state.metricClassification}</MenuItem>
              )}
              {CLASSIFICATION_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
            {errors.metricClassification && <Typography variant="caption" color="error">{errors.metricClassification}</Typography>}
          </FormControl>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600}>What this template forces</Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
            Tick a field to force it onto every panel the template reaches. A field left unticked keeps each panel&rsquo;s own value.
          </Typography>

          <OverrideRow label="Direction" set={state.direction.set} disabled={locked} onSet={(set) => patch({ direction: { ...state.direction, set } })}>
            <FormControl size="small" sx={{ minWidth: 260 }} disabled={locked || !state.direction.set}>
              <Select
                value={state.direction.value}
                onChange={(e) => patch({ direction: { ...state.direction, value: e.target.value as Direction } })}
                inputProps={{ 'aria-label': 'Direction' }}
              >
                <MenuItem value="lower">Lower is better</MenuItem>
                <MenuItem value="higher">Higher is better</MenuItem>
                <MenuItem value="none">No direction (informational, never fails a run)</MenuItem>
              </Select>
            </FormControl>
          </OverrideRow>

          <OverrideRow label="Ignore metric" set={state.ignore.set} disabled={locked} onSet={(set) => patch({ ignore: { ...state.ignore, set } })}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  color="warning"
                  checked={state.ignore.value}
                  disabled={locked || !state.ignore.set}
                  onChange={(e) => patch({ ignore: { ...state.ignore, value: e.target.checked } })}
                />
              }
              label={<Typography variant="body2">{state.ignore.value ? 'Excluded from anomaly detection' : 'Included'}</Typography>}
            />
          </OverrideRow>

          <OverrideRow label="Aggregation" set={state.aggregation.set} disabled={locked} onSet={(set) => patch({ aggregation: { ...state.aggregation, set } })}>
            <FormControl size="small" sx={{ minWidth: 200 }} disabled={locked || !state.aggregation.set}>
              <Select
                value={state.aggregation.value}
                onChange={(e) => patch({ aggregation: { ...state.aggregation, value: e.target.value } })}
                inputProps={{ 'aria-label': 'Aggregation' }}
              >
                {AGGREGATION_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </OverrideRow>

          {(() => {
            const f = numberField('percentageThreshold');
            return (
              <OverrideRow label="Percentage threshold" set={f.set} disabled={locked} onSet={f.onSet}>
                {numberInput(f, 'Percentage', errors.percentageThreshold, { endAdornment: '%' })}
              </OverrideRow>
            );
          })()}
          {(() => {
            const f = numberField('iqrThreshold');
            return (
              <OverrideRow label="IQR threshold" set={f.set} disabled={locked} onSet={f.onSet}>
                {numberInput(f, 'IQR multiplier', errors.iqrThreshold)}
              </OverrideRow>
            );
          })()}

          <OverrideRow
            label="Absolute threshold"
            set={state.absThreshold.set}
            disabled={locked}
            onSet={(set) => patch({ absThreshold: { ...state.absThreshold, set } })}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                type="number"
                label="Absolute"
                value={state.absThreshold.text}
                disabled={locked || !state.absThreshold.set || state.absThreshold.none}
                onChange={(e) => patch({ absThreshold: { ...state.absThreshold, text: e.target.value } })}
                error={!!errors.absThreshold}
                helperText={errors.absThreshold}
                slotProps={{ htmlInput: { step: 'any' } }}
                sx={{ maxWidth: 200 }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={state.absThreshold.none}
                    disabled={locked || !state.absThreshold.set}
                    onChange={(e) => patch({ absThreshold: { ...state.absThreshold, none: e.target.checked } })}
                  />
                }
                label={<Typography variant="body2">None (clear it)</Typography>}
              />
            </Box>
          </OverrideRow>

          {(() => {
            const f = numberField('minSampleCount');
            return (
              <OverrideRow label="Minimum samples" set={f.set} disabled={locked} onSet={f.onSet}>
                {numberInput(f, 'Samples', errors.minSampleCount, { step: '1', helper: 'Fewer samples read as incomparable' })}
              </OverrideRow>
            );
          })()}

          <Accordion
            disableGutters
            elevation={0}
            defaultExpanded={state.ignoreMeanDiffSmallerThan.set || state.defaultValueIfControlGroupMissing.set}
            sx={{ mt: 1, '&:before': { display: 'none' }, border: 1, borderColor: 'divider', borderRadius: 1 }}
            slotProps={{ transition: { unmountOnExit: true } }}
          >
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="body2">Stored but not yet read by ADAPT</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                Kept so a template round-trips through the YAML file unchanged. ADAPT ignores both today.
              </Typography>
              {(() => {
                const f = numberField('ignoreMeanDiffSmallerThan');
                return (
                  <OverrideRow label="Ignore mean difference below" set={f.set} disabled={locked} onSet={f.onSet}>
                    {numberInput(f, 'Difference', errors.ignoreMeanDiffSmallerThan)}
                  </OverrideRow>
                );
              })()}
              {(() => {
                const f = numberField('defaultValueIfControlGroupMissing');
                return (
                  <OverrideRow label="Default without a control group" set={f.set} disabled={locked} onSet={f.onSet}>
                    {numberInput(f, 'Value', errors.defaultValueIfControlGroupMissing)}
                  </OverrideRow>
                );
              })()}
            </AccordionDetails>
          </Accordion>
        </Paper>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && (
          <Button variant="contained" onClick={handleSave} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            {saving ? 'Saving…' : initial ? 'Save template' : 'Create template'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
