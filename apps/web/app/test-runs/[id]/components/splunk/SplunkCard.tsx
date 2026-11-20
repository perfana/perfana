'use client';

// Root Cause Analysis card for Splunk log metrics: what the run's logs did, per panel, with links
// into Splunk Web for the same window. Everything comes from one request
// (GET /splunk/runs/:testRunId/summary); nothing here asks Splunk itself.

import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Collapse, Divider, IconButton, Link, Menu,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { MoreVert, OpenInNew } from '@mui/icons-material';
import { describeMapping, fetchSplunkRunSummary, SplunkRunPanel, SplunkRunSummary } from '@/lib/splunk';
import ExpandableCardHeader from '../shared/ExpandableCardHeader';
import KPIDisplay from '../shared/KPIDisplay';
import SoftBadge from '../shared/SoftBadge';
import { OpenInCardMenuItems } from '../shared/metric-card-links';
import RowCommentButton from '../comments/RowCommentButton';
import { useCommentItemCounts, useCommentItemFocus } from '../comments/CommentsContext';
import type { CommentItemCounts } from '@/lib/test-run-comments';

const SPLUNK_GREEN = '#65A637';
const MAX_ROWS = 10;
const ERROR_NAMES = new Set(['ERROR', 'FATAL', 'CRITICAL', 'SEVERE']);

interface SplunkCardProps {
  testRun: { test_run_id: string };
  expanded: boolean;
  onExpand: () => void;
}

/** Comment anchor for a panel. Panel ids repeat across Splunk sources, so the title goes with it. */
const panelKey = (p: SplunkRunPanel) => `${p.panelId}|${p.title}`;

const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** Error events across every panel split by level, or null when the logs carry no such series. */
export function errorEvents(panels: SplunkRunPanel[]): number | null {
  let found = false;
  let sum = 0;
  for (const p of panels) {
    for (const s of p.series) {
      if (ERROR_NAMES.has(s.name.toUpperCase()) && s.total !== null) {
        found = true;
        sum += s.total;
      }
    }
  }
  return found ? sum : null;
}

export default function SplunkCard({ testRun, expanded, onExpand }: SplunkCardProps) {
  const [summary, setSummary] = useState<SplunkRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentCounts = useCommentItemCounts('splunk', expanded);
  // Every panel is on screen once the card is expanded; wait only for the summary to land.
  useCommentItemFocus('splunk', (key) => !!summary?.configured && summary.panels.some((p) => panelKey(p) === key));

  useEffect(() => {
    let cancelled = false;
    fetchSplunkRunSummary(testRun.test_run_id)
      .then((s) => { if (!cancelled) setSummary(s); })
      // An API without the route (404) or a run outside the caller's scope reads as "no Splunk".
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); });
    return () => { cancelled = true; };
  }, [testRun.test_run_id]);

  if (error || (summary && !summary.configured)) return null;

  const configured = summary?.configured ? summary : null;
  const errors = configured ? errorEvents(configured.panels) : null;
  const busiest = configured?.panels.find((p) => p.series.length > 0)?.series.slice(0, 2) ?? [];
  const hasData = !!configured?.panels.some((p) => p.series.length > 0);

  return (
    <Box sx={{ gridColumn: expanded ? '1 / -1' : 'auto', height: expanded ? 'auto' : '293px', display: 'flex', flexDirection: 'column' }}>
      <Card
        tabIndex={-1}
        data-testid={expanded ? 'splunk-card-expanded' : 'splunk-card-collapsed'}
        elevation={0}
        onClick={expanded ? undefined : onExpand}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: '100%',
          borderRadius: 3,
          bgcolor: 'background.paper',
          borderTop: `3px solid ${SPLUNK_GREEN}`,
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: expanded ? 'visible' : 'hidden',
          '&:hover': expanded ? {} : { transform: 'translateY(-4px)' },
        }}
      >
        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 3.5, pt: 4, '&:last-child': { pb: 3.5 } }}>
          <ExpandableCardHeader title="Splunk Logs" expanded={expanded} onToggle={onExpand} />

          {!summary && (
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {!expanded && configured && (
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box sx={{ py: 1 }}>
                {errors !== null ? (
                  <KPIDisplay value={fmt(errors)} label="Error events" color={errors > 0 ? 'error' : 'success'} />
                ) : (
                  <KPIDisplay value={configured.panels.length} label="Log panels" color={hasData ? 'primary' : 'neutral'} />
                )}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                {hasData ? (
                  busiest.map((s) => <SoftBadge key={s.name} label={`${s.name} ${fmt(s.total ?? s.mean, 1)}`} color="green" />)
                ) : (
                  <SoftBadge label="No log data for this run" color="orange" />
                )}
                <SoftBadge count={configured.sources.length} label={configured.sources.length === 1 ? 'source' : 'sources'} color="neutral" />
              </Box>
            </Box>
          )}

          <Collapse in={expanded && !!configured}>
            {configured && (
              <Box>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      {configured.connection?.label ?? 'Splunk'}
                      {configured.window && ` · ${new Date(configured.window.from).toLocaleString()} – ${new Date(configured.window.to).toLocaleTimeString()}`}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                      {configured.sources.map((m) => (
                        <Chip key={m.id} size="small" variant="outlined" label={describeMapping(m)} sx={{ fontFamily: 'ui-monospace, monospace' }} />
                      ))}
                    </Box>
                  </Box>
                  {configured.openInSplunk && (
                    <Button
                      size="small"
                      variant="outlined"
                      endIcon={<OpenInNew fontSize="small" />}
                      href={configured.openInSplunk}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Splunk
                    </Button>
                  )}
                </Box>

                {!hasData && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    No Splunk data was collected for this run. Runs analysed before the panels existed can be filled with a
                    force re-fetch, as long as Splunk still holds the window.
                  </Alert>
                )}

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

function PanelSummary({ panel, commentCounts }: { panel: SplunkRunPanel; commentCounts: CommentItemCounts }) {
  const isCount = panel.aggregation === 'count';
  const rows = panel.series.slice(0, MAX_ROWS);
  const top = Math.max(1, ...rows.map((s) => (isCount ? s.total : s.mean) ?? 0));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);

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
          <RowCommentButton card="splunk" itemKey={panelKey(panel)} itemLabel={panel.title} counts={commentCounts} />
          {panel.link && (
            <Tooltip title="Open this search in Splunk for the run window">
              <IconButton size="small" component={Link} href={panel.link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${panel.title} in Splunk`}>
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
              <TableCell align="right">{isCount ? 'Events' : 'Mean'}</TableCell>
              <TableCell align="right">Peak / bucket</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((s) => {
              const value = isCount ? s.total : s.mean;
              const isError = ERROR_NAMES.has(s.name.toUpperCase());
              return (
                <TableRow key={s.name}>
                  <TableCell sx={{ position: 'relative', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
                    {/* Share of the panel's busiest series, as a quiet bar behind the name. */}
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute', inset: '4px auto 4px 0', borderRadius: 0.5,
                        width: `${Math.max(2, ((value ?? 0) / top) * 100)}%`,
                        bgcolor: isError ? 'error.main' : SPLUNK_GREEN, opacity: 0.14,
                      }}
                    />
                    <Box component="span" sx={{ position: 'relative', color: isError ? 'readable.error' : 'text.primary' }}>{s.name}</Box>
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{fmt(value, isCount ? 0 : 2)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{fmt(s.peak, 2)}</TableCell>
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
