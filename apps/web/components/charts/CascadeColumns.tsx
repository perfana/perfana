'use client';

/**
 * The three-column picker's presentation, with no opinion about what is being picked.
 *
 * Two cascades render exactly this: the test-run cards' dashboards → panels → series
 * picker (`MetricSeriesCascade`) and the report sections' metric selection
 * (`MetricSelectionCascade`). They differ in everything else — one reads a run's
 * `ApplicationDashboard[]` and reports concrete picks, the other reads a
 * system/environment by metrics source and stores labels where an empty level means
 * "everything below it" — so only the chrome is shared. Keeping it in one place is what
 * stops the two from drifting into two slightly different pickers again.
 *
 * Typography and palette follow the app, not the chart standard: no `fontFamily` is set
 * anywhere below, so every `Typography` inherits `theme.typography.fontFamily`. See "the
 * add-series cascade is app-typed" in apps/web/CLAUDE.md.
 */

import React from 'react';
import { Box, Typography, Checkbox, CircularProgress, Button, InputBase } from '@mui/material';
import { Close, Search } from '@mui/icons-material';
import { SIZE, chartTheme } from '@/lib/charts';

/** Rows are ~32px, so this shows about eight of them. */
export const CASCADE_COLUMN_HEIGHT = 280;

/** Every Button in a cascade drops MUI's uppercase; keep them in step. */
export const CASCADE_BUTTON = { textTransform: 'none', flexShrink: 0 } as const;

/**
 * Case-insensitive substring match across every field the user can see in a row,
 * including its GROUP heading — so "grafana" finds every Grafana dashboard, and a
 * dashboard name typed into the panels column finds that dashboard's panels.
 *
 * Filtering is a view concern only: it never changes the selection, so a row that
 * scrolls out of view because of a query stays picked.
 */
export function cascadeMatchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** `Dashboards 12 / 90` while filtering, `Dashboards 90` otherwise. */
export const cascadeCountLabel = (noun: string, shown: number, total: number) =>
  shown === total ? `${noun} ${total}` : `${noun} ${shown} / ${total}`;

/**
 * The bordered frame: a grid of columns over a footer. The default column widths give the
 * series column the extra room, because a metric name is the longest of the three.
 */
export function CascadeFrame({
  theme,
  columns = '1fr 1fr 1.15fr',
  footer,
  children,
}: {
  theme: CascadeTheme;
  columns?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        border: `1px solid ${theme.divider}`,
        borderRadius: `${SIZE.radius}px`,
        overflow: 'hidden',
        bgcolor: theme.paper,
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: columns }}>{children}</Box>
      {footer && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 1.25,
            py: 0.75,
            bgcolor: theme.plotBg,
            borderTop: `1px solid ${theme.divider}`,
          }}
        >
          {footer}
        </Box>
      )}
    </Box>
  );
}

/** The chart palette, which supplies this picker's colours. */
export type CascadeTheme = ReturnType<typeof chartTheme>;

export function cascadeGroupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return Array.from(groups.entries());
}

