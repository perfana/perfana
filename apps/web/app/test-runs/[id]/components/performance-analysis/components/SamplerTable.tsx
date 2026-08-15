'use client';

import { Fragment } from 'react';
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
import { MoreVert as MoreVertIcon, AltRoute as AltRouteIcon } from '@mui/icons-material';
import { SamplerStat } from '../types/performance-analysis.types';
import { formatNumber, formatApdex, getApdexColor, getApdexLabel } from '../utils/performance-formatters';
import { buildSamplerSections } from '../utils/parallel-groups';
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
  /** Colour of the group this row belongs to; undefined for a sequential row. */
  groupColor?: string;
  onOpenSamplerActionMenu: (event: React.MouseEvent<HTMLElement>, transaction: string, sampler: SamplerStat) => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

function SamplerRow({
  sampler,
  transactionName,
  groupColor: accent,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: SamplerRowProps) {
  return (
    <TableRow sx={{
      '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.04)' },
      '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.02)' },
      // Only the name cell carries the line. Including td:first-of-type drew a second line
      // down the Avg column, because the name cell is a th and the first td is the next one.
      ...(accent && {
        '& > th:first-of-type': {
          borderLeft: '3px solid',
          borderLeftColor: accent,
          pl: 2.5,
        },
      }),
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

export function SamplerTable({
  samples,
  transactionName,
  onOpenSamplerActionMenu,
  onOpenSamplerErrors,
}: SamplerTableProps) {
  const sections = buildSamplerSections(samples);
  // Ordinal by order of appearance, so the same group keeps its colour across re-renders.
  const colorByGroup = new Map<string, string>();
  sections.forEach((section) => {
    if (section.kind === 'group' && !colorByGroup.has(section.name)) {
      colorByGroup.set(section.name, groupColor(colorByGroup.size));
    }
  });

  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid rgba(0, 0, 0, 0.08)' }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ backgroundColor: 'rgba(0, 0, 0, 0.04)' }}>
            <TableCell sx={{ fontWeight: 700 }}>Request Name</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Avg Response (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>95th Pct (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>99th Pct (ms)</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Passed</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Failed</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Apdex Threshold</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Apdex Score</TableCell>
            <TableCell align="center" sx={{ fontWeight: 700 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sections.map((section, idx) => {
            if (section.kind === 'single') {
              return (
                <SamplerRow
                  key={`s-${idx}`}
                  sampler={section.sample}
                  transactionName={transactionName}
                  onOpenSamplerActionMenu={onOpenSamplerActionMenu}
                  onOpenSamplerErrors={onOpenSamplerErrors}
                />
              );
            }

            const accent = colorByGroup.get(section.name) ?? GROUP_COLORS[0];

            return (
              <Fragment key={`g-${idx}`}>
                <TableRow sx={{ backgroundColor: alpha(accent, 0.06) }}>
                  <TableCell sx={{ py: 0.75, borderLeft: '3px solid', borderLeftColor: accent }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AltRouteIcon fontSize="small" sx={{ color: accent }} />
                      <Typography variant="caption" sx={{ fontWeight: 700, color: accent }}>
                        Parallel group
                      </Typography>
                      <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                        {section.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  {section.stats ? (
                    <>
                      <GroupStatCell
                        value={section.stats.avg_elapsed}
                        tooltip={`The group's own elapsed time, averaged over ${section.stats.executions} executions. Measured per execution as last finish minus first start, so it is not the sum of the rows below.`}
                      />
                      <GroupStatCell value={section.stats.p95_elapsed} executions={section.stats.executions} />
                      <GroupStatCell value={section.stats.p99_elapsed} executions={section.stats.executions} />
                      <TableCell align="right" sx={{ fontFamily: 'monospace', color: 'success.main', fontWeight: 600 }}>
                        {section.stats.passed_count}
                      </TableCell>
                      <TableCell align="right" sx={{
                        fontFamily: 'monospace',
                        color: section.stats.failed_count > 0 ? 'error.main' : 'text.secondary',
                        fontWeight: section.stats.failed_count > 0 ? 600 : 400,
                      }}>
                        {section.stats.failed_count}
                      </TableCell>
                      {/* A group has no Apdex: the threshold is configured per transaction and per
                          request, and a group's duration is neither. */}
                      <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
                      <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
                      <TableCell align="center" />
                    </>
                  ) : (
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
                  )}
                </TableRow>

                {section.samples.map((sampler, sIdx) => (
                  <SamplerRow
                    key={`g-${idx}-${sIdx}`}
                    sampler={sampler}
                    transactionName={transactionName}
                    groupColor={accent}
                    onOpenSamplerActionMenu={onOpenSamplerActionMenu}
                    onOpenSamplerErrors={onOpenSamplerErrors}
                  />
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
