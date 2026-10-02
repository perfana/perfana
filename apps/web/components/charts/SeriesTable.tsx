'use client';

/**
 * The legend IS the stats table.
 *
 * Plotly's own legend could carry a name and a swatch and nothing else, so the cards grew
 * a second list under the chart (`GraphsSeriesList`, `TrendsAddedSeriesList`) for the unit
 * picker and the remove button — two places naming the same series, neither of them
 * showing a number. This is one row per series: swatch, name, unit, axis, min/mean/max
 * inside the analysis window, and the value under the cursor.
 *
 * Because this table is the hover readout, the traces are drawn with `hoverinfo: 'none'`:
 * no floating tooltip covers the data.
 */

import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { EMPTY, MONO, SIZE, SOURCE_COLOR, chartTheme, fv, unitText, type ChartMode } from '@/lib/charts';
import type { SeriesStats } from '@/lib/charts';
import type { SourceType } from '@/lib/metrics-source-utils';
import UnitPicker from './UnitPicker';

export interface SeriesRow {
  id: string;
  /** `panelTitle · metricName`, or the panel title alone for an "all transactions" aggregate. */
  name: string;
  /** Where the series came from, for the source dot and the faint sub-label. */
  source?: SourceType;
  sourceLabel?: string;
  color: string;
  /** Baseline rows are dashed, in both the chart and the swatch. */
  dashed?: boolean;
  /** The stored unit id — what the picker edits. */
  unit?: string;
  /** The panel's own unit. A difference from `unit` is an override, and gets a dot. */
  panelUnit?: string;
  /** The unit the axis is actually drawn in, when auto-scaling moved it. */
  displayUnit?: string;
  hidden?: boolean;
  /** `L` / `R`, or the lane number. `—` when the row is hidden. */
  axis: string;
  stats: SeriesStats | null;
  /** The value at the hovered x, or null when the cursor is off the plot. */
  cursor?: number | null;
}

interface SeriesTableProps {
  rows: SeriesRow[];
  mode: ChartMode;
  /** Omitted where a card has no per-series unit (Compare shows it read-only). */
  onUpdateUnit?: (seriesId: string, unitId: string) => void;
  onToggleVisibility?: (seriesId: string) => void;
  onRemove?: (seriesId: string) => void;
  /** Hovering a row dims the other traces; null on leave. */
  onHoverRow?: (seriesId: string | null) => void;
  /** Named in the unit picker's footer: "Panel unit from {this}". */
}

const COLUMNS = '22px 1fr 92px 34px 52px 52px 52px 60px 22px';

