'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Slider, Typography, Box, CircularProgress, Alert, useTheme,
  Checkbox, FormControlLabel,
} from '@mui/material';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend,
} from 'recharts';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { useDebounce } from '@/lib/hooks/use-debounce';

interface SummaryBucket {
  timeSeconds: number;
  throughput: number;
  avgResponseTime: number;
  errorsPerSecond: number;
}

interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: SummaryBucket[];
}

interface ScopeSkip {
  testRunId: string;
  completed: boolean;
  skipped?: 'running' | 'too-short' | 'not-writable';
}

interface ScopePreview {
  total: number;
  applicable: number;
  skipped: ScopeSkip[];
  /** The write will refuse this apply — more runs than the server's bulk limit. */
  exceedsCap: boolean;
}

/**
 * The PUT answers with the target run plus, on the applyToAll path only, the number of
 * runs actually written and the ones it declined to touch. See
 * `TestRunsMutationService.updateAnalysisTimeRange`.
 */
type AnalysisTimeRangeSaveResponse = TestRun & {
  affectedCount?: number;
  skipped?: ScopeSkip[];
};

interface Props {
  open: boolean;
  testRun: TestRun;
  timeseriesData: SummaryTimeseriesResponse;
  onClose: () => void;
  onSaved: (updated: TestRun) => void;
}

/**
 * The scope preview is a workload-wide query behind an authorization check, and the MUI
 * Slider reports every intermediate value of a drag (`onChange`, not `onChangeCommitted`).
 * Firing the preview off the raw offsets turns one drag into hundreds of overlapping
 * server-side scans. The slider, the chart and the offset labels stay on the raw values —
 * only the fetch waits for the drag to settle.
 */
const SCOPE_PREVIEW_DEBOUNCE_MS = 350;

/**
 * How long the dialog holds itself open to state what the bulk write actually changed.
 * `onSaved` closes it (TimingInformationSection), so the count has to be on screen before
 * that call, not after it.
 */
const BULK_SAVE_RESULT_DISPLAY_MS = 1200;

