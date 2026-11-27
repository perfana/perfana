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
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, MoreVert, OpenInNew } from '@mui/icons-material';
import { useEffect } from 'react';
import {
  fetchLokiRunSummary, LokiErrorRate, LokiRunPanel, LokiRunPattern, LokiRunSample, LokiRunSummary,
} from '@/lib/loki';
import ExpandableCardHeader from '../shared/ExpandableCardHeader';
import KPIDisplay from '../shared/KPIDisplay';
import SoftBadge from '../shared/SoftBadge';
import { OpenInCardMenuItems } from '../shared/metric-card-links';
import RowCommentButton from '../comments/RowCommentButton';
import { useCommentItemCounts, useCommentItemFocus } from '../comments/CommentsContext';
import type { CommentItemCounts } from '@/lib/test-run-comments';

const LOKI_ORANGE = '#F2A900';
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };
const MAX_ROWS = 10;
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
  testRun: { test_run_id: string };
  expanded: boolean;
  onExpand: () => void;
}

/** Comment anchor for a panel. Panel ids repeat across dashboards, so the title goes with it. */
const panelKey = (p: LokiRunPanel) => `panel:${p.panelId}|${p.title}`;
/** Comment anchor for a pattern: its text, which is what stays stable across re-analyses. */
const patternKey = (p: LokiRunPattern) => `pattern:${p.pattern}`;

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

const levelColor = (level: string | null): 'error' | 'warning' | 'default' =>
  isErrorName(level) ? 'error' : level === 'warn' ? 'warning' : 'default';

export default function LokiCard({ testRun, expanded, onExpand }: LokiCardProps) {
  const [summary, setSummary] = useState<LokiRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentCounts = useCommentItemCounts('loki', expanded);
  useCommentItemFocus('loki', (key) => !!summary?.configured && (
    summary.panels.some((p) => panelKey(p) === key) || summary.patterns.some((p) => patternKey(p) === key)));

  useEffect(() => {
    let cancelled = false;
    fetchLokiRunSummary(testRun.test_run_id)
      .then((s) => { if (!cancelled) setSummary(s); })
      // An API without the route (404) or a run outside the caller's scope reads as "no Loki".
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); });
    return () => { cancelled = true; };
  }, [testRun.test_run_id]);

  if (error || (summary && !summary.configured)) return null;

  const configured = summary?.configured ? summary : null;
  const hasData = !!configured?.panels.some((p) => p.series.length > 0);
  const rate = configured?.errorRate ?? null;
  const trend = errorRateTrend(rate);
  const errorPatterns = configured?.patterns.filter((p) => isErrorName(p.level)) ?? [];
  const newErrorPatterns = errorPatterns.filter((p) => p.isNew).length;

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
          <ExpandableCardHeader title="Loki Logs" expanded={expanded} onToggle={onExpand} />

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
                {!hasData && configured.patterns.length === 0 && <SoftBadge label="No log data for this run" color="orange" />}
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
                  {configured.sources[0]?.exploreUrl && (
                    <Button size="small" variant="outlined" endIcon={<OpenInNew fontSize="small" />} href={configured.sources[0].exploreUrl} target="_blank" rel="noopener noreferrer">
                      Open in Grafana Explore
                    </Button>
                  )}
                </Box>

                <KpiStrip summary={configured} trend={trend} />

                {!hasData && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    No Loki metrics were collected for this run. Runs analysed before the panels existed can be filled with a
                    force re-fetch, as long as Loki still holds the window.
                  </Alert>
                )}

                <PatternsSection summary={configured} commentCounts={commentCounts} />
                <SamplesSection samples={configured.samples} />

                <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 3, mb: 1 }}>Panels</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(auto-fit, minmax(360px, 1fr))' }, gap: 3 }}>
                  {configured.panels.map((p) => <PanelSummary key={panelKey(p)} panel={p} commentCounts={commentCounts} />)}
                </Box>
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}

type Configured = Extract<LokiRunSummary, { configured: true }>;

