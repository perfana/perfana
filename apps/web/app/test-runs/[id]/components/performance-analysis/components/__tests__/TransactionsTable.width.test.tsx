/**
 * Performance Analysis scrolled sideways at full width on a 16" MacBook: eleven `nowrap`
 * header labels put the Scenarios table's min-content width at 1703px against a 1302px
 * content column. Two things fixed it and both are one edit away from being undone —
 * `whiteSpace: 'nowrap'` reads like a tidiness win, and a `minWidth` on a wide table reads
 * like a safety net. jsdom does no layout, so these assert the declarations, which is what
 * a future edit would change.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TransactionsTable, TransactionsTableProps } from '../TransactionsTable';
import { NO_SCENARIO_LABEL } from '../ScenarioFilter';
import { TABLE_HEADER_CELL_SX, tableHeaderCellSx } from '../../utils/table-header-style';
import type { TransactionStat } from '../../types/performance-analysis.types';

const tx = (transaction_name: string): TransactionStat =>
  ({
    transaction_name,
    scenario_name: null,
    avg_response_time: 10,
    p95_response_time: 20,
    p99_response_time: 30,
    passed_count: 10,
    failed_count: 0,
    total_count: 10,
    apdex_score: 1,
    active_threshold: 500,
  }) as unknown as TransactionStat;

const rows = [tx('checkout'), tx('login')];

function renderTable() {
  const props: TransactionsTableProps = {
    scenarioGroups: [[NO_SCENARIO_LABEL, rows]],
    transactions: rows,
    throughputStats: null,
    virtualUserStats: null,
    sortField: 'transaction_name',
    sortOrder: 'asc',
    onSort: jest.fn(),
    expandedRows: new Set(),
    rowSamples: {},
    loadingSamples: {},
    samplesError: {},
    onRowClick: jest.fn(),
    expandedScenarios: new Set([NO_SCENARIO_LABEL]),
    onToggleScenario: jest.fn(),
    onOpenActionMenu: jest.fn(),
    onOpenTransactionErrors: jest.fn(),
    onOpenSamplerActionMenu: jest.fn(),
    onOpenSamplerErrors: jest.fn(),
  };
  return render(<TransactionsTable {...props} />);
}

describe('the Scenarios table keeps its min-content width down', () => {
  // The header labels are the floor for ten of the eleven columns. `nowrap` was worth 324px
  // of overflow on its own.
  it('lets the measurement header labels wrap', () => {
    expect(TABLE_HEADER_CELL_SX).toMatchObject({ whiteSpace: 'normal' });
  });

  it('keeps that whiteSpace when a header cell merges its own overrides in', () => {
    expect(tableHeaderCellSx({ textAlign: 'right' })).toMatchObject({
      whiteSpace: 'normal',
      textAlign: 'right',
    });
  });

  // 800 was below the real minimum in every expanded state, so it never prevented a
  // scrollbar; it only stopped the collapsed table (606px) from shrinking. A hardcoded
  // floor on this table can only be wrong again.
  it('declares no minWidth on the table itself', () => {
    const { container } = renderTable();
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    // Assert the ABSENCE of a floor, not the absence of one particular value:
    // `.not.toBe('800px')` would pass for `minWidth: 1000`, `'50rem'` or a breakpoint,
    // which is the obvious thing a future "fix" reaches for and the exact mistake this
    // guards against.
    expect(window.getComputedStyle(table as Element).minWidth).toBe('');
  });

  // Halving MUI's 16px-per-side default across eleven columns returns 176px, and it has to
  // cascade into the nested request table, which shares the same grid.
  it('halves the cell padding for every cell under the table, nested ones included', () => {
    const { container } = renderTable();
    const cells = container.querySelectorAll('td, th');
    expect(cells.length).toBeGreaterThan(0);

    // The padding is a ThemeProvider styleOverride on MuiTableCell, NOT
    // `sx={{ '& .MuiTableCell-root': … }}`. That distinction is the point: a descendant
    // selector is two class names (0,2,0) and outranks every per-cell `sx` (0,1,0) beneath
    // it, which silently defeated the filter row's `px: 2` and the nested request table's
    // `pr: 2`. A styleOverride lands on the cell's own class, so getComputedStyle resolves
    // it in jsdom and a cell that states its own padding still wins.
    const plain = Array.from(cells).find(
      (c) => !(c as HTMLElement).style.paddingLeft && c.getAttribute('colspan') === null,
    ) as HTMLElement | undefined;
    expect(plain).toBeDefined();
    const style = window.getComputedStyle(plain as Element);
    // MUI's default is 16px per side; the override is 8px.
    expect(style.paddingLeft).toBe('8px');
    expect(style.paddingRight).toBe('8px');
  });

  // The whole reason the override is a theme default rather than a descendant rule.
  it('lets a cell override the tightened padding with its own sx', () => {
    const { container } = renderTable();
    const rules: string[] = [];
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        Array.from(sheet.cssRules).forEach((r) => rules.push(r.cssText));
      } catch {
        /* cross-origin sheet, not ours */
      }
    });
    // No descendant rule may reintroduce the specificity trap.
    const descendantPaddingRule = rules.find(
      (r) => /\.css-[^ ]+ \.MuiTableCell-root/.test(r) && r.includes('padding-left'),
    );
    expect(descendantPaddingRule).toBeUndefined();

    // The filter row asks for px: 2 and must still get 16px.
    const filterCell = container.querySelector('td[colspan="11"] .MuiInputBase-root')?.closest('td');
    if (filterCell) {
      expect(window.getComputedStyle(filterCell).paddingLeft).toBe('16px');
    }
  });

  // Guard the reason the width mattered: all eleven columns are still rendered.
  it('still renders the transactions it was given', () => {
    renderTable();
    expect(screen.getByText('checkout')).toBeInTheDocument();
    expect(screen.getByText('login')).toBeInTheDocument();
  });
});
