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

const COLUMN_COUNT = 9;
/**
 * One colour per parallel group within a transaction, so several groups can be told apart at a
 * glance. Deliberately avoids red and green: those already mean failed and passed in this table.
 */
const GROUP_COLORS = [
  '#7b1fa2', // purple
  '#00796b', // teal
  '#303f9f', // indigo
  '#c2185b', // pink
  '#0097a7', // cyan
  '#5d4037', // brown
];

function groupColor(ordinal: number): string {
  return GROUP_COLORS[ordinal % GROUP_COLORS.length];
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
  /** Colour of the parallel group this row belongs to; undefined outside one. */
  groupColor?: string;
  /** How many bands enclose this row, used purely for indentation. */
  depth?: number;
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

function SamplerRow({
  sampler,
  transactionName,
  groupColor: accent,
  depth = 0,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: SamplerRowProps) {
  return (
    <TableRow sx={{
      '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.04)' },
      '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.02)' },
      // Only the name cell carries the line. Including td:first-of-type drew a second line
      // down the Avg column, because the name cell is a th and the first td is the next one.
      '& > th:first-of-type': {
        pl: 2 + depth * 2,
        ...(accent && { borderLeft: '3px solid', borderLeftColor: accent }),
      },
    }}>
      <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontFamily="monospace">
            {sampler.sampler_name}
          </Typography>
          {sampler.url_pattern && (
            <Box sx={{ mt: 0.5 }}>
              <ClippedUrl url={sampler.url_pattern} sx={{ textTransform: 'none' }} />
            </Box>
          )}
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
  transaction: 'A sub-transaction inside the one you expanded.',
  other: 'An enclosing controller reported by the load test tool.',
};

function KindIcon({ kind, color }: { kind: ControllerKind; color: string }) {
  const sx = { color, fontSize: '1rem' };
  if (kind === 'parallel') return <AltRouteIcon sx={sx} />;
  if (kind === 'loop') return <LoopIcon sx={sx} />;
  if (kind === 'conditional') return <CallSplitIcon sx={sx} />;
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

  // Colour is reserved for parallel bands — it is the one kind that changes how the response
  // times below it must be read. Assigned by order of appearance so a group keeps its colour
  // across re-renders.
  const colorByBand = new Map<SamplerGroupSection, string>();
  const assignColors = (list: SamplerSection[]) => {
    for (const section of list) {
      if (section.kind !== 'group') continue;
      if (section.controller === 'parallel') {
        colorByBand.set(section, groupColor(colorByBand.size));
      }
      assignColors(section.children);
    }
  };
  assignColors(sections);

  const renderSections = (
    list: SamplerSection[],
    depth: number,
    accent: string | undefined,
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
            groupColor={accent}
            depth={depth}
            onOpenSamplerActionMenu={onOpenSamplerActionMenu}
            onOpenSamplerErrors={onOpenSamplerErrors}
          />,
        ];
      }

      const isParallel = section.controller === 'parallel';
      // A parallel band owns a colour and passes it to its subtree; every other kind is drawn in
      // muted ink so "these ran at the same time" keeps its visual monopoly.
      const bandColor = isParallel ? colorByBand.get(section) ?? GROUP_COLORS[0] : undefined;
      const ink = bandColor ?? 'text.secondary';
      const saved = isParallel ? savedLabel(section) : null;
      const descendants = sectionSamples(section);

      return [
        <TableRow
          key={`${key}-band`}
          sx={{ backgroundColor: bandColor ? alpha(bandColor, 0.06) : 'rgba(0, 0, 0, 0.02)' }}
        >
          <TableCell
            sx={{
              py: 0.75,
              pl: 2 + depth * 2,
              borderLeft: '3px solid',
              borderLeftColor: bandColor ?? 'divider',
            }}
          >
            <Tooltip title={KIND_HELP[section.controller]} arrow placement="top">
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, cursor: 'help' }}>
                <KindIcon kind={section.controller} color={bandColor ?? 'rgba(0, 0, 0, 0.45)'} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: ink }}>
                  {KIND_LABEL[section.controller]}
                </Typography>
                <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                  {section.name}
                </Typography>
              </Box>
            </Tooltip>
            {saved && (
              <Tooltip
                arrow
                placement="bottom-start"
                title="The requests below ran at the same time, so their response times overlap. This is what the same work would have cost one after another, and how much the concurrency saved."
              >
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.25, color: 'text.secondary', cursor: 'help' }}
                >
                  {saved}
                </Typography>
              </Tooltip>
            )}
          </TableCell>

          {isParallel && section.stats ? (
            <>
              <GroupStatCell
                value={section.stats.avg_elapsed}
                tooltip={`The group\u2019s own elapsed time, averaged over ${section.stats.executions} executions. Measured per execution as last finish minus first start, so it is not the sum of the rows below.`}
              />
              <GroupStatCell value={section.stats.p95_elapsed} executions={section.stats.executions} />
              <GroupStatCell value={section.stats.p99_elapsed} executions={section.stats.executions} />
              <CountCell value={section.stats.passed_count} tone="passed" />
              <CountCell value={section.stats.failed_count} tone="failed" />
              {/* A group has no Apdex: the threshold is configured per transaction and per
                  request, and a group's duration is neither. */}
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
              <TableCell align="center" />
            </>
          ) : isParallel ? (
            <TableCell colSpan={COLUMN_COUNT - 1} sx={{ color: 'text.disabled' }}>
              <Tooltip
                arrow
                placement="top"
                title="A group's duration is measured across its executions once the run is analysed, so it is not available while a test is still running. For a run analysed before this was recorded, re-evaluating the run fills it in."
              >
                <Typography variant="caption" sx={{ cursor: 'help' }}>
                  Timings appear once the run is analysed
                </Typography>
              </Tooltip>
            </TableCell>
          ) : (
            <>
              {/* A loop or a conditional has no measured duration of its own — nothing times it
                  the way the rollup times a parallel pass — so the response-time columns stay
                  empty rather than carrying a number nothing produced. The counts are real: they
                  are the sum of the requests below, and they are the whole point of the band. */}
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
        ...renderSections(section.children, depth + 1, bandColor ?? accent, key),
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
        <TableBody>{renderSections(sections, 0, undefined, 's')}</TableBody>
      </Table>
    </TableContainer>
  );
}