export function CascadeColumn({
  theme,
  label,
  heading,
  caption,
  allPicked,
  onToggleAll,
  toggleDisabled,
  loading,
  empty,
  divider,
  query,
  onQueryChange,
  queryPlaceholder,
  children,
}: {
  theme: CascadeTheme;
  label: string;
  heading: string;
  caption: string;
  allPicked: boolean;
  onToggleAll: () => void;
  toggleDisabled: boolean;
  loading?: boolean;
  empty?: boolean;
  divider?: boolean;
  /** Omit both to render a column with no filter field. */
  query?: string;
  onQueryChange?: (value: string) => void;
  queryPlaceholder?: string;
  children: React.ReactNode;
}) {
  return (
    // The aria-label is the handle every test and screen reader reaches this level by.
    <Box
      role="group"
      aria-label={label}
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: divider ? `1px solid ${theme.divider}` : 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, pt: 0.75 }}>
        <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600, color: theme.text }} noWrap>
          {heading}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={onToggleAll}
          disabled={toggleDisabled}
          // Named, so a test (and a screen reader) can reach this one button in this one
          // column. Its label changes with state, so `getByRole('button', { name: 'Clear' })`
          // cannot find it before it is armed, and three columns each have a "Select all".
          aria-label={`${allPicked ? 'Clear' : 'Select all'} ${label.toLowerCase()}`}
          sx={{
            ...CASCADE_BUTTON,
            minWidth: 0,
            px: 0.75,
            py: 0,
            border: 0,
            color: theme.primary,
            '&:hover': { border: 0, bgcolor: theme.hover },
          }}
        >
          {allPicked ? 'Clear' : 'Select all'}
        </Button>
      </Box>
      <Typography sx={{ px: 1.25, pb: 0.5, fontSize: 12, color: theme.muted }} noWrap>
        {caption}
      </Typography>
      {onQueryChange && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            mx: 1.25,
            mb: 0.5,
            px: 1,
            height: 30,
            border: `1px solid ${theme.divider}`,
            borderRadius: '4px',
            '&:focus-within': { borderColor: theme.primary },
          }}
        >
          <Search sx={{ fontSize: 16, color: theme.faint, flexShrink: 0 }} />
          <InputBase
            value={query ?? ''}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={queryPlaceholder}
            // The column heading already names the level; a visible label would cost a
            // row of height in the list.
            inputProps={{ 'aria-label': `Filter ${label.toLowerCase()}` }}
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              color: theme.text,
              '& input': { p: 0 },
              '& input::placeholder': { color: theme.faint, opacity: 1 },
            }}
          />
          {query ? (
            <Box
              component="button"
              type="button"
              aria-label={`Clear ${label.toLowerCase()} filter`}
              onClick={() => onQueryChange('')}
              sx={{
                border: 0, p: 0, display: 'inline-flex', cursor: 'pointer',
                bgcolor: 'transparent', color: theme.faint,
                '&:hover': { color: theme.text },
              }}
            >
              <Close sx={{ fontSize: 16 }} />
            </Box>
          ) : null}
        </Box>
      )}
      <Box sx={{ height: CASCADE_COLUMN_HEIGHT, overflowY: 'auto', overflowX: 'hidden', px: 0.5, pb: 0.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
            <CircularProgress size={16} />
          </Box>
        ) : empty ? null : (
          children
        )}
      </Box>
    </Box>
  );
}

export function CascadeGroup({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Typography
        sx={{
          px: 0.75,
          py: 0.25,
          fontSize: 11,
          fontWeight: 600,
          color,
        }}
        noWrap
        title={label}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

export function CascadeRow({
  theme,
  checked,
  onToggle,
  label,
  trailing,
  disabled,
}: {
  theme: CascadeTheme;
  checked: boolean;
  onToggle: () => void;
  label: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.75,
        minHeight: 32,
        borderRadius: '4px',
        opacity: disabled ? 0.45 : 1,
        '&:hover': { bgcolor: disabled ? 'transparent' : theme.hover },
      }}
    >
      <Checkbox
        size="small"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        inputProps={{ 'aria-label': label }}
        sx={{ p: 0.5, color: theme.faint, '&.Mui-checked': { color: theme.primary } }}
      />
      <Typography
        onClick={disabled ? undefined : onToggle}
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: theme.text,
          cursor: disabled ? 'default' : 'pointer',
        }}
        noWrap
        title={label}
      >
        {label}
      </Typography>
      {trailing}
    </Box>
  );
}

export function CascadeHint({ theme, children }: { theme: CascadeTheme; children: React.ReactNode }) {
  return (
    <Typography
      component="span"
      sx={{ flexShrink: 0, fontSize: 11, color: theme.faint }}
    >
      {children}
    </Typography>
  );
}
