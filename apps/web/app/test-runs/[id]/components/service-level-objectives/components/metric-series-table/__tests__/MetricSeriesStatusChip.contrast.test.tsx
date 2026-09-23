/**
 * `getChipColorsForTheme` has its own tests; this asserts the WIRING — that the chip actually
 * paints with the live theme. The util tests would stay green if `sx={getThemedChipStyles(...)}`
 * stopped receiving `theme`, and the chip is the surface the reader is looking at when they say
 * the table is unreadable.
 *
 * Asserted against the themes the app ships, not MUI's defaults.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@mui/material/styles';
import { lightTheme, darkTheme } from '@/lib/theme';
import { MetricSeriesStatusChip } from '../MetricSeriesStatusChip';
import { getThemedChipStyles } from '../../../utils/metric-series-table-utils';
import type { MetricTarget, MetricSeriesResult } from '../../../types';

const trendResult: MetricSeriesResult = { evaluate_type: 'trend', metric_unit: '%/h', status: 'COMPLETE' };

/** jsdom normalises colours, so compare through it rather than against a literal string. */
function asRendered(color: string): string {
  const probe = document.createElement('div');
  probe.style.color = color;
  return probe.style.color;
}

function renderChip(theme: typeof lightTheme, target: MetricTarget) {
  const { unmount } = render(
    <ThemeProvider theme={theme}>
      <MetricSeriesStatusChip target={target} result={trendResult} isStale={false} />
    </ThemeProvider>,
  );
  return unmount;
}

describe.each([
  ['lightTheme', lightTheme],
  ['darkTheme', darkTheme],
] as const)('MetricSeriesStatusChip paints from the theme — %s', (_name, theme) => {
  it.each([
    ['Fail', 'fail', { target: 'a', value: 26.4, meets_requirement: false }],
    ['Pass', 'pass', { target: 'b', value: 1.1, meets_requirement: true }],
  ] as const)('gives the %s chip the themed label colour', (label, kind, target) => {
    const unmount = renderChip(theme, target as MetricTarget);

    const chip = screen.getByText(label).closest('.MuiChip-root') as HTMLElement;
    expect(getComputedStyle(chip).color).toBe(
      asRendered(getThemedChipStyles(kind, false, theme).color as string),
    );
    unmount();
  });

  it('never writes a chip label in the mode-blind .dark shade in dark mode', () => {
    const unmount = renderChip(darkTheme, { target: 'a', value: 26.4, meets_requirement: false });

    const chip = screen.getByText('Fail').closest('.MuiChip-root') as HTMLElement;
    // The exact defect readableShade exists to stop: `.dark` on a dark surface.
    expect(getComputedStyle(chip).color).not.toBe(asRendered(darkTheme.palette.error.dark));
    unmount();
  });
});
