/**
 * The two menu-item components behind every row's "Open in …" and "View in Performance
 * Analysis" entries. Each one is gated on something the caller cannot always supply: the run
 * id from the route, a series with a metric name, a drill-down provider, a transaction.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useParams } from 'next/navigation';
import {
  OpenInCardMenuItems,
  PerformanceAnalysisDrillDownContext,
  ViewInPerformanceAnalysisMenuItem,
} from '../metric-card-links';

const series = { dashboardLabel: 'Performance test metrics S', panelId: 101, metricName: 'T' };

beforeEach(() => {
  (useParams as jest.Mock).mockReturnValue({ id: 'WERKNL-00011' });
});

describe('OpenInCardMenuItems', () => {
  it('renders one new-tab link per card, carrying the series, and closes the menu on click', () => {
    const onClose = jest.fn();
    render(<OpenInCardMenuItems series={series} onClose={onClose} />);

    const links = ['Open in Graphs', 'Open in Compare', 'Open in Trends'].map((label) => screen.getByText(label).closest('a')!);
    expect(links.map((a) => new URL(a.getAttribute('href')!, 'http://x').searchParams.get('card'))).toEqual(['graphs', 'compare', 'trends']);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener');
      expect(a.getAttribute('href')).toMatch(/^\/test-runs\/WERKNL-00011\?/);
      expect(new URL(a.getAttribute('href')!, 'http://x').searchParams.get('metric')).toBe('T');
    }

    fireEvent.click(links[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a series, without a metric name, or outside /test-runs/[id]', () => {
    const { container, rerender } = render(<OpenInCardMenuItems series={null} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();

    // A row whose target has no name (the SLO table renders "Series N" for it) has nothing to link.
    rerender(<OpenInCardMenuItems series={{ ...series, metricName: '' }} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();

    // No run id in the route: the link would point at /test-runs/?card=… and open the list page.
    (useParams as jest.Mock).mockReturnValue({});
    rerender(<OpenInCardMenuItems series={series} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ViewInPerformanceAnalysisMenuItem', () => {
  it('hands the filters to the page-provided drill-down and closes the menu', () => {
    const drillDown = jest.fn();
    const onClose = jest.fn();
    const filters = { scenario: 'S', transaction: 'T', sampler: 'R' };
    render(
      <PerformanceAnalysisDrillDownContext.Provider value={drillDown}>
        <ViewInPerformanceAnalysisMenuItem filters={filters} onClose={onClose} />
      </PerformanceAnalysisDrillDownContext.Provider>,
    );

    fireEvent.click(screen.getByText('View in Performance Analysis'));
    expect(drillDown).toHaveBeenCalledWith(filters);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without a provider (rendered outside the page) or without a transaction', () => {
    // No provider: the item would have nowhere to go.
    const { container, unmount } = render(<ViewInPerformanceAnalysisMenuItem filters={{ scenario: 'S', transaction: 'T' }} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    // A scenario-only filter (an Error Count row, say) cannot seed the transaction filter.
    const second = render(
      <PerformanceAnalysisDrillDownContext.Provider value={jest.fn()}>
        <ViewInPerformanceAnalysisMenuItem filters={{ scenario: 'S' }} onClose={jest.fn()} />
        <ViewInPerformanceAnalysisMenuItem filters={null} onClose={jest.fn()} />
      </PerformanceAnalysisDrillDownContext.Provider>,
    );
    expect(second.container).toBeEmptyDOMElement();
  });
});
