'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { SERIES_GROUPING_PRESETS } from '@perfana/shared/utils';
import type { TestRun } from '@/types/test-runs';
import type { AnomalyData } from '../types';
import { getErrorMessage } from '@/lib/errors';
import { readFromStorage, writeToStorage } from '@/lib/safe-storage';
import {
  applyRules,
  fetchStatus,
  fetchSuggestions,
  type SeriesGroupingStatus,
  type SeriesGroupingSuggestion,
} from '@/lib/api/series-grouping';
import SeriesGroupingDialog from '@/components/series-grouping/SeriesGroupingDialog';
import { useCopyTargets } from '@/components/series-grouping/useCopyTargets';

/** Suggestion banners shown before the rest are summarised. */
export const MAX_SUGGESTIONS_SHOWN = 3;

export function dismissedSuggestionKey(
  testRun: Pick<TestRun, 'system_under_test_id' | 'test_environment' | 'workload'>,
  applicationDashboardId: string,
  panelId: number,
): string {
  return [
    'perfana.seriesGrouping.dismissed',
    testRun.system_under_test_id,
    testRun.test_environment,
    testRun.workload,
    applicationDashboardId,
    panelId,
  ].join('.');
}

/** The fields of an anomaly row the notices read: panel titles for the status rows, which carry only ids. */
export type SeriesGroupingAnomalyRow = Pick<AnomalyData, 'application_dashboard_id' | 'panel_id' | 'panel_title'>;

export interface SeriesGroupingNoticesProps {
  testRunId: string;
  testRun: TestRun | null;
  /**
   * The anomaly card's rows. A new array means the card refetched (after a re-evaluate, say), and
   * the notices refetch with it.
   */
  anomalyRows: readonly SeriesGroupingAnomalyRow[];
  /** Narrows the anomaly table to one panel. */
  onShowRows?: (dashboardLabel: string, panelTitle: string) => void;
  showToast: (message: string) => void;
}

const EMPTY_STATUS: SeriesGroupingStatus = { stale: [], misaligned: [] };

/**
 * Series grouping, as the anomaly card sees it: a banner per panel where a built-in preset would
 * turn incomparable rows into comparisons, a notice when the run was analysed under different
 * rules than the ones now in force, and a warning per group whose members never share a timestamp.
 *
 * Fetched when the expanded card mounts (which is when `useAnomalyDetection` fetches too) and again
 * whenever `anomalyRows` is replaced. A failure to fetch shows nothing: these are hints beside the
 * table, never something the table depends on.
 */