export default function SeriesTable({
  rows,
  mode,
  onUpdateUnit,
  onToggleVisibility,
  onRemove,
  onHoverRow,
}: SeriesTableProps) {
  const theme = chartTheme(mode);
  const [picker, setPicker] = useState<{ el: HTMLElement; row: SeriesRow } | null>(null);

  if (rows.length === 0) return null;

  const head = (text: string, align: 'left' | 'right' | 'center' = 'left') => (
    <Box key={text} sx={{ textAlign: align, fontFamily: MONO, fontSize: SIZE.tableFont, color: theme.faint }}>
      {text}
    </Box>
  );

  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: COLUMNS,
          gap: 0.75,
          alignItems: 'center',
          px: 1.75,
          pb: 0.5,
          borderBottom: `1px solid ${theme.divider}`,
        }}
      >
        <Box />
        {head('series')}
        {head('unit')}
        {head('axis', 'center')}
        {head('min', 'right')}
        {head('mean', 'right')}
        {head('max', 'right')}
        {head('cursor', 'right')}
        <Box />
      </Box>

      {rows.map((row) => {
        const overridden = !!row.panelUnit && row.unit !== row.panelUnit;
        const scaled = !!row.displayUnit && row.displayUnit !== unitText(row.unit);
        return (
          <Box
            key={row.id}
            onMouseEnter={() => onHoverRow?.(row.id)}
            onMouseLeave={() => onHoverRow?.(null)}
            sx={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: 0.75,
              alignItems: 'center',
              px: 1.75,
              py: '3px',
              borderBottom: `1px solid ${theme.grid}`,
              opacity: row.hidden ? 0.35 : 1,
              '&:hover': { bgcolor: theme.hover },
            }}
          >
            {/* swatch — click toggles the trace */}
            <Box
              component="button"
              type="button"
              aria-label={`${row.hidden ? 'Show' : 'Hide'} ${row.name}`}
              aria-pressed={!row.hidden}
              onClick={() => onToggleVisibility?.(row.id)}
              disabled={!onToggleVisibility}
              sx={{
                p: 0,
                border: 0,
                bgcolor: 'transparent',
                cursor: onToggleVisibility ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                height: 14,
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: 12,
                  height: 0,
                  borderTop: `2px ${row.dashed ? 'dashed' : 'solid'} ${row.color}`,
                }}
              />
            </Box>

            {/* series — name plus where it came from */}
            <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {row.source && (
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor: SOURCE_COLOR[row.source]?.color ?? theme.faint,
                  }}
                />
              )}
              <Typography
                sx={{ fontFamily: MONO, fontSize: SIZE.valueFont, color: theme.text, minWidth: 0 }}
                noWrap
                title={row.name}
              >
                {row.name}
              </Typography>
              {row.sourceLabel && (
                <Typography
                  sx={{ fontFamily: MONO, fontSize: SIZE.tableFont, color: theme.faint, flexShrink: 0 }}
                  noWrap
                >
                  {row.sourceLabel}
                </Typography>
              )}
            </Box>

            {/* unit — a button when the card lets a series override it, text when it does not */}
            {onUpdateUnit ? (
              <Box
                component="button"
                type="button"
                onClick={(e) => setPicker({ el: e.currentTarget, row })}
                aria-label={`Unit for ${row.name}`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.4,
                  height: 18,
                  px: 0.5,
                  border: `1px solid ${theme.divider}`,
                  borderRadius: '4px',
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  fontFamily: MONO,
                  fontSize: SIZE.tableFont,
                  color: theme.muted,
                  overflow: 'hidden',
                  '&:hover': { bgcolor: theme.hover },
                }}
              >
                {overridden && (
                  <Box
                    aria-hidden="true"
                    sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: theme.primary, flexShrink: 0 }}
                  />
                )}
                <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                  {unitText(row.unit) || 'none'}
                </Box>
                {scaled && (
                  <Box component="span" sx={{ color: theme.faint, whiteSpace: 'nowrap' }}>
                    →{row.displayUnit}
                  </Box>
                )}
              </Box>
            ) : (
              <Typography sx={{ fontFamily: MONO, fontSize: SIZE.tableFont, color: theme.faint }} noWrap>
                {row.displayUnit || unitText(row.unit) || 'none'}
              </Typography>
            )}

            {/* axis */}
            <Typography
              sx={{ fontFamily: MONO, fontSize: SIZE.tableFont, color: theme.faint, textAlign: 'center' }}
            >
              {row.hidden ? EMPTY : row.axis}
            </Typography>

            <Value theme={theme} value={row.stats?.min} />
            <Value theme={theme} value={row.stats?.mean} />
            <Value theme={theme} value={row.stats?.max} />
            <Value theme={theme} value={row.cursor} emphasis />

            {/* remove */}
            {onRemove ? (
              <Box
                component="button"
                type="button"
                aria-label={`Remove ${row.name}`}
                onClick={() => onRemove(row.id)}
                sx={{
                  p: 0,
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  fontFamily: MONO,
                  fontSize: 12,
                  lineHeight: 1,
                  color: theme.faint,
                  '&:hover': { color: theme.error },
                }}
              >
                ×
              </Box>
            ) : (
              <Box />
            )}
          </Box>
        );
      })}

      {picker && onUpdateUnit && (
        <UnitPicker
          open
          anchorEl={picker.el}
          onClose={() => setPicker(null)}
          mode={mode}
          title={`Unit · ${picker.row.name}`}
          value={picker.row.unit}
          panelUnit={picker.row.panelUnit}
          panelSource={picker.row.sourceLabel}
          onSelect={(unitId) => onUpdateUnit(picker.row.id, unitId)}
        />
      )}
    </Box>
  );
}

function Value({
  theme,
  value,
  emphasis,
}: {
  theme: ReturnType<typeof chartTheme>;
  value: number | null | undefined;
  emphasis?: boolean;
}) {
  const text = fv(value);
  return (
    <Typography
      noWrap
      // The numeric columns are 52px — about eight mono characters at 10px — and `fv`
      // prints a grouped integer from 1000 up. `units.ts` auto-scales only the time,
      // percent and data families, so an unscaled count or rate in the millions is
      // `1,234,567`: nine characters, which would wrap to a second line inside the row and
      // break the table's vertical rhythm. Clipped with the full value on hover instead,
      // the way the name cell already does it.
      title={text}
      sx={{
        fontFamily: MONO,
        fontSize: SIZE.tableFont,
        textAlign: 'right',
        color: emphasis ? theme.text : theme.muted,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {text}
    </Typography>
  );
}