function KpiStrip({ summary, trend }: { summary: Configured; trend: ReturnType<typeof errorRateTrend> }) {
  const rate = summary.errorRate;
  const errorPatterns = summary.patterns.filter((p) => isErrorName(p.level));
  return (
    <Box
      sx={{
        display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3,
        p: 2, border: 1, borderColor: 'divider', borderRadius: 2,
      }}
    >
      <KPIDisplay value={rate ? fmt(rate.totalLines) : '–'} label="Log lines" color="neutral" />
      <KPIDisplay value={rate ? fmt(rate.errorLines) : fmt(errorPatterns.reduce((n, p) => n + p.count, 0) || null)} label="Error lines" color={(rate?.errorLines ?? 0) > 0 ? 'error' : 'neutral'} />
      <Box>
        <KPIDisplay
          value={rate ? formatPct(rate.errorRatePct) : '–'}
          label={rate?.baseline ? `Error rate · baseline ${formatPct(rate.baseline.errorRatePct)}` : 'Error rate'}
          color={trend === 'worse' ? 'error' : trend === 'better' ? 'success' : 'neutral'}
        />
        {!rate && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
            Add the &ldquo;Log lines by level&rdquo; starter panel to get the error rate.
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
          value={summary.newPatterns ?? '–'}
          label="New patterns"
          color={(summary.newPatterns ?? 0) > 0 ? (errorPatterns.some((p) => p.isNew) ? 'error' : 'warning') : 'neutral'}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
          {summary.newPatterns === null
            ? summary.patterns.length > 0 ? 'No baseline run has a pattern snapshot yet' : 'No pattern snapshot for this run'
            : `Not seen in the ${summary.baselineRunCount ?? 0} baseline run${summary.baselineRunCount === 1 ? '' : 's'}`}
        </Typography>
      </Box>
    </Box>
  );
}

type PatternFilter = 'all' | 'problems' | 'new';

function PatternsSection({ summary, commentCounts }: { summary: Configured; commentCounts: CommentItemCounts }) {
  const [filter, setFilter] = useState<PatternFilter>('problems');
  const [showAll, setShowAll] = useState(false);
  const total = summary.patterns.reduce((n, p) => n + p.count, 0);
  const visible = useMemo(() => summary.patterns.filter((p) =>
    filter === 'all' ? true : filter === 'new' ? p.isNew === true : isErrorName(p.level) || p.level === 'warn'), [summary.patterns, filter]);
  const rows = showAll ? visible : visible.slice(0, PATTERN_ROWS);
  const top = Math.max(1, ...rows.map((p) => p.count));

  if (summary.patterns.length === 0) {
    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600}>Top log patterns</Typography>
        <Typography variant="body2" color="text.secondary">
          No pattern snapshot for this run. Patterns are taken when the run is analysed; re-analyse it while Loki still holds the window.
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
            {summary.patternsSource === 'sampled'
              ? 'Grouped by Perfana from up to 2,000 sampled error and warning lines (Loki\'s patterns API is not available), so counts are over the sample.'
              : 'Log line shapes Loki detected during the run, with variable parts shown as <_>.'}
          </Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_e, v: PatternFilter | null) => v && setFilter(v)} aria-label="Which patterns to show">
          <ToggleButton value="problems">Errors &amp; warnings</ToggleButton>
          <ToggleButton value="new" disabled={summary.newPatterns === null}>New{summary.newPatterns ? ` (${summary.newPatterns})` : ''}</ToggleButton>
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
            {rows.map((p) => (
              <TableRow
                key={p.pattern}
                data-comment-item={patternKey(p)}
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
                  <RowCommentButton card="loki" itemKey={patternKey(p)} itemLabel={p.pattern.slice(0, 200)} counts={commentCounts} />
                  {p.exploreUrl && (
                    <Tooltip title="Open the lines matching this pattern in Grafana Explore">
                      <IconButton size="small" component={Link} href={p.exploreUrl} target="_blank" rel="noopener noreferrer" aria-label="Open pattern in Grafana Explore">
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
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

function SamplesSection({ samples }: { samples: LokiRunSample[] }) {
  const [level, setLevel] = useState<'error' | 'warn'>('error');
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const errors = samples.filter((s) => isErrorName(s.level));
  const warns = samples.filter((s) => s.level === 'warn');
  const list = level === 'error' ? errors : warns;
  const rows = showAll ? list : list.slice(0, SAMPLE_ROWS);
  if (samples.length === 0) return null;
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

function PanelSummary({ panel, commentCounts }: { panel: LokiRunPanel; commentCounts: CommentItemCounts }) {
  const additive = /^(count|bytes|sum\()/.test(panel.aggregation.trim());
  const rows = panel.series.slice(0, MAX_ROWS);
  const total = additive ? panel.series.reduce((n, s) => n + (s.total ?? 0), 0) : 0;
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
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <RowCommentButton card="loki" itemKey={panelKey(panel)} itemLabel={panel.title} counts={commentCounts} />
          {panel.link && (
            <Tooltip title="Open this query in Grafana Explore for the run window">
              <IconButton size="small" component={Link} href={panel.link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${panel.title} in Grafana Explore`}>
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
      {panel.series.length > MAX_ROWS && (
        <Typography variant="caption" color="text.secondary">and {panel.series.length - MAX_ROWS} more</Typography>
      )}
    </Box>
  );
}
