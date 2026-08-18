'use client';

import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Paper,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  MoreVert as MoreVertIcon,
  AltRoute as AltRouteIcon,
  Loop as LoopIcon,
  CallSplit as CallSplitIcon,
  Shuffle as ShuffleIcon,
  AccountTree as AccountTreeIcon,
} from '@mui/icons-material';
import { SamplerStat } from '../types/performance-analysis.types';
import { formatNumber, formatApdex, getApdexColor, getApdexLabel } from '../utils/performance-formatters';
import {
  buildSamplerSections,
  sectionSamples,
  ControllerKind,
  SamplerGroupSection,
  SamplerSection,
} from '../utils/controller-sections';
import { TABLE_HEADER_CELL_SX } from '../utils/table-header-style';
import { ClippedUrl } from '@/components/ui/clipped-url';

/** Width of one nesting level, and of the guide line drawn at that level. */
const INDENT_PX = 16;

/**
 * Colour carries the controller's KIND, so a reader learns "orange means conditional" once and
 * it holds in every transaction. Deliberately avoids red and green: those already mean failed
 * and passed in this table.
 */
const KIND_COLORS: Record<Exclude<ControllerKind, 'parallel'>, string> = {
  loop: '#00695c', // teal
  conditional: '#ef6c00', // orange
  alternating: '#0277bd', // blue
  transaction: '#455a64', // blue grey
  other: '#616161', // grey
};

/**
 * Parallel groups rotate rather than take one fixed colour: a transaction can hold several, and
 * telling them apart matters more than memorising a hue. Kept to the purple/pink/brown family so
 * none of them can be mistaken for a KIND_COLORS entry.
 */
const PARALLEL_COLORS = ['#7b1fa2', '#c2185b', '#5d4037', '#6a1b9a', '#ad1457', '#4e342e'];

function parallelColor(ordinal: number): string {
  return PARALLEL_COLORS[ordinal % PARALLEL_COLORS.length];
}

/**
 * One vertical line per enclosing band, drawn at that band's own colour and offset.
 *
 * This is what makes nesting readable. Indentation alone does not: at one level of 16px, a
 * conditional inside a loop looks like a conditional beside a loop, which is exactly how the
 * first version read. Each line sits at the same offset as its band's own marker, so a member
 * row's line continues the band header's.
 */
function Guides({ colors }: { colors: string[] }) {
  return (
    <>
      {colors.map((color, i) => (
        <Box
          key={i}
          sx={{
            width: `${INDENT_PX}px`,
            flexShrink: 0,
            alignSelf: 'stretch',
            borderLeft: '2px solid',
            borderLeftColor: alpha(color, 0.4),
          }}
        />
      ))}
    </>
  );
}
/** Below this many executions, a p95/p99 is a statement about a handful of points. */
const MIN_EXECUTIONS_FOR_PERCENTILES = 20;

