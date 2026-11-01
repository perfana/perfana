'use client';

/**
 * The card chrome every Analyst chart sits in: header, the add-series slot, the plot, and
 * the series table underneath it.
 *
 * Graphs, Compare and Trends each built their own frame — a Plotly `title` inside the
 * canvas on two of them, an editable MUI heading on the third, three different heights
 * and three different borders. This is the one frame.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { CallSplit } from '@mui/icons-material';
import { MONO, SANS, SIZE, chartTheme, type ChartMode } from '@/lib/charts';

export type AxisDisplayMode = 'overlay' | 'split';

/**
 * The header's pill button. The axis-mode pair and the standalone `viewToggle` are the
 * same control at different arities, so they are drawn by the same code rather than by a
 * third hand-copy of this `sx` block. A grouped button takes its border from the group's
 * container; `standalone` carries its own.
 *
 * Exported so a card can put a one-off button in its `actions` slot — the Graphs card's
 * `reset zoom` — without copying this block. `active` left undefined means the button is
 * an action, not a toggle, and no `aria-pressed` is emitted: a reset is not "off".
 */
export function PillButton({
  theme,
  active,
  onClick,
  title,
  standalone,
  children,
}: {
  theme: ReturnType<typeof chartTheme>;
  active?: boolean;
  onClick: () => void;
  title?: string;
  standalone?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      sx={{
        px: 0.75,
        height: 20,
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: 10,
        ...(standalone
          ? { border: `1px solid ${theme.divider}`, borderRadius: '4px', flexShrink: 0 }
          : { border: 0 }),
        fontWeight: active ? 600 : 400,
        color: active ? theme.primary : theme.faint,
        bgcolor: active ? theme.selectedBg : 'transparent',
        '&:hover': { bgcolor: active ? theme.selectedBg : theme.hover },
      }}
    >
      {children}
    </Box>
  );
}

interface AnalystChartCardProps {
  title: React.ReactNode;
  subtitle?: string;
  mode: ChartMode;
  /** The overlay | split-by-unit toggle. Omitted where the card has no choice to make. */
  axisMode?: AxisDisplayMode;
  onAxisModeChange?: (next: AxisDisplayMode) => void;
  /**
   * One more view-mode switch, drawn immediately beside the axis-mode group so the two
   * read as one strip — the `actions` slot is painted before them and holds the icon
   * actions. Graphs uses it for "analysis range only".
   */
  viewToggle?: { label: string; active: boolean; title?: string; onToggle: () => void };
  /** Right of the header: the hovered time, sample or run id. Blank when not hovering. */
  /**
   * Right of the header: the hovered time, sample, or run id plus its release and
   * annotations. Capped at 55% of the header and ellipsized, with the full string on the
   * element's `title` — an annotation is free text with no length bound.
   */
  cursor?: string;
  /** Compare's panel-unit chip, which applies to baseline and current together. */
  headerExtra?: React.ReactNode;
  /** Shown when three or more unit families forced the chart into lanes. */
  lanesNote?: string;
  /** The `+ add series` toggle, its summary line, and the panel it opens. */
  addSeries?: {
    open: boolean;
    onToggle: () => void;
    summary?: string;
    panel: React.ReactNode;
  };
  /** The plot. */
  children: React.ReactNode;
  /** The `SeriesTable`. Always visible — it is the legend. */
  table?: React.ReactNode;
  footerNote?: string;
  /** Chart-level actions (save as preset, remove all). */
  actions?: React.ReactNode;
}

