/**
 * Both SLO table headers wrote their column labels as a literal `primary.dark`, which on a dark
 * surface is the same lightness as the surface. They now go through `readableShade`. The util has
 * its own tests; this asserts the WIRING — that each component passes the live theme in and paints
 * the label with what comes back, in both modes.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MetricSeriesTableHeader } from '../metric-series-table/MetricSeriesTableHeader';
import { SortableTableHeader } from '../apdex-scenario/SortableTableHeader';

const light = createTheme({ palette: { mode: 'light' } });
const dark = createTheme({ palette: { mode: 'dark' } });

function asRendered(color: string): string {
  const probe = document.createElement('div');
  probe.style.color = color;
  return probe.style.color;
}

describe.each([
  ['light', light, 'dark'] as const,
  ['dark', dark, 'light'] as const,
])('SLO table headers in %s mode', (_mode, theme, shade) => {
  const expected = () => asRendered(theme.palette.primary[shade]);
  const wrong = () => asRendered(theme.palette.primary[shade === 'dark' ? 'light' : 'dark']);

  it('paints the metric-series column labels in the readable shade', () => {
    render(
      <ThemeProvider theme={theme}>
        <MetricSeriesTableHeader resultKey="k" sortConfig={new Map()} onSort={jest.fn()} />
      </ThemeProvider>,
    );

    for (const label of ['Series', 'Value', 'Result']) {
      expect(getComputedStyle(screen.getByText(label)).color).toBe(expected());
      expect(getComputedStyle(screen.getByText(label)).color).not.toBe(wrong());
    }
  });

  it('paints the apdex-scenario column labels in the readable shade', () => {
    render(
      <ThemeProvider theme={theme}>
        <SortableTableHeader resultKey="k" sortConfig={new Map()} onSort={jest.fn()} />
      </ThemeProvider>,
    );

    for (const label of ['Transaction', 'Threshold', 'Avg RT', 'Apdex', 'Result']) {
      expect(getComputedStyle(screen.getByText(label)).color).toBe(expected());
      expect(getComputedStyle(screen.getByText(label)).color).not.toBe(wrong());
    }
  });
});
