import type { SxProps, Theme } from '@mui/material';

/**
 * Header cell styling shared by the transaction table and the request table nested inside it.
 *
 * The two drifted apart: `styles/base.css` uppercases every `th`, which the request headers pick
 * up, but the transaction headers put their text inside a `TableSortLabel` whose own styles win —
 * so the same markup rendered in two different styles, one above the other. Stating it explicitly
 * here makes both tables look the same and stops them diverging again.
 */
export const TABLE_HEADER_CELL_SX: SxProps<Theme> = {
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

/** The same, for a header cell that also needs its own overrides merged in. */
export const tableHeaderCellSx = (extra?: Record<string, unknown>) => ({
  ...(TABLE_HEADER_CELL_SX as Record<string, unknown>),
  ...(extra ?? {}),
});