export default function AnalystChartCard({
  title,
  subtitle,
  mode,
  axisMode,
  onAxisModeChange,
  viewToggle,
  cursor,
  headerExtra,
  lanesNote,
  addSeries,
  children,
  table,
  footerNote,
  actions,
}: AnalystChartCardProps) {
  const theme = chartTheme(mode);

  return (
    <Box
      sx={{
        bgcolor: theme.paper,
        border: `1px solid ${theme.divider}`,
        borderRadius: `${SIZE.radius}px`,
        boxShadow: 'none',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          // Wraps rather than clips. The card is `overflow: 'hidden'` and only the title
          // shrinks — every control right of the spacer is `flexShrink: 0` — so on a narrow
          // content column the rightmost ones (the copy/download icons) used to be cut off
          // with no way to reach them. The Graphs card can carry nine of them at once.
          flexWrap: 'wrap',
          rowGap: 0.5,
          alignItems: 'center',
          gap: 1,
          px: '14px',
          py: 1,
          minHeight: 34,
        }}
      >
        <Typography
          component="div"
          sx={{ fontFamily: SANS, fontSize: SIZE.titleFont, fontWeight: 600, color: theme.text, minWidth: 0 }}
          noWrap
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontFamily: MONO, fontSize: 10, color: theme.faint, minWidth: 0 }} noWrap>
            {subtitle}
          </Typography>
        )}
        {headerExtra}
        <Box sx={{ flex: 1 }} />
        {actions}
        {viewToggle && (
          <PillButton
            theme={theme}
            active={viewToggle.active}
            onClick={viewToggle.onToggle}
            title={viewToggle.title}
            standalone
          >
            {viewToggle.label}
          </PillButton>
        )}
        {axisMode && onAxisModeChange && (
          <Box
            role="group"
            aria-label="Axis mode"
            sx={{
              display: 'flex',
              border: `1px solid ${theme.divider}`,
              borderRadius: '4px',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {(['overlay', 'split'] as const).map((value) => (
              <PillButton
                key={value}
                theme={theme}
                active={axisMode === value}
                onClick={() => onAxisModeChange(value)}
              >
                {value === 'overlay' ? 'overlay' : 'split by unit'}
              </PillButton>
            ))}
          </Box>
        )}
        <Typography
          aria-live="off"
          sx={{
            fontFamily: MONO,
            fontSize: SIZE.valueFont,
            color: theme.muted,
            flexShrink: 0,
            // Reserve the width so the header does not jitter as the cursor moves. The
            // readout can carry a release and annotations too, so cap it rather than let
            // it push the title.
            minWidth: 72,
            maxWidth: '55%',
            textAlign: 'right',
          }}
          noWrap
          // The readout truncates, and the Analyst standard has no tooltip to recover it
          // from: a free-text annotation is exactly the part the ellipsis eats.
          title={cursor ?? ''}
        >
          {cursor ?? ''}
        </Typography>
      </Box>

      {lanesNote && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mx: '14px',
            mb: 1,
            px: 1,
            py: 0.5,
            bgcolor: theme.hover,
            borderRadius: '4px',
          }}
        >
          <CallSplit sx={{ fontSize: 13, color: theme.faint }} />
          <Typography sx={{ fontFamily: MONO, fontSize: 10, color: theme.muted }}>{lanesNote}</Typography>
        </Box>
      )}

      {addSeries && (
        <Box sx={{ px: '14px', pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="button"
            type="button"
            aria-expanded={addSeries.open}
            onClick={addSeries.onToggle}
            sx={{
              px: 0.75,
              height: 22,
              border: `1px solid ${theme.divider}`,
              borderRadius: '4px',
              bgcolor: addSeries.open ? theme.selectedBg : 'transparent',
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              color: theme.primary,
              '&:hover': { bgcolor: addSeries.open ? theme.selectedBg : theme.hover },
            }}
          >
            + add series
          </Box>
          {addSeries.summary && (
            <Typography sx={{ fontFamily: MONO, fontSize: 10, color: theme.faint }} noWrap>
              {addSeries.summary}
            </Typography>
          )}
        </Box>
      )}

      {/* ponytail: mounted while closed, hidden rather than unmounted. The cascade is what
          walks an "Open in Graphs / Trends" link, whether a new tab's ?card= params or an
          in-page CardLinkRequest, and a card whose picker starts closed would never run that walk.
          What that costs, stated honestly: a closed picker renders every dashboard row on
          every render of THIS card, so the caller must hand `panel` a stable element (see
          the memo in GraphsChart/TrendsChart) or a hover-driven re-render repeats that work
          per pointer move. And the walk itself does fetch — panels for the linked dashboard,
          then series for each of its panels — with the picker never opened. */}
      {addSeries && (
        <Box sx={{ px: '14px', pb: 1, display: addSeries.open ? undefined : 'none' }}>{addSeries.panel}</Box>
      )}

      <Box sx={{ px: '6px' }}>{children}</Box>

      {table && <Box sx={{ pt: 0.5, pb: 0.5 }}>{table}</Box>}

      {footerNote && (
        <Typography sx={{ px: '14px', py: 0.75, fontFamily: MONO, fontSize: 10, color: theme.faint }}>
          {footerNote}
        </Typography>
      )}
    </Box>
  );
}
