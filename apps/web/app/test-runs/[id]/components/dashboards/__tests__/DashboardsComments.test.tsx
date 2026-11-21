// Value: protects=item-level comments on the Dashboards card (design:
// test-run-analysis-stories.md, PR1): every tile carries an always-visible comment control keyed on
// the application dashboard id (never the Grafana uid, so one uid on two instances is two items),
// labelled by dashboard_label falling back to dashboard_name; the comment filter shows that tile
// alone past the search text and tags, says when the dashboard is gone once the list has loaded,
// and "Show all" restores the user's own filters untouched; fails_when=the key moves to
// dashboard_uid, the filter writes the search or tags, or a missing dashboard is announced before
// the list answers; why_new=new card behaviour; seam=the comments context and the card's data hook
// are mocked at their modules; no_claim=the drawer (comments.test.tsx).
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Dashboard } from '../types';

const ctx: Record<string, unknown> = {};
let onFocus: ((itemKey: string) => boolean) | undefined;
jest.mock('../../comments/CommentsContext', () => ({
  useComments: () => ctx,
  useCommentItemCounts: () => ({ 'dashboard:ad-1': { threads: 1, unread: 0 } }),
  useCommentItemFocus: (_card: string, fn: (itemKey: string) => boolean) => {
    onFocus = fn;
  },
}));
jest.mock('@/contexts/theme-context', () => ({ useThemeMode: () => ({ mode: 'light' }) }));

let dashboardsData: Record<string, unknown> = {};
jest.mock('../hooks', () => ({ useDashboardsData: () => dashboardsData }));

import DashboardsSection from '../DashboardsSection';
import { dashboardCommentAnchor } from '../components/DashboardCard';

const dash = (id: string, label: string, over: Partial<Dashboard> = {}): Dashboard => ({
  id,
  dashboard_label: label,
  dashboard_name: `${label} name`,
  dashboard_uid: 'jvm-uid',
  dashboard_id: 1,
  grafana_instance: { client_url: 'http://grafana' },
  tags: [],
  ...over,
});

// The same Grafana uid on two instances: two application dashboards, two items.
const dashboards = [dash('ad-1', 'JVM (prod)'), dash('ad-2', 'JVM (dev)'), dash('ad-3', 'Database', { dashboard_uid: 'db' })];

function data(over: Record<string, unknown> = {}) {
  return {
    dashboards,
    filteredDashboards: [dashboards[2]],
    allDashboardTags: [],
    dashboardsLoading: false,
    dashboardsLoaded: true,
    selectedDashboardTags: [],
    dashboardSearchText: 'Data',
    expandedDashboard: null,
    setSelectedDashboardTags: jest.fn(),
    setDashboardSearchText: jest.fn(),
    toggleTagSelection: jest.fn(),
    handleOpenDashboard: jest.fn(),
    handleCloseDashboard: jest.fn(),
    handleDashboardsExpand: jest.fn(),
    buildGrafanaIframeUrl: jest.fn(() => ''),
    ...over,
  };
}

beforeEach(() => {
  onFocus = undefined;
  dashboardsData = data();
  for (const k of Object.keys(ctx)) delete ctx[k];
  Object.assign(ctx, { commentOnItem: jest.fn() });
});

const card = () => (
  <DashboardsSection testRun={{ id: 'r' } as never} testRunId="run" dashboardsExpanded onDashboardsExpand={jest.fn()} showToast={jest.fn()} />
);
const tiles = () => Array.from(document.querySelectorAll('[data-comment-item]')).map((el) => el.getAttribute('data-comment-item'));
const focus = (itemKey: string) => act(() => void onFocus!(itemKey));

describe('Dashboards card comments', () => {
  it('keys each tile on its application dashboard id, so one Grafana uid on two instances is two items', () => {
    dashboardsData = data({ filteredDashboards: dashboards, dashboardSearchText: '' });
    render(card());
    expect(tiles()).toEqual(['dashboard:ad-1', 'dashboard:ad-2', 'dashboard:ad-3']);
    const button = screen.getByTestId('row-comment-dashboard:ad-1');
    expect(button).toHaveAccessibleName('1 comment thread on JVM (prod)');
    fireEvent.click(screen.getByTestId('row-comment-dashboard:ad-2'));
    expect(ctx.commentOnItem).toHaveBeenCalledWith('dashboards', 'dashboard:ad-2', 'JVM (dev)');
  });

  it('labels a dashboard without a label by its name', () => {
    expect(dashboardCommentAnchor(dash('ad-9', '', { dashboard_name: 'Kafka' }))).toEqual({ itemKey: 'dashboard:ad-9', itemLabel: 'Kafka' });
  });

  it('shows the comment’s dashboard past the search text, and Show all restores the search untouched', () => {
    render(card());
    expect(tiles()).toEqual(['dashboard:ad-3']);
    let found: boolean | undefined;
    act(() => void (found = onFocus!('dashboard:ad-2')));
    expect(found).toBe(true);
    expect(tiles()).toEqual(['dashboard:ad-2']);
    expect(screen.getByTestId('comment-filter-chip')).toHaveTextContent('Showing the item from a comment: JVM (dev)');
    expect(screen.getByPlaceholderText('Search dashboards by label...')).toHaveValue('Data');
    fireEvent.click(within(screen.getByTestId('comment-filter-chip')).getByRole('button', { name: 'Show all' }));
    expect(tiles()).toEqual(['dashboard:ad-3']);
    const d = dashboardsData as Record<string, jest.Mock>;
    expect(d.setDashboardSearchText).not.toHaveBeenCalled();
    expect(d.setSelectedDashboardTags).not.toHaveBeenCalled();
    expect(d.toggleTagSelection).not.toHaveBeenCalled();
  });

  it('says a removed dashboard is no longer configured, once the list has loaded', () => {
    dashboardsData = data({ dashboardsLoaded: false, dashboards: [], filteredDashboards: [] });
    const { rerender } = render(card());
    focus('dashboard:gone');
    expect(screen.getByTestId('comment-filter-chip')).not.toHaveTextContent('no longer configured');
    dashboardsData = data();
    rerender(card());
    expect(screen.getByTestId('comment-filter-chip')).toHaveTextContent('This dashboard is no longer configured for this workload');
    expect(tiles()).toEqual([]);
  });
});
