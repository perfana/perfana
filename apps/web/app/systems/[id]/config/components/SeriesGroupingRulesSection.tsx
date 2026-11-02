'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import { getErrorMessage } from '@/lib/errors';
import {
  deleteRule,
  listRules,
  updateRule,
  type SeriesGroupingRuleResponse,
} from '@/lib/api/series-grouping';
import SeriesGroupingDialog from '@/components/series-grouping/SeriesGroupingDialog';
import { useCopyTargets } from '@/components/series-grouping/useCopyTargets';
import {
  AGGREGATION_LABELS,
  PERF_TEST_DASHBOARD_UID_PREFIX,
  presetLabel,
} from '@/components/series-grouping/labels';
import type { ApplicationDashboard } from './types';

export interface SeriesGroupingRulesSectionProps {
  systemId: string;
  environment: string;
  /** Rules are per workload while the dashboard list is per environment; '' means none is selected. */
  workload: string;
  dashboard: Pick<ApplicationDashboard, 'id' | 'dashboard_label' | 'dashboard_uid'>;
}

type DialogState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; rule: SeriesGroupingRuleResponse };

/**
 * The "Series grouping" section of a dashboard's settings: the rules of this dashboard in the
 * selected workload, with add / edit / delete through the same dialog the anomaly card opens.
 * There is no run here, so the dialog previews against the workload's latest completed run and
 * offers no recalculation; the anomaly card's stale notice offers it afterwards. This page has no
 * toast, so results and errors are inline Alerts.
 */
export default function SeriesGroupingRulesSection({
  systemId,
  environment,
  workload,
  dashboard,
}: SeriesGroupingRulesSectionProps) {
  const [rules, setRules] = useState<SeriesGroupingRuleResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [deleting, setDeleting] = useState<SeriesGroupingRuleResponse | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const isPerfTestDashboard = (dashboard.dashboard_uid ?? '').startsWith(PERF_TEST_DASHBOARD_UID_PREFIX);
  const active = Boolean(workload) && !isPerfTestDashboard;

  const copyTargets = useCopyTargets(systemId, environment, workload, dialog.mode === 'add');

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      setRules(await listRules({ systemId, environment, workload, applicationDashboardId: dashboard.id }));
    } catch (err) {
      setError(getErrorMessage(err));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [active, systemId, environment, workload, dashboard.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isPerfTestDashboard) return null;

  const toggleEnabled = async (rule: SeriesGroupingRuleResponse) => {
    setTogglingId(rule.id);
    setError(null);
    try {
      const updated = await updateRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setNotice(
        updated.enabled
          ? 'Rule enabled. It takes effect on the next analysis of each run.'
          : 'Rule disabled. Runs analysed under it keep their grouped statistics until they are recalculated.',
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deleteRule(deleting.id);
      setDeleting(null);
      setNotice('Rule deleted. Runs analysed under it keep their grouped statistics until they are recalculated.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Box sx={{ mt: 3 }} data-testid="series-grouping-section">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6">Series grouping</Typography>
        {active && (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setDialog({ mode: 'add' })}>
            Add rule
          </Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Treat series whose names differ only by a generated part, such as a Kubernetes pod name, as one series,
        so runs can be compared across deployments.
      </Typography>

      {!workload ? (
        <Alert severity="info">Select a workload to configure series grouping.</Alert>
      ) : (
        <>
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
              No series grouping rules for {environment} / {workload}.
            </Typography>
          ) : (
            <Table size="small" aria-label="Series grouping rules">
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
                  <TableRow key={rule.id} data-testid="series-grouping-rule-row">
                    <TableCell>{rule.panelId === null ? 'All panels' : `Panel ${rule.panelId}`}</TableCell>
                    <TableCell>
                      {presetLabel(rule.preset)}
                      {rule.preset === 'custom' && rule.pattern && (
                        <Typography variant="caption" component="code" display="block" sx={{ wordBreak: 'break-all' }}>
                          {rule.pattern}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {AGGREGATION_LABELS[rule.aggregation] ?? rule.aggregation}
                      {rule.trackMemberCount && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          + pod count
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        size="small"
                        checked={rule.enabled}
                        disabled={togglingId === rule.id}
                        onChange={() => void toggleEnabled(rule)}
                        inputProps={{ 'aria-label': `Enabled: ${presetLabel(rule.preset)}` }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit rule">
                        <IconButton size="small" aria-label="Edit rule" onClick={() => setDialog({ mode: 'edit', rule })}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete rule">
                        <IconButton size="small" aria-label="Delete rule" onClick={() => setDeleting(rule)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      {dialog.mode !== 'closed' && (
        <SeriesGroupingDialog
          open
          onClose={() => setDialog({ mode: 'closed' })}
          context={{
            systemId,
            environment,
            workload,
            applicationDashboardId: dashboard.id,
            dashboardLabel: dashboard.dashboard_label,
            panelId: dialog.mode === 'edit' ? dialog.rule.panelId : null,
          }}
          existingRule={dialog.mode === 'edit' ? dialog.rule : undefined}
          origin="manual"
          copyTargets={copyTargets}
          onSaved={({ summary }) => {
            setDialog({ mode: 'closed' });
            setNotice(summary);
            void load();
          }}
        />
      )}

      <Dialog open={deleting !== null} onClose={deleteBusy ? undefined : () => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete series grouping rule?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Runs analysed under this rule keep their grouped statistics until they are recalculated, and their
            anomaly card then offers a recalculation.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
