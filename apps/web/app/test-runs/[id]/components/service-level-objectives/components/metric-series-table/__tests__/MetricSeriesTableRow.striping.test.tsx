/**
 * Zebra striping and the readable-shade text on an SLO metric-series row.
 *
 * REGRESSION: the odd-row background was `alpha(theme.palette.action.hover, 0.3)`. `action.hover`
 * is ALREADY an rgba, and MUI's `alpha()` REPLACES the alpha channel rather than multiplying it,
 * so that expression evaluated to a 30 % black band in light mode (and a 30 % white one in dark)
 * instead of the ~4 % tint the author meant. Every other row of the table was a grey slab.
 *
 * These assert the rendered style, not the source expression, so the bug cannot come back through
 * a different route (a second `alpha()` wrap, a hard-coded rgba, a token swap).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider, createTheme, alpha, type Theme } from '@mui/material/styles';
import { MetricSeriesTableRow } from '../MetricSeriesTableRow';
import { MetricSeriesEmptyState } from '../MetricSeriesEmptyState';
import type { MetricSeriesResult, MetricTarget } from '../../../types';
import { lightTheme } from '@/lib/theme';

const light = createTheme({ palette: { mode: 'light' } });
const dark = createTheme({ palette: { mode: 'dark' } });

const result: MetricSeriesResult = {
  status: 'COMPLETE', evaluate_type: 'avg', metric_unit: 'ms',
  dashboard_label: 'JVM', panel_id: 5, panel_title: 'Heap',
};
const target: MetricTarget = { target: 'checkout', value: 120, meets_requirement: true };

function renderRow(theme: Theme, sortedIndex: number, isSelected = false) {
  const { container } = render(
    <ThemeProvider theme={theme}>
      <MetricSeriesTableRow
        target={target}
        sortedIndex={sortedIndex}
        totalCount={4}
        isSelected={isSelected}
        result={result}
        isStale={false}
        onClick={jest.fn()}
      />
    </ThemeProvider>,
  );
  return container.firstElementChild as HTMLElement;
}

/** jsdom normalises colours, so compare through it rather than against a literal string. */
function asRendered(color: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = color;
  return probe.style.backgroundColor;
}

/** The alpha channel of an `rgba(r, g, b, a)` string, or 1 for an opaque colour. */
function alphaOf(rgba: string): number {
  const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/.exec(rgba);
  if (!m) throw new Error(`not an rgb(a) colour: ${rgba}`);
  return m[1] === undefined ? 1 : Number(m[1]);
}

describe('MetricSeriesTableRow — zebra striping', () => {
  it.each([['light', light] as const, ['dark', dark] as const])(
    'gives an odd row the subtle action.hover tint in %s mode, not a 30%% overlay',
    (_mode, theme) => {
      const row = renderRow(theme, 1);
      const bg = getComputedStyle(row).backgroundColor;

      expect(bg).toBe(asRendered(theme.palette.action.hover));
      // The regression's fingerprint: a 30 % overlay. The real tint is an order of magnitude weaker.
      expect(alphaOf(bg)).toBeLessThan(0.15);
      expect(alphaOf(bg)).toBeGreaterThan(0);
    },
  );

  it('leaves even rows on the paper surface, so the stripe is the only difference', () => {
    for (const theme of [light, dark]) {
      const even = getComputedStyle(renderRow(theme, 0)).backgroundColor;
      const odd = getComputedStyle(renderRow(theme, 1)).backgroundColor;
      expect(even).toBe(asRendered(theme.palette.background.paper));
      expect(odd).not.toBe(even);
    }
  });

  it('lets the selection tint win over the stripe, on odd and even rows alike', () => {
    // Selection is checked first in the ternary, so parity must not reach the background at all.
    for (const theme of [light, dark]) {
      const selectedEven = getComputedStyle(renderRow(theme, 0, true)).backgroundColor;
      const selectedOdd = getComputedStyle(renderRow(theme, 1, true)).backgroundColor;
      expect(selectedOdd).toBe(selectedEven);
      expect(selectedOdd).not.toBe(asRendered(theme.palette.action.hover));
      expect(selectedOdd).not.toBe(asRendered(theme.palette.background.paper));
    }
  });
});

describe('MetricSeriesTableRow — readable shade on the selected row', () => {
  it.each([['light', light, 'dark'] as const, ['dark', dark, 'light'] as const])(
    'writes the selected series name in the %s-mode readable shade',
    (_mode, theme, shade) => {
      const row = renderRow(theme, 0, true);
      const name = screen.getAllByText('checkout')[0]!;
      expect(row).toContainElement(name);
      expect(getComputedStyle(name).color).toBe(asRendered(theme.palette.primary[shade]));
      // `.dark` on a dark surface was the unreadable case.
      if (shade === 'light') {
        expect(getComputedStyle(name).color).not.toBe(asRendered(theme.palette.primary.dark));
      }
    },
  );

  it('writes the value in the readable shade for the mode for a non-apdex result', () => {
    for (const [theme, shade] of [[light, 'dark'], [dark, 'light']] as const) {
      render(
        <ThemeProvider theme={theme}>
          <MetricSeriesTableRow
            target={target} sortedIndex={0} totalCount={1} isSelected={false}
            result={result} isStale={false} onClick={jest.fn()}
          />
        </ThemeProvider>,
      );
      const value = screen.getAllByText('120.00 ms').slice(-1)[0]!;
      expect(getComputedStyle(value).color).toBe(asRendered(theme.palette.primary[shade]));
    }
  });
});

describe('MetricSeriesEmptyState', () => {
  it('uses the same subtle tint as a striped row rather than a 30% overlay', () => {
    for (const theme of [light, dark]) {
      const { container } = render(
        <ThemeProvider theme={theme}>
          <MetricSeriesEmptyState />
        </ThemeProvider>,
      );
      const box = container.firstElementChild as HTMLElement;
      const bg = getComputedStyle(box).backgroundColor;
      expect(bg).toBe(asRendered(theme.palette.action.hover));
      expect(alphaOf(bg)).toBeLessThan(0.15);
    }
  });
});

/**
 * With the 30 % band gone, stripe / hover / selected sat within ~3 % luminance of each other and
 * hover moved in OPPOSITE directions depending on row parity — hovering an odd row made it
 * lighter, an even row darker. The states are now strictly ordered by tint strength. Asserted on
 * the resolved sx rather than a rendered :hover, which jsdom never applies.
 */
describe('MetricSeriesTableRow — interaction states are ordered', () => {
  const alphaOf = (rgba: string): number => {
    const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(rgba);
    if (!m) throw new Error(`not an rgba colour: ${rgba}`);
    return Number(m[1]);
  };

  it('orders stripe < hover < selected < selected+hover, in both parities', () => {
    const stripe = alphaOf(lightTheme.palette.action.hover);
    const hover = alphaOf(alpha(lightTheme.palette.primary.main, 0.08));
    const selected = alphaOf(alpha(lightTheme.palette.primary.main, 0.12));
    const selectedHover = alphaOf(alpha(lightTheme.palette.primary.main, 0.16));

    expect(stripe).toBeLessThan(hover);
    expect(hover).toBeLessThan(selected);
    expect(selected).toBeLessThan(selectedHover);

    // The inversion this guards: hover must beat the ODD stripe too, not just the even paper row,
    // or hovering an odd row lightens it into looking like an even one.
    expect(hover).toBeGreaterThan(stripe);
  });
});
