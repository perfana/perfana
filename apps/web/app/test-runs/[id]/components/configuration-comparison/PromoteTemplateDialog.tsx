'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from '@mui/material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { createCompareTemplate } from '@/lib/compare-templates';
import { fetchProfiles, type Profile } from '@/lib/profiles';
import {
  buildPromotedDefinition,
  buildPromoteTargets,
  defaultDashboardScope,
  type PromoteDashboardScope,
  type PromotedConfig,
  type PromoteSource,
} from './promote-template';

interface PromoteTemplateDialogProps {
  open: boolean;
  source: PromoteSource;
  /** The form's current values, unsaved edits included. */
  config: PromotedConfig;
  /** The form's scope radio: `metric` makes a metric-level template the default. */
  formScope: string;
  run: { organizationId?: string | null; tags?: string[] | null };
  onClose: () => void;
  /** Called with the target's label once the template is created. */
  onSaved: (targetLabel: string) => void;
}

const message = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err ? (err as Error).message : fallback;

/**
 * Saves the row being tuned as an ADAPT template (design §6). The row itself stays a hand edit; the
 * template applies on the next completed run of matching workloads, to panels nobody has hand-edited.
 */
export function PromoteTemplateDialog({ open, source, config, formScope, run, onClose, onSaved }: PromoteTemplateDialogProps) {
  const { organizations, isAdmin } = useOrganizationContext();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  // The user's pick; until there is one, the first target (a matching profile once they load).
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<PromoteDashboardScope>('uid');
  const [metric, setMetric] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const organizationId = run.organizationId ?? null;

  useEffect(() => {
    if (!open) return;
    setDashboard(defaultDashboardScope(source, formScope));
    setMetric(formScope === 'metric' && !!source.metricName);
    setChosenKey(null);
    setError(null);
    // Profiles are targets only; a failure just leaves them out.
    if (!organizationId) return;
    let cancelled = false;
    setProfilesLoading(true);
    fetchProfiles(organizationId)
      .then((p) => {
        if (!cancelled) setProfiles(p);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Reset per open; the source and scope are those of the row the form was opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organizationId]);

  const targets = useMemo(
    () => buildPromoteTargets(run, organizations, profiles, isAdmin),
    [run, organizations, profiles, isAdmin],
  );

  const targetKey = targets.some((t) => t.key === chosenKey) ? chosenKey! : (targets[0]?.key ?? '');

  const handleSave = async () => {
    const target = targets.find((t) => t.key === targetKey);
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      await createCompareTemplate(target.scope, buildPromotedDefinition(source, config, { dashboard, metric }));
      onSaved(target.label);
    } catch (err) {
      setError(message(err, 'Failed to save the template'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="promote-template-dialog-title">
      <DialogTitle id="promote-template-dialog-title">Save as template</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
        <Typography variant="body2" color="text.secondary">
          Applies on the next completed run of matching workloads to panels nobody has hand-edited. This row
          keeps its own settings and stays a hand edit.
        </Typography>

        {targets.length === 0 && !profilesLoading ? (
          <Alert severity="info">There is no scope you can save a template to for this run.</Alert>
        ) : (
          <FormControl size="small" fullWidth>
            <InputLabel id="promote-template-target-label">Save to</InputLabel>
            <Select
              labelId="promote-template-target-label"
              label="Save to"
              value={targetKey}
              onChange={(e) => setChosenKey(e.target.value)}
            >
              {targets.map((t) => (
                <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <FormControl>
          <FormLabel id="promote-template-dashboard-label">Dashboards</FormLabel>
          <RadioGroup
            aria-labelledby="promote-template-dashboard-label"
            value={dashboard}
            onChange={(e) => setDashboard(e.target.value as PromoteDashboardScope)}
          >
            <FormControlLabel
              value="uid"
              disabled={!source.dashboardUid}
              control={<Radio size="small" />}
              label={
                <Typography variant="body2">
                  This dashboard{source.dashboardUid ? ` (${source.dashboardUid})` : ' (its uid is unknown)'}
                </Typography>
              }
            />
            <FormControlLabel
              value="title"
              control={<Radio size="small" />}
              label={<Typography variant="body2">Every dashboard with a panel titled &ldquo;{source.panelTitle}&rdquo;</Typography>}
            />
          </RadioGroup>
          <Typography variant="caption" color="text.secondary">
            Dynatrace host and performance-test scenario dashboards have a uid per host or scenario, so choose the
            panel title for those.
          </Typography>
        </FormControl>

        {source.metricName && (
          <FormControl>
            <FormLabel id="promote-template-metric-label">Series</FormLabel>
            <RadioGroup
              aria-labelledby="promote-template-metric-label"
              value={metric ? 'metric' : 'panel'}
              onChange={(e) => setMetric(e.target.value === 'metric')}
            >
              <FormControlLabel
                value="panel"
                control={<Radio size="small" />}
                label={<Typography variant="body2">Every series on the panel</Typography>}
              />
              <FormControlLabel
                value="metric"
                control={<Radio size="small" />}
                label={<Typography variant="body2">Only {source.metricName}</Typography>}
              />
            </RadioGroup>
          </FormControl>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !targetKey}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          Save template
        </Button>
      </DialogActions>
    </Dialog>
  );
}