/** Referenced by the checkbox's aria-describedby — the count IS the safety mechanism. */
const SCOPE_DESCRIPTION_ID = 'analysis-time-range-scope-description';

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function AnalysisTimeRangeDialog({ open, testRun, timeseriesData, onClose, onSaved }: Props) {
  const theme = useTheme();
  const duration = timeseriesData.duration;

  const [localStart, setLocalStart] = useState(testRun.analysis_start_offset ?? 0);
  const [localEnd, setLocalEnd]     = useState(testRun.analysis_end_offset ?? 0);
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [scope, setScope]           = useState<ScopePreview | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ affectedCount: number; confirmedCount: number | null } | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  // Slider value: [startOffset, duration - endOffset]
  const sliderValue: [number, number] = [localStart, duration - localEnd];

  // The server measures the run as end_time - start_time and treats `duration` as
  // untrusted, because it is client-supplied — but the slider is scaled to `duration`.
  // Where the two disagree (a run seeded from a planned duration, or aborted early) the
  // slider would otherwise offer a whole band of offsets the API refuses with a 400.
  // Bound the window by whichever is smaller so the control cannot produce a rejection.
  const timestampLength =
    testRun.start_time && testRun.end_time
      ? (new Date(testRun.end_time).getTime() - new Date(testRun.start_time).getTime()) / 1000
      : null;
  const serverRunLength = timestampLength ?? duration;
  // Strictly less than: at exactly start+end the window is empty, which the server rejects.
  const maxTotalOffsets = Math.max(0, Math.floor(Math.min(duration, serverRunLength)) - 1);

  const handleSliderChange = useCallback((_: Event, value: number | number[]) => {
    const [left, right] = value as [number, number];
    const nextStart = Math.max(0, left);
    const nextEnd = Math.max(0, duration - right);
    // Never let the two exclusions consume the run: that is an EMPTY analysis window, and
    // the server rejects it rather than silently analysing everything.
    if (nextStart + nextEnd > maxTotalOffsets) { return; }
    setLocalStart(nextStart);
    setLocalEnd(nextEnd);
  }, [duration, maxTotalOffsets]);

  const effectiveDuration = Math.max(0, duration - localStart - localEnd);


  // Ask the server what this would actually change, rather than asserting "every run of
  // the workload" in prose. The server is the only place that knows which runs are still
  // running, too short for these offsets, or on a team the user cannot write — and the
  // preview shares its partition function with the write path, so the number shown is
  // the number that will be honoured.
  //
  // Re-fetched when the offsets move because "too short for these offsets" depends on them —
  // but off the DEBOUNCED offsets, so a slider drag issues one query rather than one per tick.
  const debouncedStart = useDebounce(localStart, SCOPE_PREVIEW_DEBOUNCE_MS);
  const debouncedEnd   = useDebounce(localEnd, SCOPE_PREVIEW_DEBOUNCE_MS);

  // True while the sliders have moved on but the preview has not been asked yet. The
  // displayed scope describes the previous window during this gap, so it counts as pending:
  // otherwise Save is briefly enabled against a count that no longer applies.
  const offsetsSettling = debouncedStart !== localStart || debouncedEnd !== localEnd;
  const scopePending = scopeLoading || offsetsSettling;

  useEffect(() => {
    if (!open || !applyToAll) {
      setScope(null);
      return;
    }
    let cancelled = false;
    // `cancelled` only suppresses the setState. Aborting is what stops the server from
    // running a superseded workload-wide scan to completion.
    const controller = new AbortController();
    setScopeLoading(true);
    authenticatedFetch(
      `/test-runs/${testRun.id}/analysis-time-range/scope?analysisStartOffset=${debouncedStart}&analysisEndOffset=${debouncedEnd}`,
      { signal: controller.signal },
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: ScopePreview) => { if (!cancelled) setScope(data); })
      .catch((err: unknown) => {
        // A superseded request is not a failed one — surfacing it as "could not determine"
        // would make every slider move look like a broken preview.
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        setScope(null);
      })
      .finally(() => { if (!cancelled) setScopeLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [open, applyToAll, testRun.id, debouncedStart, debouncedEnd]);

  // Un-ticking, or moving the sliders after confirming, invalidates the confirmation:
  // the user agreed to a specific blast radius, not to whatever it becomes next.
  useEffect(() => { setConfirming(false); }, [applyToAll, localStart, localEnd]);

  const skipCount = (reason: ScopeSkip['skipped']) =>
    scope?.skipped.filter((e) => e.skipped === reason).length ?? 0;

  const handleSave = async () => {
    // A workload-wide rewrite goes through a second click. The first Save arms the
    // warning showing the real count; only the second one sends. Single-run saves are
    // unaffected — this is not a confirmation for the common case.
    if (applyToAll && !confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authenticatedFetch(`/test-runs/${testRun.id}/analysis-time-range`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisStartOffset: localStart, analysisEndOffset: localEnd, applyToAll }),
      });
      if (!res.ok) {
        // The server explains WHY (which runs, which limit, how long the run actually is).
        // Throwing a bare status code discarded the only useful part of the response.
        // try/catch around the whole extraction, not just the promise: a body that is not
        // JSON at all (an HTML error page from a proxy) throws rather than rejecting.
        let detail: string | undefined;
        try {
          const body = (await res.json()) as { message?: string | string[] } | undefined;
          detail = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
        } catch {
          detail = undefined;
        }
        throw new Error(detail || `Failed to save analysis time range (HTTP ${res.status})`);
      }
      const updated: AnalysisTimeRangeSaveResponse = await res.json();

      // A run can finish, or be created, between the preview and the PUT — so the number
      // written is not necessarily the number the user confirmed. The server reports the
      // real one on the applyToAll path; report that rather than the count we guessed.
      if (applyToAll && typeof updated.affectedCount === 'number') {
        setBulkResult({ affectedCount: updated.affectedCount, confirmedCount: scope?.applicable ?? null });
        // onSaved closes the dialog, so it has to wait for the count to be readable.
        closeTimerRef.current = setTimeout(() => onSaved(updated), BULK_SAVE_RESULT_DISPLAY_MS);
        return;
      }
      onSaved(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  };

  // The write has landed and the dialog is only still open to report it — nothing here is
  // re-submittable any more.
  const busy = saving || bulkResult !== null;

  const chartData = useMemo(() => timeseriesData.buckets.map(b => ({
    ...b,
    name: formatSeconds(b.timeSeconds),
  })), [timeseriesData.buckets]);

  // Snap to nearest bucket name for ReferenceArea/ReferenceLine —
  // Recharts categorical x-axis requires exact data key matches.
  const snapToNearest = useCallback((targetSeconds: number) => {
    if (chartData.length === 0) return '';
    return chartData.reduce((prev, curr) =>
      Math.abs(curr.timeSeconds - targetSeconds) < Math.abs(prev.timeSeconds - targetSeconds) ? curr : prev
    ).name;
  }, [chartData]);

  const startLine = snapToNearest(localStart);
  const endLine   = snapToNearest(duration - localEnd);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Change Analysis Time Range</DialogTitle>

      <DialogContent sx={{ pb: 0 }}>
        {/* Chart */}
        <Box sx={{ height: 220, mb: 2, background: theme.palette.mode === 'dark' ? '#0f172a' : '#f8fafc', borderRadius: 1, p: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.mode === 'dark' ? '#1e293b' : '#e2e8f0'} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />

              {/* Excluded start region */}
              {localStart > 0 && (
                <ReferenceArea yAxisId="left" x1={chartData[0]?.name} x2={startLine} fill="rgba(0,0,0,0.35)" />
              )}
              {/* Excluded end region */}
              {localEnd > 0 && (
                <ReferenceArea yAxisId="left" x1={endLine} x2={chartData[chartData.length - 1]?.name} fill="rgba(0,0,0,0.35)" />
              )}

              <Area yAxisId="left" type="monotone" dataKey="throughput" name="Throughput (tx/s)" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth={1.5} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="avgResponseTime" name="Avg RT (ms)" stroke="#6366f1" strokeWidth={1.5} dot={false} />
              <Area yAxisId="left" type="monotone" dataKey="errorsPerSecond" name="Errors/s" fill="rgba(239,68,68,0.15)" stroke="#ef4444" strokeWidth={1} dot={false} />

              {/* Boundary lines */}
              <ReferenceLine yAxisId="left" x={startLine} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
              <ReferenceLine yAxisId="left" x={endLine} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>

        {/* Slider */}
        <Box sx={{ px: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" color="text.secondary">0s</Typography>
            <Typography variant="caption" color="text.secondary">{formatSeconds(duration)}</Typography>
          </Box>
          <Slider
            value={sliderValue}
            onChange={handleSliderChange}
            min={0}
            max={duration}
            step={1}
            sx={{ color: '#6366f1', '& .MuiSlider-thumb': { backgroundColor: '#f59e0b' } }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption">
              <span style={{ color: '#94a3b8' }}>Start offset: </span>
              <strong>{formatSeconds(localStart)}</strong>
            </Typography>
            <Typography variant="caption" color="success.main">
              Effective: <strong>{formatSeconds(effectiveDuration)}</strong>
            </Typography>
            <Typography variant="caption">
              <span style={{ color: '#94a3b8' }}>End offset: </span>
              <strong>{formatSeconds(localEnd)}</strong>
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      {saveError && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>
        </Box>
      )}

      <Box sx={{ px: 3, pb: 0.5 }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              disabled={busy}
              // Without this a screen reader announces only "Apply to all test runs of this
              // workload, checkbox" — the applicable-of-total count below is the whole
              // reason the confirmation means anything. It has to go through inputProps:
              // MUI spreads unrecognised props onto the root span, and the description has
              // to sit on the input that actually carries the checkbox role.
              inputProps={{ 'aria-describedby': SCOPE_DESCRIPTION_ID }}
            />
          }
          label={
            <Typography variant="body2">
              Apply to all test runs of this workload
            </Typography>
          }
        />
        <Box id={SCOPE_DESCRIPTION_ID} sx={{ ml: 4, mt: -0.5 }}>
          {!applyToAll && (
            <Typography variant="caption" color="text.secondary" display="block">
              Only this run changes. Its baseline runs keep their current analysis window, so the
              comparison spans two different windows.
            </Typography>
          )}

          {applyToAll && scopePending && (
            <Typography variant="caption" color="text.secondary" display="block">
              Checking which runs this would change…
            </Typography>
          )}

          {applyToAll && !scopePending && scope?.exceedsCap && (
            <Typography variant="caption" color="error.main" display="block">
              <strong>{scope.applicable}</strong> runs is more than can be applied at once.
              The server refuses a bulk apply above its limit, so narrow the scope or change
              these runs in smaller groups.
            </Typography>
          )}

          {applyToAll && !scopePending && scope && !scope.exceedsCap && (
            <>
              <Typography variant="caption" color="text.secondary" display="block">
                <strong>{scope.applicable}</strong> of {scope.total} run
                {scope.total === 1 ? '' : 's'} in {testRun.test_environment} / {testRun.workload} will
                get these offsets and be re-evaluated. ADAPT compares a run against a baseline of
                other runs, so they only stay comparable while they share the same analysis window.
              </Typography>
              {scope.skipped.length > 0 && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  Leaving {scope.skipped.length} unchanged:
                  {skipCount('running') > 0 && ` ${skipCount('running')} still running,`}
                  {skipCount('too-short') > 0 && ` ${skipCount('too-short')} shorter than these offsets,`}
                  {skipCount('not-writable') > 0 && ` ${skipCount('not-writable')} on another team,`}
                  {' '}so their analysis is untouched.
                </Typography>
              )}
            </>
          )}

          {applyToAll && !scopePending && !scope && (
            <Typography variant="caption" color="warning.main" display="block">
              Could not determine how many runs this affects. Saving will still apply it to every
              eligible run of this workload.
            </Typography>
          )}
        </Box>
      </Box>

      {bulkResult && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="success">
            Applied to <strong>{bulkResult.affectedCount}</strong> run
            {bulkResult.affectedCount === 1 ? '' : 's'} — re-analysis enqueued.
            {bulkResult.confirmedCount !== null && bulkResult.confirmedCount !== bulkResult.affectedCount && (
              <> The preview showed {bulkResult.confirmedCount}; the workload changed in between.</>
            )}
          </Alert>
        </Box>
      )}

      {confirming && !bulkResult && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="warning">
            This rewrites the analysis window on{' '}
            <strong>{scope ? scope.applicable : 'every eligible'}</strong> run
            {scope && scope.applicable === 1 ? '' : 's'} and re-evaluates {scope && scope.applicable === 1 ? 'it' : 'them'}.
            Previous ADAPT verdicts for those runs are recomputed. Press Save again to confirm.
          </Alert>
        </Box>
      )}

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          color={applyToAll && confirming ? 'warning' : 'primary'}
          disabled={busy || (applyToAll && (scopePending || scope?.exceedsCap === true))}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {applyToAll && confirming
            ? `Confirm — change ${scope ? scope.applicable : 'all'} run${scope && scope.applicable === 1 ? '' : 's'}`
            : 'Save & Re-analyse'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