export interface SamplerTableProps {
  samples: SamplerStat[];
  transactionName: string;
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

interface SamplerRowProps {
  sampler: SamplerStat;
  transactionName: string;
  /** Colour of each enclosing band, outermost first. Empty for a top-level row. */
  ancestors?: string[];
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

function SamplerRow({
  sampler,
  transactionName,
  ancestors = [],
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: SamplerRowProps) {
  return (
    <TableRow sx={{
      '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.04)' },
      '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.02)' },
    }}>
      {/* The guides live inside the name cell, not as a border on it: a border would stop at
          the cell edge, while these run the full height of the row and line up with the band
          header above. */}
      <TableCell component="th" scope="row" sx={{ fontWeight: 500, pl: 1, pr: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
          <Guides colors={ancestors} />
          <Box sx={{ minWidth: 0, pl: ancestors.length > 0 ? 1.5 : 1 }}>
          <Typography variant="body2" fontFamily="monospace">
            {sampler.sampler_name}
          </Typography>
            {sampler.url_pattern && (
              <Box sx={{ mt: 0.5 }}>
                <ClippedUrl url={sampler.url_pattern} sx={{ textTransform: 'none' }} />
              </Box>
            )}
          </Box>
        </Box>
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
        {formatNumber(sampler.avg_response_time)}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
        {formatNumber(sampler.p95_response_time)}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
        {formatNumber(sampler.p99_response_time)}
      </TableCell>
      <TableCell align="right" sx={{
        fontFamily: 'monospace',
        color: 'success.main',
        fontWeight: 600
      }}>
        {sampler.passed_count}
      </TableCell>
      <TableCell
        align="right"
        onClick={(e) => {
          if (sampler.failed_count > 0) {
            e.stopPropagation();
            onOpenSamplerErrors(transactionName, sampler.sampler_name);
          }
        }}
        sx={{
          fontFamily: 'monospace',
          color: sampler.failed_count > 0 ? 'error.main' : 'text.secondary',
          fontWeight: sampler.failed_count > 0 ? 600 : 400,
          cursor: sampler.failed_count > 0 ? 'pointer' : 'default',
          '&:hover': sampler.failed_count > 0 ? {
            textDecoration: 'underline',
            backgroundColor: 'rgba(244, 67, 54, 0.08)',
          } : {}
        }}
      >
        {sampler.failed_count}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
        {sampler.active_threshold}ms
      </TableCell>
      <TableCell align="right">
        <Tooltip
          title={
            <Box sx={{ p: 0.5 }}>
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                Apdex Score: {formatApdex(sampler.apdex_score)}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                Rating: {getApdexLabel(sampler.apdex_score)}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5 }}>
                Threshold: {sampler.active_threshold}ms
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                {sampler.total_count.toLocaleString()} total requests
              </Typography>
            </Box>
          }
          arrow
          placement="top"
        >
          <Box
            component="span"
            sx={{
              fontWeight: 700,
              color: getApdexColor(sampler.apdex_score),
              display: 'inline-block',
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              backgroundColor: `${getApdexColor(sampler.apdex_score)}15`,
              cursor: 'help',
              fontSize: '0.875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            {getApdexLabel(sampler.apdex_score)}
          </Box>
        </Tooltip>
      </TableCell>
      <TableCell align="center">
        <Tooltip title="Actions" arrow>
          <IconButton
            size="small"
            onClick={(e) => onOpenSamplerActionMenu(e, transactionName, sampler)}
            sx={{
              color: 'secondary.main',
              '&:hover': {
                backgroundColor: 'rgba(156, 39, 176, 0.08)',
              }
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/**
 * One statistic of a parallel group. Percentiles over a small number of executions are reported
 * with a caveat rather than silently presented as if they carried the same weight as a percentile
 * over thousands of requests.
 */
function GroupStatCell({
  value,
  executions,
  tooltip,
}: {
  value: number;
  executions?: number;
  tooltip?: string;
}) {
  const thin = executions !== undefined && executions < MIN_EXECUTIONS_FOR_PERCENTILES;
  const title =
    tooltip ??
    (thin
      ? `Only ${executions} executions of this group — too few for a meaningful percentile.`
      : `Across ${executions} executions of this group.`);

  return (
    <Tooltip title={title} arrow placement="top">
      <TableCell align="right" sx={{ fontFamily: 'monospace', cursor: 'help' }}>
        {formatNumber(value)}
        {thin && (
          <Typography component="span" variant="caption" sx={{ color: 'warning.main', ml: 0.5 }}>
            *
          </Typography>
        )}
      </TableCell>
    </Tooltip>
  );
}

const KIND_LABEL: Record<ControllerKind, string> = {
  parallel: 'Parallel group',
  loop: 'Loop',
  conditional: 'Conditional',
  alternating: 'Alternating',
  transaction: 'Transaction',
  other: 'Controller',
};

/** What each band tells the reader about the numbers on the rows beneath it. */
const KIND_HELP: Record<ControllerKind, string> = {
  parallel:
    'One virtual user issued these requests at the same time, so their response times overlap and do not add up to the time the user waited.',
  loop:
    'These requests repeat within a single pass of the transaction, which is why their counts are a multiple of their neighbours\u2019.',
  conditional:
    'These requests only ran when the controller\u2019s condition held, so their counts are lower than their neighbours\u2019 and need not match.',
  alternating:
    'This controller runs one of these requests per pass rather than all of them, which is why the band\u2019s count is split across its members instead of repeated on each.',
  transaction: 'A sub-transaction inside the one you expanded.',
  other: 'An enclosing controller reported by the load test tool.',
};

function KindIcon({ kind, color }: { kind: ControllerKind; color: string }) {
  const sx = { color, fontSize: '1rem' };
  if (kind === 'parallel') return <AltRouteIcon sx={sx} />;
  if (kind === 'loop') return <LoopIcon sx={sx} />;
  if (kind === 'conditional') return <CallSplitIcon sx={sx} />;
  if (kind === 'alternating') return <ShuffleIcon sx={sx} />;
  if (kind === 'transaction') return <AccountTreeIcon sx={sx} />;
  return null;
}

/**
 * What the group would have cost had its requests run one after another.
 *
 * Every input is already on screen \u2014 no extra query. A member that fires more than once per
 * execution is weighted by how often, so a request looped inside the group is not undercounted.
 * Returns null when there is nothing trustworthy to divide by.
 */
function serialMs(section: SamplerGroupSection): number | null {
  const stats = section.stats;
  if (!stats || stats.executions <= 0) return null;
  const samples = sectionSamples(section);
  if (samples.length === 0) return null;
  return samples.reduce(
    (sum, s) => sum + s.avg_response_time * (s.total_count / stats.executions),
    0,
  );
}

/** The headline a parallel band exists to deliver, or null when there was nothing to save. */
function savedLabel(section: SamplerGroupSection): string | null {
  const wall = section.stats?.avg_elapsed ?? 0;
  const serial = serialMs(section);
  if (serial === null || wall <= 0) return null;
  const ratio = serial / wall;
  // Below this the requests barely overlapped; announcing a saving would overstate it.
  if (ratio < 1.05) return null;
  return `${formatNumber(serial)} ms if serial \u00b7 ${ratio.toFixed(1)}\u00d7 saved`;
}

/** Passed / failed, coloured the same way on a band as on the rows beneath it. */
function CountCell({ value, tone }: { value: number; tone: 'passed' | 'failed' }) {
  const bad = tone === 'failed' && value > 0;
  return (
    <TableCell
      align="right"
      sx={{
        fontFamily: 'monospace',
        color: tone === 'passed' ? 'success.main' : bad ? 'error.main' : 'text.secondary',
        fontWeight: tone === 'passed' || bad ? 600 : 400,
      }}
    >
      {value}
    </TableCell>
  );
}

export function SamplerTable({
  samples,
  transactionName,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: SamplerTableProps) {
  const sections = buildSamplerSections(samples, transactionName);

  // Every band is coloured. Non-parallel kinds take their kind's fixed hue, so the colour is
  // information rather than decoration; parallel groups rotate, because one transaction can
  // hold several and telling them apart is what matters there.
  const colorByBand = new Map<SamplerGroupSection, string>();
  let parallelSeen = 0;
  const assignColors = (list: SamplerSection[]) => {
    for (const section of list) {
      if (section.kind !== 'group') continue;
      colorByBand.set(
        section,
        section.controller === 'parallel'
          ? parallelColor(parallelSeen++)
          : KIND_COLORS[section.controller],
      );
      assignColors(section.children);
    }
  };
  assignColors(sections);

  const renderSections = (
    list: SamplerSection[],
    ancestors: string[],
    keyPrefix: string,
  ): React.ReactNode[] =>
    list.flatMap((section, idx) => {
      const key = `${keyPrefix}-${idx}`;

      if (section.kind === 'single') {
        return [
          <SamplerRow
            key={key}
            sampler={section.sample}
            transactionName={transactionName}
            ancestors={ancestors}
            onOpenSamplerActionMenu={onOpenSamplerActionMenu}
            onOpenSamplerErrors={onOpenSamplerErrors}
          />,
        ];
      }

      const isParallel = section.controller === 'parallel';
      const bandColor = colorByBand.get(section) ?? KIND_COLORS.other;
      const descendants = sectionSamples(section);
      // Read off any member: a run is written by one listener version, so every request in it
      // carries the same metadata shape.
      const planPathOnly = descendants[0]?.chain_source === 'plan';
      // A parallel group is the only band with a duration of its own, and only when the rollup
      // measured one. Without it there is nothing to put in the response-time columns, so the
      // band falls back to exactly what a loop or a conditional shows: counts, and dashes where
      // no number exists. Spanning those columns with a sentence instead left the row unaligned
      // with every other row in the table and buried the counts, which are still real.
      const timings = isParallel ? section.stats : null;
      const note = timings
        ? savedLabel(section)
        : isParallel
          ? planPathOnly
            ? 'No per-execution timings in this run'
            : 'Timings appear once the run is analysed'
          : null;
      // Two different absences. Saying "not yet" about a permanent one is a lie the reader would
      // act on, by re-analysing a run that can never produce the number.
      const noteHelp = timings
        ? 'The requests below ran at the same time, so their response times overlap. This is what the same work would have cost one after another, and how much the concurrency saved.'
        : planPathOnly
          ? "A group's duration is measured per execution, which needs the load test tool to mark which requests belonged to the same concurrent pass. This run records where each request sits in the test plan instead, so the grouping is accurate but the timings cannot be recovered \u2014 not by re-analysing, and not by a later release."
          : "A group's duration is measured across its executions once the run is analysed, so it is not available while a test is still running. For a run analysed before this was recorded, re-evaluating the run fills it in.";

      return [
        <TableRow key={`${key}-band`} sx={{ backgroundColor: alpha(bandColor, 0.07) }}>
          <TableCell sx={{ py: 0.75, pl: 1, pr: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
              {/* The enclosing bands' lines, then this band's own marker at the next offset —
                  so the member rows below continue exactly this line. */}
              <Guides colors={ancestors} />
              <Box
                sx={{
                  borderLeft: '3px solid',
                  borderLeftColor: bandColor,
                  pl: 1.5,
                  minWidth: 0,
                }}
              >
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    timings
                      ? KIND_HELP[section.controller]
                      : // Stated rather than left to inference: with a band nested inside another,
                        // "150" on the outer one is not any single thing the reader can point at.
                        `${KIND_HELP[section.controller]} The counts are the total of every request below it, at any depth.`
                  }
                >
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, cursor: 'help' }}>
                    <KindIcon kind={section.controller} color={bandColor} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: bandColor }}>
                      {KIND_LABEL[section.controller]}
                    </Typography>
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                      {section.name}
                    </Typography>
                  </Box>
                </Tooltip>
                {note && (
                  <Tooltip arrow placement="bottom-start" title={noteHelp}>
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mt: 0.25, color: 'text.secondary', cursor: 'help' }}
                    >
                      {note}
                    </Typography>
                  </Tooltip>
                )}
              </Box>
            </Box>
          </TableCell>

          {timings ? (
            <>
              <GroupStatCell
                value={timings.avg_elapsed}
                tooltip={`The group\u2019s own elapsed time, averaged over ${timings.executions} executions. Measured per execution as last finish minus first start, so it is not the sum of the rows below.`}
              />
              <GroupStatCell value={timings.p95_elapsed} executions={timings.executions} />
              <GroupStatCell value={timings.p99_elapsed} executions={timings.executions} />
              {/* Executions, matching the elapsed columns beside them — not request counts. */}
              <CountCell value={timings.passed_count} tone="passed" />
              <CountCell value={timings.failed_count} tone="failed" />
              {/* A group has no Apdex: the threshold is configured per transaction and per
                  request, and a group's duration is neither. */}
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="center" />
            </>
          ) : (
            <>
              {/* Every band without a measured duration renders the same way, whether it is a
                  loop that never had one or a parallel group whose run does not record one.
                  Passed and failed are the only columns left that carry a real number: they are
                  the requests below, summed. Everything else stays a dash rather than showing a
                  figure nothing produced. */}
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <CountCell value={descendants.reduce((n, s) => n + s.passed_count, 0)} tone="passed" />
              <CountCell value={descendants.reduce((n, s) => n + s.failed_count, 0)} tone="failed" />
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="center" />
            </>
          )}
        </TableRow>,
        ...renderSections(section.children, [...ancestors, bandColor], key),
      ];
    });

  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid rgba(0, 0, 0, 0.08)' }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ backgroundColor: 'rgba(0, 0, 0, 0.04)' }}>
            <TableCell sx={TABLE_HEADER_CELL_SX}>Request Name</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>Avg Response (ms)</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>95th Pct (ms)</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>99th Pct (ms)</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>Passed</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>Failed</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>Apdex Threshold</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_CELL_SX}>Apdex Score</TableCell>
            <TableCell align="center" sx={TABLE_HEADER_CELL_SX}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>{renderSections(sections, [], 's')}</TableBody>
      </Table>
    </TableContainer>
  );
}
