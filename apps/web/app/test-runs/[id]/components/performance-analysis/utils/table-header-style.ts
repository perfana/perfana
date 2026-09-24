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
  // These labels used to be `nowrap`, to stop them stacking one word per line once the
  // transaction-name column had claimed the leftover width. The cost was not a tidier
  // header, it was a horizontal scrollbar: eleven nowrap labels put the table's min-content
  // width at 1703px against a 1302px content column on a 16" MacBook — measured on
  // SONAR-acceptatie-loadtest_perfana-00010 with one scenario expanded — so the section
  // scrolled sideways at full screen, not just on a small one. Letting them wrap returns
  // 324px of that; the other 176px comes from the tighter cell padding in
  // TransactionsTable. A two- or three-line header is the price, and it is the cheaper one.
  whiteSpace: 'normal',
};

/** The same, for a header cell that also needs its own overrides merged in. */
export const tableHeaderCellSx = (extra?: Record<string, unknown>) => ({
  ...(TABLE_HEADER_CELL_SX as Record<string, unknown>),
  ...(extra ?? {}),
});