export function SeriesGroupingNotices({
  testRunId,
  testRun,
  anomalyRows,
  onShowRows,
  showToast,
}: SeriesGroupingNoticesProps) {
  const [suggestions, setSuggestions] = useState<SeriesGroupingSuggestion[]>([]);
  const [status, setStatus] = useState<SeriesGroupingStatus>(EMPTY_STATUS);
  const [dismissedVersion, setDismissedVersion] = useState(0);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [dialogFor, setDialogFor] = useState<SeriesGroupingSuggestion | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcRequested, setRecalcRequested] = useState(false);
  const [fetchSeq, setFetchSeq] = useState(0);

  useEffect(() => {
    if (!testRunId) return;
    let cancelled = false;
    fetchSuggestions(testRunId)
      .then((rows) => {
        // Defensive about the shape: an older API, or a test double, answers with something else.
        if (!cancelled) setSuggestions(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        console.warn('Series grouping suggestions unavailable:', getErrorMessage(err));
      });
    fetchStatus(testRunId)
      .then((rows) => {
        if (!cancelled) {
          setStatus({
            stale: Array.isArray(rows?.stale) ? rows.stale : [],
            misaligned: Array.isArray(rows?.misaligned) ? rows.misaligned : [],
          });
        }
      })
      .catch((err: unknown) => {
        console.warn('Series grouping status unavailable:', getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [testRunId, anomalyRows, fetchSeq]);

  // A requested recalculation is still pending until the card itself refetches; until then the
  // status still describes the old statistics, and repeating the warning would read as a failure.
  useEffect(() => {
    setRecalcRequested(false);
  }, [anomalyRows]);

  const panelTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const row of anomalyRows) {
      titles.set(`${row.application_dashboard_id}\u0000${Number(row.panel_id)}`, row.panel_title);
    }
    return titles;
  }, [anomalyRows]);

  const visibleSuggestions = useMemo(() => {
    if (!testRun) return [];
    return suggestions.filter((s) => {
      const key = dismissedSuggestionKey(testRun, s.applicationDashboardId, s.panelId);
      return !handled.has(key) && readFromStorage<boolean>(key, false) !== true;
    });
    // `dismissedVersion` re-reads storage after a dismiss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, testRun, handled, dismissedVersion]);

  const copyTargets = useCopyTargets(
    testRun?.system_under_test_id,
    testRun?.test_environment ?? '',
    testRun?.workload ?? '',
    dialogFor !== null,
  );

  const dismiss = useCallback(
    (s: SeriesGroupingSuggestion) => {
      if (!testRun) return;
      writeToStorage(dismissedSuggestionKey(testRun, s.applicationDashboardId, s.panelId), true);
      setDismissedVersion((v) => v + 1);
    },
    [testRun],
  );

  const recalculate = async () => {
    setRecalculating(true);
    try {
      const result = await applyRules({ testRunId, scope: 'baseline' });
      const n = result.enqueued.length;
      showToast(`Recalculating ${n} run${n === 1 ? '' : 's'}`);
      setRecalcRequested(true);
    } catch (err) {
      showToast(getErrorMessage(err));
    } finally {
      setRecalculating(false);
    }
  };

  if (!testRun) return null;

  const stalePanels = new Set(status.stale.map((s) => `${s.applicationDashboardId}\u0000${s.panelId}`)).size;
  const shown = visibleSuggestions.slice(0, MAX_SUGGESTIONS_SHOWN);
  const more = visibleSuggestions.length - shown.length;
  const titleOf = (dashboardId: string, panelId: number) =>
    panelTitles.get(`${dashboardId}\u0000${panelId}`) ?? `panel ${panelId}`;

  if (shown.length === 0 && stalePanels === 0 && status.misaligned.length === 0) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }} data-testid="series-grouping-notices">
      {shown.map((s) => {
        const panelTitle = s.panelTitle ?? titleOf(s.applicationDashboardId, s.panelId);
        const presetLabel = SERIES_GROUPING_PRESETS[s.preset]?.label ?? s.preset;
        return (
          <Alert
            key={`${s.applicationDashboardId}-${s.panelId}`}
            severity="info"
            sx={{ '& .MuiAlert-message': { width: '100%' } }}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {s.incomparableCount} series on &quot;{panelTitle}&quot; have no baseline, because their names changed
                  between runs.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  They look like: {presetLabel}. Grouping them lines up {Math.round(s.matchedAfter * 100)}% of this
                  run&apos;s series with the baseline, against {Math.round(s.matchedBefore * 100)}% now.
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <Button size="small" variant="contained" onClick={() => setDialogFor(s)}>
                  Group series…
                </Button>
                {onShowRows && s.dashboardLabel && panelTitle && (
                  <Button size="small" onClick={() => onShowRows(s.dashboardLabel as string, panelTitle)}>
                    Show rows
                  </Button>
                )}
                <Button size="small" color="inherit" onClick={() => dismiss(s)}>
                  Dismiss
                </Button>
              </Box>
            </Box>
          </Alert>
        );
      })}
      {more > 0 && (
        <Typography variant="caption" color="text.secondary">
          and {more} more panel{more === 1 ? '' : 's'} with series grouping suggestions
        </Typography>
      )}

      {stalePanels > 0 && (
        <Alert
          severity={recalcRequested ? 'info' : 'warning'}
          action={
            recalcRequested ? undefined : (
              <Button
                size="small"
                color="inherit"
                onClick={recalculate}
                disabled={recalculating}
                startIcon={recalculating ? <CircularProgress size={14} /> : null}
              >
                Recalculate this run and its baseline
              </Button>
            )
          }
        >
          {recalcRequested
            ? 'Recalculation requested; the anomaly results update when it finishes.'
            : `Grouping rules changed since this run's statistics were calculated (${stalePanels} panel${
                stalePanels === 1 ? '' : 's'
              }).`}
        </Alert>
      )}

      {status.misaligned.map((m) => (
        <Alert key={`misaligned-${m.applicationDashboardId}-${m.panelId}-${m.group}`} severity="warning">
          &quot;{m.group}&quot; on {titleOf(m.applicationDashboardId, m.panelId)}: its {m.members} members report at
          different timestamps (on average {m.avgMembers.toFixed(1)} per timestamp), so the group&apos;s values are
          mostly single pods. Grouping assumes a source that aligns its samples.
        </Alert>
      ))}

      {dialogFor && (
        <SeriesGroupingDialog
          open
          onClose={() => setDialogFor(null)}
          context={{
            systemId: testRun.system_under_test_id,
            environment: testRun.test_environment,
            workload: testRun.workload,
            applicationDashboardId: dialogFor.applicationDashboardId,
            dashboardLabel: dialogFor.dashboardLabel ?? '',
            panelId: dialogFor.panelId,
            panelTitle: dialogFor.panelTitle ?? undefined,
            testRunId,
          }}
          initialPreset={dialogFor.preset}
          origin="suggestion"
          copyTargets={copyTargets}
          showToast={showToast}
          onSaved={({ enqueued }) => {
            const key = dismissedSuggestionKey(testRun, dialogFor.applicationDashboardId, dialogFor.panelId);
            setHandled((prev) => new Set(prev).add(key));
            setDialogFor(null);
            if (enqueued > 0) setRecalcRequested(true);
            setFetchSeq((n) => n + 1);
          }}
        />
      )}
    </Box>
  );
}

export default SeriesGroupingNotices;
