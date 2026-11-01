'use client';

import { useEffect, useRef, useState } from 'react';
import {
  compileSeriesGroupingRule,
  seriesGroupingRuleHash,
  type SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { getErrorMessage } from '@/lib/errors';
import {
  previewRule,
  type SeriesGroupingAlignment,
  type SeriesGroupingPreviewPanel,
  type SeriesGroupingSloWarning,
} from '@/lib/api/series-grouping';

/** How long the rule must stay unchanged before the server's SLO check is asked again. */
export const SLO_RECHECK_DEBOUNCE_MS = 600;

/** A spec the server accepts even when the user's draft is mid-edit; the names do not depend on it. */
const NAMES_ONLY_SPEC: SeriesGroupingRuleSpec = { preset: 'k8s-pod', aggregation: 'avg', trackMemberCount: false };

export interface SeriesGroupingPreviewScope {
  testRunId?: string;
  systemId: string;
  environment: string;
  workload: string;
  applicationDashboardId: string;
  /** null = every panel of the dashboard. */
  panelId: number | null;
}

export interface SeriesGroupingPreviewState {
  loading: boolean;
  /** The names for the CURRENT scope have landed (false while closed, loading, or after a scope change). */
  ready: boolean;
  error: string | null;
  /** The run the preview was computed for (the latest completed run when no run was named). */
  testRunId: string | null;
  baselineRunIds: string[];
  panels: SeriesGroupingPreviewPanel[];
  alignment: SeriesGroupingAlignment[];
  /** SLOs that would judge nothing after grouping, for the spec in `checkedSpecHash`. */
  sloWarnings: SeriesGroupingSloWarning[];
  /** True while the SLO check describes an older version of the rule. */
  sloCheckPending: boolean;
}

function specValid(spec: SeriesGroupingRuleSpec): boolean {
  return compileSeriesGroupingRule(spec).ok;
}

/**
 * The server half of the dialog's preview.
 *
 * The raw names are fetched ONCE per scope (open, dashboard, panel): the grouping itself is
 * computed client-side with `applySeriesGrouping` on every keystroke, so editing the rule never
 * waits on the network. Changing the scope ("This panel" → "All panels") is a different name
 * list, so it does refetch.
 *
 * The one part that depends on the rule is the SLO check: it needs the stored SLO patterns,
 * which only the server has. It is asked again once the rule has been unchanged for
 * `SLO_RECHECK_DEBOUNCE_MS`, and never for a rule that does not compile (the server would 400).
 * Until the answer lands `sloCheckPending` is true, so the dialog never presents a warning list
 * computed for a different rule as if it were current. Replies are sequence-tagged and a stale
 * one is dropped.
 */
export function useSeriesGroupingPreview(
  open: boolean,
  scope: SeriesGroupingPreviewScope,
  spec: SeriesGroupingRuleSpec,
): SeriesGroupingPreviewState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [baselineRunIds, setBaselineRunIds] = useState<string[]>([]);
  const [panels, setPanels] = useState<SeriesGroupingPreviewPanel[]>([]);
  const [alignment, setAlignment] = useState<SeriesGroupingAlignment[]>([]);
  const [sloWarnings, setSloWarnings] = useState<SeriesGroupingSloWarning[]>([]);
  const [checkedSpecHash, setCheckedSpecHash] = useState<string | null>(null);
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);

  const specRef = useRef(spec);
  specRef.current = spec;
  const requestSeq = useRef(0);

  const { testRunId: runId, systemId, environment, workload, applicationDashboardId, panelId } = scope;
  const scopeKey = [runId ?? '', systemId, environment, workload, applicationDashboardId, panelId ?? 'all'].join('\u0000');
  const valid = specValid(spec);
  const specHash = seriesGroupingRuleHash(spec);

  const request = (ruleSpec: SeriesGroupingRuleSpec) =>
    previewRule({
      ...(runId ? { testRunId: runId } : { systemId, environment, workload }),
      applicationDashboardId,
      panelId,
      rule: ruleSpec,
    });

  // Closing forgets everything, so a reopened dialog never reasons over the last open's names.
  useEffect(() => {
    if (open) return;
    requestSeq.current += 1;
    setLoading(false);
    setError(null);
    setTestRunId(null);
    setBaselineRunIds([]);
    setPanels([]);
    setAlignment([]);
    setSloWarnings([]);
    setCheckedSpecHash(null);
    setLoadedScopeKey(null);
  }, [open]);

  // Names: once per scope.
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    const current = specRef.current;
    const sent = specValid(current) ? current : NAMES_ONLY_SPEC;
    setLoading(true);
    setError(null);
    request(sent)
      .then((preview) => {
        if (seq !== requestSeq.current) return;
        setTestRunId(preview.testRunId);
        setBaselineRunIds(preview.baselineRunIds);
        setPanels(preview.panels);
        setAlignment(preview.alignment);
        setSloWarnings(preview.sloWarnings);
        setCheckedSpecHash(seriesGroupingRuleHash(sent));
        setLoadedScopeKey(scopeKey);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(getErrorMessage(err));
        setPanels([]);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
    // `request` closes over the scope fields, which `scopeKey` covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey]);

  // SLO check: again once the rule settles, for the scope already loaded.
  useEffect(() => {
    if (!open || loadedScopeKey !== scopeKey || !valid || specHash === checkedSpecHash) return;
    const timer = setTimeout(() => {
      const seq = ++requestSeq.current;
      const sent = specRef.current;
      request(sent)
        .then((preview) => {
          if (seq !== requestSeq.current) return;
          setSloWarnings(preview.sloWarnings);
          setCheckedSpecHash(seriesGroupingRuleHash(sent));
        })
        .catch(() => {
          // A failed re-check leaves the warnings marked pending rather than blanking them.
        });
    }, SLO_RECHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey, loadedScopeKey, valid, specHash, checkedSpecHash]);

  return {
    loading,
    ready: open && !loading && loadedScopeKey === scopeKey,
    error,
    testRunId,
    baselineRunIds,
    panels,
    alignment,
    sloWarnings,
    sloCheckPending: valid && checkedSpecHash !== null && checkedSpecHash !== specHash,
  };
}
