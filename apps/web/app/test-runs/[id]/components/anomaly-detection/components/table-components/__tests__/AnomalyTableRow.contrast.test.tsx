/**
 * REGRESSION, same class as the SLO metric-series row: the expanded anomaly row's background was
 * `linear-gradient(135deg, alpha(action.hover, 0.2), alpha(action.hover, 0.3))`. `action.hover` is
 * already an rgba and MUI's `alpha()` REPLACES the alpha channel rather than multiplying it, so
 * both stops were near-opaque overlays — a 20-30 % slab under the expanded row, in both modes.
 *
 * It is now the flat `action.selected` token. `action.hover` was the first fix and was WRONG in a
 * second way that three review lanes caught: at rgba(0,0,0,0.04) it rendered an expanded row
 * FAINTER than an ordinary odd stripe (8% primary), inverting the emphasis. `action.selected` is
 * MUI's token for a persistently-activated row and is stronger than `action.hover` by design --
 * it is already what the expanded content panel below uses.
 *
 * Asserted on the rendered style, so a re-wrap in `alpha()` or a hard-coded rgba fails too.
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider, createTheme, type Theme } from '@mui/material/styles';
import { AnomalyTableRow } from '../AnomalyTableRow';
import type { AnomalyData } from '../../../types';

const light = createTheme({ palette: { mode: 'light' } });
const dark = createTheme({ palette: { mode: 'dark' } });

const row: AnomalyData = {
  dashboard_label: 'JVM',
  panel_title: 'Heap used',
  metric_name: 'heap',
  unit: 'bytes',
  classification: 'unclassified',
  conclusion_label: 'No change',
  test_value: '100',
  control_group_value: '98',
  difference: '2',
  application_dashboard_id: 'ad-1',
  panel_id: '5',
};

function renderRow(theme: Theme, opts: { isExpanded: boolean; index?: number }) {
  const { container } = render(
    <ThemeProvider theme={theme}>
      <AnomalyTableRow
        row={row}
        rowKey="k"
        index={opts.index ?? 0}
        isExpanded={opts.isExpanded}
        isLast={false}
        testRunId="run-1"
        drawerData={{}}
        onToggleExpanded={jest.fn()}
        onOpenActionMenu={jest.fn()}
        onStaleChipClick={jest.fn()}
        hasActionMenu={false}
      />
    </ThemeProvider>,
  );
  return container.firstElementChild as HTMLElement;
}

/** The alpha channel of an `rgba(...)` token, for comparing tint strength. */
function alphaOf(color: string): number {
  const m = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(color);
  if (!m) throw new Error(`not an rgba colour: ${color}`);
  return Number(m[1]);
}

/** jsdom normalises colours, so compare through it rather than against a literal string. */
function asRendered(color: string): string {
  const probe = document.createElement('div');
  probe.style.background = color;
  return probe.style.background;
}

describe('AnomalyTableRow — expanded row background', () => {
  it.each([['light', light] as const, ['dark', dark] as const])(
    'uses the flat action.selected tint in %s mode, not a near-opaque gradient',
    (_mode, theme) => {
      const el = renderRow(theme, { isExpanded: true });
      const bg = getComputedStyle(el).background;

      expect(bg).toContain(asRendered(theme.palette.action.selected));
      expect(bg).not.toContain('gradient');
      // The regression's fingerprint: an alpha channel an order of magnitude too strong.
      expect(bg).not.toMatch(/,\s*0\.[23]\)/);
    },
  );

  it('leaves the collapsed zebra stripe alone, so expansion is still visually distinct', () => {
    // Only the expanded arm changed. jsdom does not serialise `linear-gradient` into the
    // `background` shorthand, so the collapsed stripe reads as empty there — which is itself the
    // distinguishing fact: the expanded row resolves to a colour and the collapsed one does not.
    const oddCollapsed = getComputedStyle(renderRow(light, { isExpanded: false, index: 1 })).background;
    const expanded = getComputedStyle(renderRow(light, { isExpanded: true, index: 1 })).background;

    expect(expanded).not.toBe(oddCollapsed);
    expect(expanded).toBe(asRendered(light.palette.action.selected));
    expect(oddCollapsed).not.toBe(asRendered(light.palette.action.selected));

    // The emphasis ordering itself, not just "they differ": the token the expanded row uses must
    // be the stronger of the two. `action.hover` (0.04) is fainter than the 0.08 primary stripe,
    // which is exactly the inversion this assertion exists to catch.
    expect(alphaOf(light.palette.action.selected)).toBeGreaterThan(
      alphaOf(light.palette.action.hover),
    );
    expect(alphaOf(light.palette.action.selected)).toBeGreaterThanOrEqual(0.08);

    // An even collapsed row stays on the paper surface via `backgroundColor`, untouched.
    const evenCollapsed = renderRow(light, { isExpanded: false, index: 0 });
    expect(getComputedStyle(evenCollapsed).backgroundColor).toBe(
      asRendered(light.palette.background.paper),
    );
  });
});
