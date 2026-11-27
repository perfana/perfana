'use client';

// Root Cause Analysis card for Loki logs: what the run's logs did, from one request
// (GET /loki/runs/:testRunId/summary). Nothing here asks Loki itself: the panel totals come from
// the analysis' statistics, and the patterns and error lines from the snapshot the worker took
// at analysis, so the card still works after Loki's retention has dropped the window.
//
// Sections, most diagnostic first: error rate against the baseline, the top log patterns with the
// ones new since the baseline flagged, the latest error lines, then each panel's series.

import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Collapse, Divider, IconButton, Link, Menu,
  Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, MoreVert, OpenInNew } from '@mui/icons-material';
import { useEffect } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchControlGroup, type ControlGroup } from '@/lib/control-group-baseline';
import type { RelatedTestRun } from '../compare/types';
import { controlGroupOption } from '../compare/utils/compare-utils';
import { BaselineTestRunSelect } from '../shared/BaselineTestRunSelect';
import {
  fetchLokiPanelLinks, fetchLokiRunSummary, LokiErrorRate, LokiRunBaseline, LokiRunPanel, LokiRunPattern, LokiRunSample, LokiRunService, LokiRunSummary, NO_SERVICE,
} from '@/lib/loki';
import ExpandableCardHeader from '../shared/ExpandableCardHeader';
import { buildSystemConfigUrl } from '@/lib/system-config-url';
import KPIDisplay from '../shared/KPIDisplay';
import SoftBadge from '../shared/SoftBadge';
import { OpenInCardMenuItems } from '../shared/metric-card-links';
import RowCommentButton from '../comments/RowCommentButton';
import { useCommentItemCounts, useCommentItemFocus } from '../comments/CommentsContext';
import type { CommentItemCounts } from '@/lib/test-run-comments';

const LOKI_ORANGE = '#F2A900';
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };
const MAX_ROWS = 10;
/** Applications that get a tab of their own, worst first; the rest are reached from the All tab's table. */
const MAX_APP_TABS = 20;
const ALL_TAB = '__all__';
const PATTERN_ROWS = 15;
const SAMPLE_ROWS = 10;

/** Level spellings counted as errors; mirrors `isErrorLevel` in the shared Loki client. */
const ERROR_LEVELS = new Set(['error', 'err', 'fatal', 'critical', 'crit', 'panic', 'emerg', 'emergency', 'alert', 'severe']);
export const isErrorName = (name: string | null | undefined): boolean => !!name && ERROR_LEVELS.has(name.trim().toLowerCase());

/**
 * Error-rate ratio over baseline worth flagging. A ratio of rates, so a 0.1% → 0.3% change is
 * flagged as well as 10% → 30%; below `MIN_PCT_POINTS` absolute it is noise either way.
 */
const WORSE_RATIO = 1.5;
const MIN_PCT_POINTS = 0.1;

interface LokiCardProps {
  testRun: { test_run_id: string; system_under_test_id?: string; test_environment?: string | null; workload?: string | null };
  expanded: boolean;
  onExpand: () => void;
}

/** Comment anchor for a panel. Panel ids repeat across dashboards, so the title goes with it. */
const panelKey = (p: LokiRunPanel) => `panel:${p.panelId}|${p.title}`;
/**
 * Comment anchor for a pattern: its text, which is what stays stable across re-analyses, plus the
 * application it was taken for (the same text can be a pattern of several applications).
 */
const patternKey = (p: Pick<LokiRunPattern, 'pattern' | 'service'>) =>
  p.service ? `pattern:${JSON.stringify([p.service, p.pattern])}` : `pattern:${p.pattern}`;

const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toLocaleString(undefined, { maximumFractionDigits: digits });

export function formatPct(pct: number): string {
  if (pct > 0 && pct < 0.01) return '<0.01%';
  return `${pct.toFixed(pct >= 10 ? 1 : 2)}%`;
}

/** 'worse' | 'better' | 'same' | null — the error rate against its baseline. */
export function errorRateTrend(rate: LokiErrorRate | null): 'worse' | 'better' | 'same' | null {
  if (!rate?.baseline) return null;
  const now = rate.errorRatePct;
  const was = rate.baseline.errorRatePct;
  if (Math.abs(now - was) < MIN_PCT_POINTS) return 'same';
  if (was === 0) return now > 0 ? 'worse' : 'same';
  const ratio = now / was;
  return ratio >= WORSE_RATIO ? 'worse' : ratio <= 1 / WORSE_RATIO ? 'better' : 'same';
}

type Configured = Extract<LokiRunSummary, { configured: true }>;

/** What the card shows for one scope: all applications (`app` null) or one application. */
export interface ScopeView {
  app: string | null;
  rate: LokiErrorRate | null;
  /** Lines in scope, also when there is no error rate (no level panel, or no level on the lines). */
  totalLines: number | null;
  /** The level label is on none of the run's lines, so error counts mean nothing. */
  levelMissing: boolean;
  patterns: LokiRunPattern[];
  newPatterns: number | null;
  patternsSource: string | null;
  samples: LokiRunSample[];
  /** For "Not seen in the N baseline runs". */
  baselineRuns: number;
}

/**
 * The summary narrowed to one application. Rows written before the Applications view carry no
 * `service` and read as all-streams rows. An application with no lines of its own in the snapshot
 * (it was outside the busiest ones) falls back to the all-streams lines that carry its label.
 */
