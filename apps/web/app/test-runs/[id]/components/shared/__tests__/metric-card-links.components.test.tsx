/**
 * The two menu-item components behind every row's "Open in …" and "View in Performance
 * Analysis" entries. Each one is gated on something the caller cannot always supply: the run
 * id from the route, a series with a metric name, a drill-down provider, a transaction.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  OpenCardLinkContext,
  OpenInCardMenuItems,
  PerformanceAnalysisDrillDownContext,
  ViewInPerformanceAnalysisMenuItem,
} from '../metric-card-links';

const series = { dashboardLabel: 'Performance test metrics S', panelId: 101, metricName: 'T' };

beforeEach(() => {
  (useParams as jest.Mock).mockReturnValue({ id: 'WERKNL-00011' });
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
});

const renderMenu = (openCardLink = jest.fn(), onClose = jest.fn()) => {
  render(
    <OpenCardLinkContext.Provider value={openCardLink}>
      <OpenInCardMenuItems series={series} onClose={onClose} />
    </OpenCardLinkContext.Provider>,
  );
  return { openCardLink, onClose, link: (label: string) => screen.getByText(label).closest('a')! };
};

describe('OpenInCardMenuItems', () => {
  it('renders one link per card carrying the series; a plain click stays on the page and hands the series to the card', () => {
    // Value: protects=a plain click never navigates (no reload, no router round trip) and hands the series to the page; fails_when=the click stops preventing the native follow or stops calling openCardLink; why_new=red-team cycle 2: a router navigation could hard-reload and wipe kept state; seam=none; no_claim=what the card does with it
    const { openCardLink, onClose, link } = renderMenu();

    const links = ['Open in Graphs', 'Open in Compare', 'Open in Trends'].map(link);
    expect(links.map((a) => new URL(a.getAttribute('href')!, 'http://x').searchParams.get('card'))).toEqual(['graphs', 'compare', 'trends']);
    for (const a of links) {
      expect(a).not.toHaveAttribute('target');
      expect(a.getAttribute('href')).toMatch(/^\/test-runs\/WERKNL-00011\?/);
      expect(new URL(a.getAttribute('href')!, 'http://x').searchParams.get('metric')).toBe('T');
    }

    expect(fireEvent.click(links[1]!)).toBe(false);
    expect(openCardLink).toHaveBeenCalledWith('compare', series);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Win32', 'ctrlKey', true], ['Win32', 'shiftKey', true], ['Win32', 'metaKey', false], ['Win32', 'altKey', false],
    ['MacIntel', 'metaKey', true], ['MacIntel', 'shiftKey', true], ['MacIntel', 'ctrlKey', false], ['MacIntel', 'altKey', false],
  ])('on %s a %s click opens elsewhere: %s', (platform, modifier, elsewhere) => {
    // Value: protects=only the platform's new-tab modifier (and Shift) is left to the browser; Alt (download) and a Mac's Ctrl (same-tab reload) stay on the page; fails_when=the modifier set drifts from the platform's; why_new=adversarial review: Alt downloaded the link, Mac Ctrl reloaded the page; seam=none; no_claim=the browser's own modifier behaviour
    const platformSpy = jest.spyOn(navigator, 'platform', 'get').mockReturnValue(platform as string);
    const { openCardLink, onClose, link } = renderMenu();
    expect(fireEvent.click(link('Open in Graphs'), { [modifier as string]: true })).toBe(elsewhere);
    if (elsewhere) expect(openCardLink).not.toHaveBeenCalled();
    else expect(openCardLink).toHaveBeenCalledWith('graphs', series);
    expect(onClose).toHaveBeenCalledTimes(1);
    platformSpy.mockRestore();
  });

  it('follows the link natively when rendered outside the page (no provider)', () => {
    // Value: protects=without OpenCardLinkContext the row is an ordinary link; fails_when=the click is prevented with nowhere to hand the series; why_new=the provider-less branch; seam=none; no_claim=the navigation itself
    render(<OpenInCardMenuItems series={series} onClose={jest.fn()} />);
    expect(fireEvent.click(screen.getByText('Open in Graphs').closest('a')!)).toBe(true);
  });

  it('carries only the page\'s own scoping params into the link', () => {
    // Value: protects=a new-tab link keeps system/environment/workload/organizationId and nothing else; fails_when=the allowlist drops one, or unknown/old link params ride along; why_new=security review: a denylist forwarded every param; seam=none; no_claim=server-side trust of organizationId
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams({
      system: 'Shop', environment: 'acc', workload: 'load', organizationId: 'org-1', card: 'trends', dashboard: 'Old', panel: '7', metric: 'Old', foo: 'bar',
    }));
    const { link } = renderMenu();
    const href = link('Open in Graphs').getAttribute('href')!;
    expect(href).toMatch(/^\/test-runs\/WERKNL-00011\?card=graphs&/);
    expect(Object.fromEntries(new URL(href, 'http://x').searchParams)).toEqual({
      card: 'graphs', dashboard: series.dashboardLabel, panel: '101', metric: 'T',
      system: 'Shop', environment: 'acc', workload: 'load', organizationId: 'org-1',
    });
  });

  it('opens a new tab from the trailing icon without following the link here', () => {
    // Value: protects=the icon opens a new tab and cancels the row link and its hand-off; fails_when=preventDefault or stopPropagation is dropped; why_new=extends the icon test with the cancel; seam=none; no_claim=the browser honouring _blank
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const { openCardLink, onClose } = renderMenu();

    expect(fireEvent.click(screen.getByRole('button', { name: 'Open in Trends in a new tab' }))).toBe(false);
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\/test-runs\/WERKNL-00011\?card=trends&/), '_blank', 'noopener');
    expect(openCardLink).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it('keeps the icon out of the tab order and tells keyboard users the platform\'s new-tab key', () => {
    // Value: protects=no focusable control inside the row link, and the row announces the keyboard path with the right modifier; fails_when=the icon regains a tab stop, the description is unlinked, or the modifier is wrong for the platform; why_new=design review: Ctrl+Enter on a Mac is a same-tab follow; seam=none; no_claim=screen-reader output
    const platform = jest.spyOn(navigator, 'platform', 'get');
    platform.mockReturnValue('Win32');
    const first = renderMenu();
    expect(screen.getByRole('button', { name: 'Open in Graphs in a new tab' })).toHaveAttribute('tabindex', '-1');
    expect(first.link('Open in Graphs')).toHaveAccessibleDescription('Ctrl+Enter opens it in a new tab');
    document.body.innerHTML = '';

    platform.mockReturnValue('MacIntel');
    const second = renderMenu();
    expect(second.link('Open in Graphs')).toHaveAccessibleDescription('Cmd+Enter opens it in a new tab');
    platform.mockRestore();
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