export function scopeOf(summary: Configured, app: string | null, serviceLabel: string): ScopeView {
  const svcOf = (x: { service?: string | null }) => x.service ?? null;
  const levelMissing = !!summary.levelLabelMissing;
  if (app === null) {
    const services = summary.services ?? [];
    return {
      app,
      rate: summary.errorRate,
      totalLines: summary.errorRate?.totalLines ?? (services.length > 0 ? services.reduce((n, x) => n + x.totalLines, 0) : null),
      levelMissing,
      patterns: summary.patterns.filter((p) => svcOf(p) === null),
      newPatterns: summary.newPatterns,
      patternsSource: summary.patternsSource,
      samples: summary.samples.filter((x) => svcOf(x) === null),
      baselineRuns: summary.baselineRunCount ?? 0,
    };
  }
  const svc = summary.services?.find((x) => x.service === app);
  const patterns = summary.patterns.filter((p) => svcOf(p) === app);
  const own = summary.samples.filter((x) => svcOf(x) === app);
  return {
    app,
    // With no level on the lines the snapshot's error counts are all 0: show the lines, not a 0% rate.
    rate: svc && !levelMissing ? { totalLines: svc.totalLines, errorLines: svc.errorLines, errorRatePct: svc.errorRatePct, baseline: svc.baseline } : null,
    totalLines: svc?.totalLines ?? null,
    levelMissing,
    patterns,
    newPatterns: svc?.newPatterns ?? null,
    patternsSource: patterns[0]?.source ?? summary.patternsSource,
    samples: own.length > 0 ? own : summary.samples.filter((x) => svcOf(x) === null && x.labels?.[serviceLabel] === app),
    baselineRuns: svc?.baseline?.runs ?? summary.baselineRunCount ?? 0,
  };
}

const levelColor = (level: string | null): 'error' | 'warning' | 'default' =>
  isErrorName(level) ? 'error' : level === 'warn' ? 'warning' : 'default';

export default function LokiCard({ testRun, expanded, onExpand }: LokiCardProps) {
  const [summary, setSummary] = useState<LokiRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(null);
  const commentCounts = useCommentItemCounts('loki', expanded);
  useCommentItemFocus('loki', (key) => {
    if (!summary?.configured) return false;
    if (summary.panels.some((p) => panelKey(p) === key)) return true;
    const pattern = summary.patterns.find((p) => patternKey(p) === key);
    if (!pattern) return false;
    // A pattern of another scope is not on screen: switch to its scope, ready on the next check.
    const scope = pattern.service ?? null;
    if (scope !== app) {
      setApp(scope);
      return false;
    }
    return true;
  });

  // null: the API's default (the control group, else the previous runs). Otherwise what was picked.
  // A pick belongs to the run it was made on: another run starts again from the default, in the
  // same render, so the summary is never fetched for the new run with the old run's pick.
  const [pickState, setPickState] = useState<{ runId: string; id: string | null }>({ runId: testRun.test_run_id, id: null });
  const baselinePick = pickState.runId === testRun.test_run_id ? pickState.id : null;
  const setBaselinePick = (id: string | null) => setPickState({ runId: testRun.test_run_id, id });
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const baselineOptions = useBaselineOptions(testRun, expanded);
  const appLinks = useAppPanelLinks(testRun.test_run_id, expanded ? app : null);
  useEffect(() => { setBaselineError(null); }, [testRun.test_run_id]);

  useEffect(() => {
    let cancelled = false;
    setReloading(true);
    fetchLokiRunSummary(testRun.test_run_id, baselinePick)
      .then((s) => { if (!cancelled) { setSummary(s); setBaselineError(null); } })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load';
        // A picked baseline that fails keeps the card on what it showed; the first load failing
        // (an API without the route, or a run outside the caller's scope) reads as "no Loki".
        if (baselinePick !== null) setBaselineError(message);
        else setError(message);
      })
      .finally(() => { if (!cancelled) setReloading(false); });
    return () => { cancelled = true; };
  }, [testRun.test_run_id, baselinePick]);

  if (error || (summary && !summary.configured)) return null;

  const configured = summary?.configured ? summary : null;
  const hasData = !!configured?.panels.some((p) => p.series.length > 0);
  const rate = configured?.errorRate ?? null;
  const trend = errorRateTrend(rate);
  const serviceLabel = configured?.connection?.serviceLabel || 'service_name';
  const overall = configured ? scopeOf(configured, null, serviceLabel) : null;
  const errorPatterns = overall?.patterns.filter((p) => isErrorName(p.level)) ?? [];
  const newErrorPatterns = errorPatterns.filter((p) => p.isNew).length;
  const services = (configured?.services ?? []).filter((x) => x.totalLines > 0);
  const worseServices = services.filter((x) => x.service !== NO_SERVICE && errorRateTrend(x) === 'worse');
  const scope = configured && app !== null && services.some((x) => x.service === app) ? scopeOf(configured, app, serviceLabel) : overall;
  const scopeTrend = errorRateTrend(scope?.rate ?? null);

  return (
    <Box sx={{ gridColumn: expanded ? '1 / -1' : 'auto', height: expanded ? 'auto' : '293px', display: 'flex', flexDirection: 'column' }}>
      <Card
        tabIndex={-1}
        data-testid={expanded ? 'loki-card-expanded' : 'loki-card-collapsed'}
        elevation={0}
        onClick={expanded ? undefined : onExpand}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: '100%',
          borderRadius: 3,
          bgcolor: 'background.paper',
          borderTop: `3px solid ${LOKI_ORANGE}`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: expanded ? 'visible' : 'hidden',
          '&:hover': expanded ? {} : { transform: 'translateY(-4px)' },
        }}
      >
        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 3.5, pt: 4, '&:last-child': { pb: 3.5 } }}>
          <ExpandableCardHeader
            title="Loki Logs"
            expanded={expanded}
            onToggle={onExpand}
            settingsUrl={testRun.system_under_test_id ? buildSystemConfigUrl({
              systemId: testRun.system_under_test_id,
              tab: 'loki',
              environment: testRun.test_environment,
              workload: testRun.workload,
              fromTestRun: testRun.test_run_id,
            }) : undefined}
          />

          {!summary && (
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {!expanded && configured && (
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box sx={{ py: 1 }}>
                {rate ? (
                  <KPIDisplay
                    value={formatPct(rate.errorRatePct)}
                    label="Error lines"
                    color={trend === 'worse' ? 'error' : rate.errorLines > 0 ? 'warning' : 'success'}
                  />
                ) : errorPatterns.length > 0 ? (
                  <KPIDisplay value={errorPatterns.length} label="Error patterns" color="error" />
                ) : (
                  <KPIDisplay value={configured.panels.length} label="Log panels" color={hasData ? 'primary' : 'neutral'} />
                )}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                {rate?.baseline && (
                  <SoftBadge
                    label={`baseline ${formatPct(rate.baseline.errorRatePct)}`}
                    color={trend === 'worse' ? 'red' : trend === 'better' ? 'green' : 'neutral'}
                  />
                )}
                {configured.newPatterns !== null && configured.newPatterns > 0 && (
                  <SoftBadge count={configured.newPatterns} label={configured.newPatterns === 1 ? 'new pattern' : 'new patterns'} color={newErrorPatterns > 0 ? 'red' : 'orange'} />
                )}
                {services.length > 1 && (
                  <SoftBadge count={services.length} label="applications" color="neutral" />
                )}
                {worseServices.length > 0 && (
                  <SoftBadge
                    label={worseServices.length === 1 ? `${worseServices[0]!.service}: more errors` : `${worseServices.length} applications with more errors`}
                    color="red"
                  />
                )}
                {!hasData && configured.patterns.length === 0 && <SoftBadge label="No log data for this run" color="orange" />}
                {configured.levelLabelMissing && <SoftBadge label="No log level on these lines" color="orange" />}
                <SoftBadge count={configured.sources.length} label={configured.sources.length === 1 ? 'stream selector' : 'stream selectors'} color="neutral" />
              </Box>
            </Box>
          )}

          <Collapse in={expanded && !!configured}>
            {configured && (
              <Box>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      {configured.connection?.label ?? 'Loki'}
                      {configured.window && ` · ${new Date(configured.window.from).toLocaleString()} – ${new Date(configured.window.to).toLocaleTimeString()}`}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                      {configured.sources.map((m) => (
                        <Chip
                          key={m.id}
                          size="small"
                          variant="outlined"
                          label={m.selector}
                          sx={{ ...MONO, fontSize: 12, maxWidth: '100%' }}
                          {...(m.exploreUrl ? { component: 'a', href: m.exploreUrl, target: '_blank', rel: 'noopener noreferrer', clickable: true, icon: <OpenInNew sx={{ fontSize: 14 }} /> } : {})}
                        />
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <BaselinePicker
                      summary={configured}
                      options={baselineOptions}
                      onPick={setBaselinePick}
                      reloading={reloading}
                      error={baselineError}
                    />
                    {(configured.exploreUrl ?? configured.sources[0]?.exploreUrl) && (
                      <Button size="small" variant="outlined" endIcon={<OpenInNew fontSize="small" />} href={(configured.exploreUrl ?? configured.sources[0]?.exploreUrl)!} target="_blank" rel="noopener noreferrer" sx={{ height: 40, whiteSpace: 'nowrap' }}>
                        Open in Grafana Explore
                      </Button>
                    )}
                  </Box>
                </Box>

                {configured.levelLabelMissing && <LevelMissingAlert connection={configured.connection} />}

                {services.length > 0 && (
                  <ApplicationTabs services={services} serviceLabel={serviceLabel} selected={scope?.app ?? null} onSelect={setApp} />
                )}

                {services.length > 0 && !scope?.app && (
                  <ApplicationsSection services={services} serviceLabel={serviceLabel} onSelect={setApp} />
                )}

                {scope && <KpiStrip scope={scope} trend={scopeTrend} />}

                {!hasData && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    No Loki metrics were collected for this run. Runs analysed before the panels existed can be filled with a
                    force re-fetch, as long as Loki still holds the window.
                  </Alert>
                )}

                {scope && <PatternsSection key={`p-${scope.app ?? ''}`} scope={scope} commentCounts={commentCounts} />}
                {scope && <SamplesSection key={`s-${scope.app ?? ''}`} samples={scope.samples} app={scope.app} />}

                <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 3, mb: 1 }}>Panels</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(auto-fit, minmax(360px, 1fr))' }, gap: 3 }}>
                  {configured.panels.map((p) => {
                    const id = panelKey(p);
                    return (
                      <PanelSummary
                        key={id}
                        panel={p}
                        commentCounts={commentCounts}
                        app={scope?.app ?? null}
                        service={scope?.app ? services.find((x) => x.service === scope.app) : undefined}
                        link={scope?.app ? appLinks?.get(`${p.panelId}|${p.title}`) ?? null : p.link}
                        serviceLabel={serviceLabel}
                      />
                    );
                  })}
                </Box>
                {scope?.app && configured.panels.some((p) => p.splitBy !== serviceLabel && !p.isLevelPanel) && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Panels not split by {serviceLabel} show all applications.
                  </Typography>
                )}
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}

/**
 * All, then one tab per application (a value of the connection's service label), worst first, each
 * with its error lines. A tab narrows the KPIs, patterns, lines and service-split panels below it.
 * An application past MAX_APP_TABS still gets a tab while it is the selected one (chosen from the
 * All table), so the bar always shows where you are.
 */
function ApplicationTabs({ services, serviceLabel, selected, onSelect }: {
  services: LokiRunService[]; serviceLabel: string; selected: string | null; onSelect: (app: string | null) => void;
}) {
  const named = services.filter((s) => s.service !== NO_SERVICE);
  const tabs = named.slice(0, MAX_APP_TABS);
  const extra = selected && !tabs.some((s) => s.service === selected) ? named.find((s) => s.service === selected) : undefined;
  if (extra) tabs.push(extra);
  return (
    <Tabs
      value={selected ?? ALL_TAB}
      onChange={(_, v: string) => onSelect(v === ALL_TAB ? null : v)}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label={`Applications by ${serviceLabel}`}
      sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
    >
      <Tab value={ALL_TAB} label={`All applications (${named.length})`} />
      {tabs.map((s) => {
        const worse = errorRateTrend(s) === 'worse';
        return (
          <Tab
            key={s.service}
            value={s.service}
            aria-label={s.service}
            label={(
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box component="span" sx={MONO}>{s.service}</Box>
                {s.errorLines > 0 && (
                  <Chip size="small" color={worse ? 'error' : 'warning'} variant={worse ? 'filled' : 'outlined'} label={`${fmt(s.errorLines)}${worse ? ' ↑' : ''}`} sx={{ height: 18, fontSize: 10 }} />
                )}
                {s.isNew && <Chip size="small" color="error" label="NEW" sx={{ height: 18, fontSize: 10 }} />}
              </Box>
            )}
          />
        );
      })}
    </Tabs>
  );
}

/**
 * The All tab's overview: one row per application, most error lines first. A row opens that
 * application's tab.
 */
function ApplicationsSection({ services, serviceLabel, onSelect }: {
  services: LokiRunService[]; serviceLabel: string; onSelect: (app: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? services : services.slice(0, MAX_ROWS);
  const topRate = Math.max(0.01, ...rows.map((s) => Math.max(s.errorRatePct, s.baseline?.errorRatePct ?? 0)));
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" fontWeight={600}>Applications</Typography>
      <Typography variant="caption" color="text.secondary">
        Lines per <code>{serviceLabel}</code> in the run, against the same application in the baseline runs. Open a row, or its tab above, to see that application alone.
      </Typography>
      <Table size="small" sx={{ mt: 1, '& td, & th': { px: 1 } }}>
        <TableHead>
          <TableRow>
            <TableCell>Application</TableCell>
            <TableCell align="right">Lines</TableCell>
            <TableCell align="right">Errors</TableCell>
            <TableCell sx={{ width: { xs: 120, md: 220 } }}>Error rate</TableCell>
            <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>Baseline</TableCell>
            <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>New patterns</TableCell>
            <TableCell sx={{ width: 40 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((s) => {
            const none = s.service === NO_SERVICE;
            const t = errorRateTrend(s);
            return (
              <TableRow
                key={s.service}
                hover={!none}
                onClick={none ? undefined : () => onSelect(s.service)}
                sx={{ cursor: none ? 'default' : 'pointer' }}
              >
                <TableCell sx={MONO}>
                  {none ? (
                    <Tooltip title={`Lines with no ${serviceLabel} label`}><span>(no {serviceLabel})</span></Tooltip>
                  ) : (
                    <Link
                      component="button"
                      type="button"
                      underline="hover"
                      aria-label={`Show ${s.service}`}
                      onClick={(e) => { e.stopPropagation(); onSelect(s.service); }}
                      sx={{ ...MONO, verticalAlign: 'baseline' }}
                    >
                      {s.service}
                    </Link>
                  )}
                  {s.isNew && <Chip size="small" color="error" label="NEW" sx={{ height: 18, fontSize: 10, ml: 0.75 }} />}
                </TableCell>
                <TableCell align="right" sx={MONO}>{fmt(s.totalLines)}</TableCell>
                <TableCell align="right" sx={{ ...MONO, color: s.errorLines > 0 ? 'readable.error' : 'text.primary' }}>{fmt(s.errorLines)}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ position: 'relative', flex: 1, height: 8, borderRadius: 1, bgcolor: 'action.hover', display: { xs: 'none', md: 'block' } }}>
                      <Box sx={{ position: 'absolute', inset: '0 auto 0 0', borderRadius: 1, width: `${Math.min(100, (s.errorRatePct / topRate) * 100)}%`, bgcolor: t === 'worse' ? 'error.main' : LOKI_ORANGE }} />
                      {s.baseline && (
                        <Box
                          aria-hidden
                          title={`Baseline ${formatPct(s.baseline.errorRatePct)}`}
                          sx={{ position: 'absolute', top: -2, bottom: -2, width: 2, bgcolor: 'text.primary', left: `${Math.min(100, (s.baseline.errorRatePct / topRate) * 100)}%` }}
                        />
                      )}
                    </Box>
                    <Typography component="span" sx={{ ...MONO, minWidth: 56, textAlign: 'right' }}>{formatPct(s.errorRatePct)}</Typography>
                  </Box>
                </TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  {s.baseline ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={t === 'worse' ? 'error' : t === 'better' ? 'success' : 'default'}
                      label={`${formatPct(s.baseline.errorRatePct)}${t === 'worse' ? ' ↑' : t === 'better' ? ' ↓' : ''}`}
                      sx={{ ...MONO, fontSize: 12 }}
                    />
                  ) : <Typography component="span" variant="caption" color="text.secondary">–</Typography>}
                </TableCell>
                <TableCell align="right" sx={{ ...MONO, display: { xs: 'none', md: 'table-cell' } }}>{s.newPatterns ?? '–'}</TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  {s.exploreUrl && (
                    <Tooltip title="Open this application's lines in Grafana Explore">
                      <IconButton size="small" component={Link} href={s.exploreUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.service} in Grafana Explore`}>
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {services.length > MAX_ROWS && (
        <Button size="small" onClick={() => setShowAll((v) => !v)} startIcon={showAll ? <ExpandLess /> : <ExpandMore />} sx={{ mt: 0.5 }}>
          {showAll ? 'Show fewer' : `Show all ${services.length}`}
        </Button>
      )}
    </Box>
  );
}

function KpiStrip({ scope, trend }: { scope: ScopeView; trend: ReturnType<typeof errorRateTrend> }) {
  const rate = scope.rate;
  const errorPatterns = scope.patterns.filter((p) => isErrorName(p.level));
  return (
    <Box
      sx={{
        display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3,
        p: 2, border: 1, borderColor: 'divider', borderRadius: 2,
      }}
    >
      <KPIDisplay value={rate ? fmt(rate.totalLines) : scope.totalLines !== null ? fmt(scope.totalLines) : '–'} label="Log lines" color="neutral" />
      <KPIDisplay value={rate ? fmt(rate.errorLines) : fmt(errorPatterns.reduce((n, p) => n + p.count, 0) || null)} label="Error lines" color={(rate?.errorLines ?? 0) > 0 ? 'error' : 'neutral'} />
      <Box>
        <KPIDisplay
          value={rate ? formatPct(rate.errorRatePct) : '–'}
          label={rate?.baseline ? `Error rate · baseline ${formatPct(rate.baseline.errorRatePct)}` : 'Error rate'}
          color={trend === 'worse' ? 'error' : trend === 'better' ? 'success' : 'neutral'}
        />
        {!rate && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
            {scope.levelMissing
              ? 'No log level on these lines (see above).'
              : scope.app ? 'No line counts for this application in the snapshot.' : 'Add the \u201cLog lines by level\u201d starter panel to get the error rate.'}
          </Typography>
        )}
        {rate?.baseline && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
            {trend === 'worse' ? 'Higher than' : trend === 'better' ? 'Lower than' : 'In line with'} the {rate.baseline.runs} baseline run{rate.baseline.runs === 1 ? '' : 's'}
          </Typography>
        )}
      </Box>
      <Box>
        <KPIDisplay
          value={scope.newPatterns ?? '–'}
          label="New patterns"
          color={(scope.newPatterns ?? 0) > 0 ? (errorPatterns.some((p) => p.isNew) ? 'error' : 'warning') : 'neutral'}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
          {scope.newPatterns === null
            ? scope.patterns.length > 0 ? 'No baseline run has a pattern snapshot yet' : scope.app ? 'No patterns for this application' : 'No pattern snapshot for this run'
            : `Not seen in the ${scope.baselineRuns} baseline run${scope.baselineRuns === 1 ? '' : 's'}`}
        </Typography>
      </Box>
    </Box>
  );
}

type PatternFilter = 'all' | 'problems' | 'new';

function PatternsSection({ scope, commentCounts }: { scope: ScopeView; commentCounts: CommentItemCounts }) {
  const [filter, setFilter] = useState<PatternFilter>('problems');
  const [showAll, setShowAll] = useState(false);
  const total = scope.patterns.reduce((n, p) => n + p.count, 0);
  const visible = useMemo(() => scope.patterns.filter((p) =>
    filter === 'all' ? true : filter === 'new' ? p.isNew === true : isErrorName(p.level) || p.level === 'warn'), [scope.patterns, filter]);
  const rows = showAll ? visible : visible.slice(0, PATTERN_ROWS);
  const top = Math.max(1, ...rows.map((p) => p.count));

  if (scope.patterns.length === 0) {
    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600}>Top log patterns</Typography>
        <Typography variant="body2" color="text.secondary">
          {scope.app
            ? 'No patterns were taken for this application. Patterns are taken for the 20 applications with the most errors, and per application only when the service label is a stream label.'
            : 'No pattern snapshot for this run. Patterns are taken when the run is analysed; re-analyse it while Loki still holds the window.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>Top log patterns</Typography>
          <Typography variant="caption" color="text.secondary">
            {scope.patternsSource === 'sampled'
              ? 'Grouped by Perfana from up to 2,000 sampled error and warning lines (Loki\'s patterns API is not available), so counts are over the sample.'
              : 'Log line shapes Loki detected during the run, with variable parts shown as <_>.'}
          </Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_e, v: PatternFilter | null) => v && setFilter(v)} aria-label="Which patterns to show">
          <ToggleButton value="problems">Errors &amp; warnings</ToggleButton>
          <ToggleButton value="new" disabled={scope.newPatterns === null}>New{scope.newPatterns ? ` (${scope.newPatterns})` : ''}</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {filter === 'new' ? 'No pattern is new since the baseline.' : 'No error or warning pattern in this run.'}
        </Typography>
      ) : (
        <Table size="small" sx={{ '& td, & th': { px: 1 }, tableLayout: 'fixed' }}>
          <TableHead>
            <TableRow>
              <TableCell>Pattern</TableCell>
              <TableCell sx={{ width: 80 }}>Level</TableCell>
              <TableCell align="right" sx={{ width: 110 }}>Lines</TableCell>
              <TableCell sx={{ width: 140, display: { xs: 'none', md: 'table-cell' } }}>Seen</TableCell>
              <TableCell sx={{ width: 72 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => {
              const rowId = patternKey(p);
              return (
                <TableRow
                  key={rowId}
                  data-comment-item={rowId}
                  sx={{ '&:hover .row-comment-button, &:focus-within .row-comment-button': { opacity: 1 } }}
                >
                  <TableCell sx={{ position: 'relative', ...MONO, fontSize: 12, wordBreak: 'break-word' }}>
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute', inset: '4px auto 4px 0', borderRadius: 0.5,
                        width: `${Math.max(2, (p.count / top) * 100)}%`,
                        bgcolor: isErrorName(p.level) ? 'error.main' : LOKI_ORANGE, opacity: 0.12,
                      }}
                    />
                    <Box component="span" sx={{ position: 'relative' }}>
                      {p.isNew && <Chip size="small" color="error" label="NEW" sx={{ height: 18, fontSize: 10, mr: 0.75, fontFamily: 'inherit' }} />}
                      {p.pattern}
                    </Box>
                  </TableCell>
                  <TableCell>{p.level ? <Chip size="small" variant="outlined" color={levelColor(p.level)} label={p.level} sx={{ height: 20 }} /> : '–'}</TableCell>
                  <TableCell align="right" sx={MONO}>
                    {fmt(p.count)}
                    {total > 0 && <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>{formatPct((p.count / total) * 100)}</Typography>}
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Typography variant="caption" color="text.secondary">
                      {p.firstSeen ? new Date(p.firstSeen).toLocaleTimeString() : '–'}
                      {p.lastSeen && p.lastSeen !== p.firstSeen ? ` – ${new Date(p.lastSeen).toLocaleTimeString()}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <RowCommentButton card="loki" itemKey={rowId} itemLabel={p.pattern.slice(0, 200)} counts={commentCounts} />
                    {p.exploreUrl && (
                      <Tooltip title="Open the lines matching this pattern in Grafana Explore">
                        <IconButton size="small" component={Link} href={p.exploreUrl} target="_blank" rel="noopener noreferrer" aria-label="Open pattern in Grafana Explore">
                          <OpenInNew fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {visible.length > PATTERN_ROWS && (
        <Button size="small" onClick={() => setShowAll((v) => !v)} startIcon={showAll ? <ExpandLess /> : <ExpandMore />} sx={{ mt: 0.5 }}>
          {showAll ? 'Show fewer' : `Show all ${visible.length}`}
        </Button>
      )}
    </Box>
  );
}

function SamplesSection({ samples, app }: { samples: LokiRunSample[]; app: string | null }) {
  const [level, setLevel] = useState<'error' | 'warn'>('error');
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const errors = samples.filter((s) => isErrorName(s.level));
  const warns = samples.filter((s) => s.level === 'warn');
  const list = level === 'error' ? errors : warns;
  const rows = showAll ? list : list.slice(0, SAMPLE_ROWS);
  if (samples.length === 0 && !app) return null;
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>Latest log lines</Typography>
          <Typography variant="caption" color="text.secondary">The newest lines of the run, kept with it. Click a line to see all of it and its labels.</Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={level} onChange={(_e, v: 'error' | 'warn' | null) => { if (v) { setLevel(v); setOpen(null); } }} aria-label="Level">
          <ToggleButton value="error">Errors ({errors.length})</ToggleButton>
          <ToggleButton value="warn">Warnings ({warns.length})</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">None in this run.</Typography>
      ) : (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          {rows.map((s, i) => {
            const expandedRow = open === i;
            const service = s.labels.service_name ?? s.labels.app ?? s.labels.container ?? s.labels.job;
            return (
              <Box key={`${s.time}-${i}`} sx={{ borderTop: i === 0 ? 0 : 1, borderColor: 'divider' }}>
                <Box
                  component="button"
                  type="button"
                  aria-expanded={expandedRow}
                  onClick={() => setOpen(expandedRow ? null : i)}
                  sx={{
                    display: 'grid', gridTemplateColumns: { xs: '1fr', md: '90px 140px 1fr' }, gap: 1, width: '100%', textAlign: 'left',
                    border: 0, bgcolor: 'transparent', color: 'text.primary', cursor: 'pointer', px: 1.5, py: 0.75,
                    '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography component="span" variant="caption" color="text.secondary" sx={MONO}>{new Date(s.time).toLocaleTimeString()}</Typography>
                  <Typography component="span" variant="caption" color="text.secondary" noWrap>{service ?? ''}</Typography>
                  <Typography component="span" sx={{ ...MONO, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedRow ? 'pre-wrap' : 'nowrap', wordBreak: 'break-word' }}>
                    {s.line}
                  </Typography>
                </Box>
                {expandedRow && (
                  <Box sx={{ px: 1.5, pb: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {Object.entries(s.labels).map(([k, v]) => <Chip key={k} size="small" variant="outlined" label={`${k}=${v}`} sx={{ ...MONO, fontSize: 11 }} />)}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {list.length > SAMPLE_ROWS && (
        <Button size="small" onClick={() => setShowAll((v) => !v)} startIcon={showAll ? <ExpandLess /> : <ExpandMore />} sx={{ mt: 0.5 }}>
          {showAll ? 'Show fewer' : `Show all ${list.length}`}
        </Button>
      )}
    </Box>
  );
}

/**
 * The selected application's levels, for the level panel, which is not split by application: from
 * the run snapshot's lines per level for that application, which carry no per-bucket peak. A
 * snapshot taken before per-level counts has only error and warn, and the rest as "other levels".
 * Null outside an application tab.
 */
export function appLevelSeries(service: LokiRunService | undefined): LokiRunPanel['series'] | null {
  if (!service) return null;
  if (service.levels) {
    return Object.entries(service.levels)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => ({ name, total, mean: null, peak: null }));
  }
  const other = Math.max(0, service.totalLines - service.errorLines - service.warnLines);
  return [
    { name: 'error', total: service.errorLines },
    { name: 'warn', total: service.warnLines },
    { name: 'other levels', total: other },
  ].filter((r) => r.total > 0).map((r) => ({ ...r, mean: null, peak: null }));
}

/**
 * The panels' Explore links narrowed to the selected application, keyed `panelId|title`. Null on
 * the All tab and while loading: a panel shows no link then rather than one for every application.
 */
function useAppPanelLinks(testRunId: string, app: string | null) {
  const [links, setLinks] = useState<{ app: string; map: Map<string, string | null> } | null>(null);
  useEffect(() => {
    if (app === null) return;
    let cancelled = false;
    fetchLokiPanelLinks(testRunId, app)
      .then((rows) => { if (!cancelled) setLinks({ app, map: new Map(rows.map((r) => [`${r.panelId}|${r.title}`, r.link])) }); })
      .catch(() => { if (!cancelled) setLinks({ app, map: new Map() }); });
    return () => { cancelled = true; };
  }, [testRunId, app]);
  return app !== null && links?.app === app ? links.map : null;
}

function PanelSummary({ panel, commentCounts, app, service, serviceLabel, link }: {
  panel: LokiRunPanel; commentCounts: CommentItemCounts; app: string | null; service?: LokiRunService; serviceLabel: string;
  /** This panel's Explore link for the scope on screen (all applications, or the selected one). */
  link: string | null;
}) {
  const additive = /^(count|bytes|sum\()/.test(panel.aggregation.trim());
  const levels = app !== null && panel.isLevelPanel ? appLevelSeries(service) : null;
  // A panel split by the service label narrows to the selected application's row; its share stays
  // a share of the whole panel, which is what "how much of the log volume is this app" asks. The
  // level panel's shares are of the application's own lines.
  const narrowed = levels !== null || (app !== null && panel.splitBy === serviceLabel);
  const rows = (levels ?? (narrowed ? panel.series.filter((s) => s.name === app) : panel.series)).slice(0, MAX_ROWS);
  const total = additive ? (levels ?? panel.series).reduce((n, s) => n + (s.total ?? 0), 0) : 0;
  const top = Math.max(1, ...rows.map((s) => (additive ? s.total : s.mean) ?? 0));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);
  const valueLabel = panel.aggregation === 'count' ? 'Lines' : panel.aggregation === 'bytes' ? 'Bytes' : additive ? 'Total' : 'Mean';

  return (
    <Box
      data-comment-item={panelKey(panel)}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, '&:hover .row-comment-button, &:focus-within .row-comment-button': { opacity: 1 } }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={600}>{panel.title}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
            {panel.aggregation}{panel.splitBy ? ` by ${panel.splitBy}` : ''}
          </Typography>
          {levels && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {app} only, from the run&apos;s log snapshot
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <RowCommentButton card="loki" itemKey={panelKey(panel)} itemLabel={panel.title} counts={commentCounts} />
          {link && (
            <Tooltip title={app ? `Open this query for ${app} in Grafana Explore for the run window` : 'Open this query in Grafana Explore for the run window'}>
              <IconButton size="small" component={Link} href={link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${panel.title} in Grafana Explore`}>
                <OpenInNew fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {panel.series.length > 0 && (
            <Tooltip title="Open in Graphs, Compare or Trends">
              <IconButton
                size="small"
                aria-label={`Actions for ${panel.title}`}
                aria-haspopup="menu"
                aria-expanded={Boolean(menuAnchor)}
                onClick={(e) => setMenuAnchor(e.currentTarget)}
              >
                <MoreVert fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={closeMenu}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {/* No metric: the whole panel, every series it holds. */}
            <OpenInCardMenuItems series={{ dashboardLabel: panel.dashboardLabel, panelId: panel.panelId }} onClose={closeMenu} />
          </Menu>
        </Box>
      </Box>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No data for this run.</Typography>
      ) : (
        <Table size="small" sx={{ '& td, & th': { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell>Series</TableCell>
              <TableCell align="right">{valueLabel}</TableCell>
              {additive && <TableCell align="right">Share</TableCell>}
              <TableCell align="right">Peak / bucket</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((s) => {
              const value = additive ? s.total : s.mean;
              const isError = isErrorName(s.name);
              return (
                <TableRow key={s.name}>
                  <TableCell sx={{ position: 'relative', ...MONO }}>
                    {/* Share of the panel's busiest series, as a quiet bar behind the name. */}
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute', inset: '4px auto 4px 0', borderRadius: 0.5,
                        width: `${Math.max(2, ((value ?? 0) / top) * 100)}%`,
                        bgcolor: isError ? 'error.main' : LOKI_ORANGE, opacity: 0.14,
                      }}
                    />
                    <Box component="span" sx={{ position: 'relative', color: isError ? 'readable.error' : 'text.primary' }}>{s.name}</Box>
                  </TableCell>
                  <TableCell align="right" sx={MONO}>{fmt(value, additive ? 0 : 2)}</TableCell>
                  {additive && <TableCell align="right" sx={MONO}>{total > 0 && s.total !== null ? formatPct((s.total / total) * 100) : '–'}</TableCell>}
                  <TableCell align="right" sx={MONO}>{fmt(s.peak, 2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {!narrowed && panel.series.length > MAX_ROWS && (
        <Typography variant="caption" color="text.secondary">and {panel.series.length - MAX_ROWS} more</Typography>
      )}
    </Box>
  );
}

/**
 * The level panel came back as nothing but `(none)`: the connection's level label is on none of the
 * run's lines, so no error rate can be told apart (the API leaves it out rather than show 0%). The
 * usual cause is JSON or logfmt lines on a Loki that does not add `detected_level`.
 */
/**
 * The control group and the comparable runs of the workload: what the Compare card offers as a
 * baseline. Asked for once, on first expand.
 */
function useBaselineOptions(testRun: LokiCardProps['testRun'], enabled: boolean) {
  const [options, setOptions] = useState<{ runs: RelatedTestRun[]; controlGroup: ControlGroup | null } | null>(null);
  const runId = testRun.test_run_id;
  useEffect(() => {
    if (!enabled || options) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (testRun.test_environment) params.set('environment', testRun.test_environment);
    if (testRun.workload) params.set('workload', testRun.workload);
    const runs = authenticatedFetch(`/test-runs/${encodeURIComponent(runId)}/related${params.size ? `?${params}` : ''}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: RelatedTestRun[] | null) => (Array.isArray(d) ? d : []))
      .catch(() => [] as RelatedTestRun[]);
    Promise.all([runs, fetchControlGroup(runId)]).then(([r, g]) => {
      if (!cancelled) setOptions({ runs: r, controlGroup: g });
    });
    return () => { cancelled = true; };
  }, [enabled, options, runId, testRun.test_environment, testRun.workload]);
  useEffect(() => { setOptions(null); }, [runId]);
  return options;
}

/**
 * One line saying what the card compared with. The picker shows the choice; this says what that
 * resolved to, since the control group pools differently per figure and the default can fall back.
 */
export function baselineSummary(baseline: LokiRunBaseline | undefined, controlGroupRuns: number | null): string | null {
  if (!baseline) return null;
  const n = baseline.testRunIds.length;
  const runs = (k: number) => `${k} run${k === 1 ? '' : 's'}`;
  switch (baseline.kind) {
    case 'control-group':
      return `Error rates vs the whole control group${controlGroupRuns ? ` (${runs(controlGroupRuns)})` : ''}; new patterns vs its newest ${runs(n)}`;
    case 'run':
      return null; // the picker already names the run
    case 'previous-runs':
      return `No control group: compared with the ${runs(n)} before this one`;
    default:
      return 'Nothing to compare with: no control group and no earlier run';
  }
}

function BaselinePicker({ summary, options, onPick, reloading, error }: {
  summary: Configured;
  options: ReturnType<typeof useBaselineOptions>;
  onPick: (id: string | null) => void;
  reloading: boolean;
  error: string | null;
}) {
  const b = summary.baseline;
  // An API older than the picker answers no baseline: nothing to show or pick.
  if (!b) return null;
  let value: RelatedTestRun | null = null;
  if (b.kind === 'control-group' && options?.controlGroup) value = controlGroupOption(options.controlGroup);
  else if (b.kind === 'run' && b.testRunIds[0]) {
    value = options?.runs.find((r) => r.test_run_id === b.testRunIds[0]) ?? { test_run_id: b.testRunIds[0], created_at: '', completed: true };
  }
  const line = reloading ? 'Comparing…' : baselineSummary(b, options?.controlGroup?.n_test_runs ?? null);
  const detail = b.testRunIds.length > 0 ? `Compared with: ${b.testRunIds.join(', ')}` : undefined;
  return (
    <Box sx={{ width: { xs: '100%', sm: 380 } }}>
      <BaselineTestRunSelect
        relatedTestRuns={options?.runs ?? []}
        controlGroup={options?.controlGroup ?? null}
        value={value}
        onChange={(picked) => onPick(picked?.test_run_id ?? null)}
        label="Baseline"
        size="small"
        helperText={null}
        showCaption={false}
      />
      {line && (
        <Typography variant="caption" color="text.secondary" title={detail} role={reloading ? 'status' : undefined} sx={{ display: 'block', mt: 0.5, lineHeight: 1.3 }}>
          {line}
        </Typography>
      )}
      {error && <Alert severity="warning" sx={{ mt: 1 }}>Could not compare with that baseline: {error}</Alert>}
    </Box>
  );
}

function LevelMissingAlert({ connection }: { connection: Configured['connection'] }) {
  const parser = connection?.levelParser && connection.levelParser !== 'none' ? `| ${connection.levelParser} ` : '';
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      No line of this run carries the level label <code>{parser}{connection?.levelLabel ?? 'detected_level'}</code>, so Perfana cannot
      tell errors apart and shows no error rate; the per-application error rates read 0 for the same reason.
      If the level is a field of the line, set the connection&apos;s level parser to json or logfmt (Integrations → Loki → Test
      connection suggests one), then recreate the level panels and re-analyse the run.
    </Alert>
  );
}

