/*
 * Value: protects=the profile dashboard's grouping section lists, creates, refuses an occupied slot and deletes
 *   against the profile rules API; fails_when=a create sends the wrong panel or aggregations, the slot guard is
 *   lost (409 on a form that looked valid), a save failure closes the form, or delete skips the confirm;
 * why_new=ProfileSeriesGroupingSection had no test; seam=none;
 * no_claim=the API's acceptance of the body (lib/api/series-grouping and the Grafana lookup are mocked; jsdom)
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ProfileSeriesGroupingSection from '../ProfileSeriesGroupingSection';
import {
  createProfileRule,
  deleteProfileRule,
  listProfileRules,
  updateProfileRule,
  type ProfileSeriesGroupingRuleResponse,
} from '@/lib/api/series-grouping';
import { fetchGrafanaDashboardByUid } from '@/lib/grafana-dashboards';

jest.mock('@/lib/api/series-grouping', () => ({
  listProfileRules: jest.fn(),
  createProfileRule: jest.fn(),
  updateProfileRule: jest.fn(),
  deleteProfileRule: jest.fn(),
}));
jest.mock('@/lib/grafana-dashboards', () => ({
  fetchGrafanaDashboardByUid: jest.fn(),
}));

const mockList = listProfileRules as jest.MockedFunction<typeof listProfileRules>;
const mockCreate = createProfileRule as jest.MockedFunction<typeof createProfileRule>;
const mockUpdate = updateProfileRule as jest.MockedFunction<typeof updateProfileRule>;
const mockDelete = deleteProfileRule as jest.MockedFunction<typeof deleteProfileRule>;
const mockDashboard = fetchGrafanaDashboardByUid as jest.MockedFunction<typeof fetchGrafanaDashboardByUid>;

const rule = (over: Partial<ProfileSeriesGroupingRuleResponse> = {}): ProfileSeriesGroupingRuleResponse => ({
  id: 'pr-1',
  profileDashboardId: 'pd-1',
  panelId: 7,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregations: ['avg', 'count'],
  enabled: true,
  createdAt: '',
  updatedAt: '',
  ...over,
});

function renderSection() {
  return render(
    <ProfileSeriesGroupingSection
      profileId="p-1"
      profileDashboardId="pd-1"
      dashboardUid="k8s-pods"
      grafanaInstanceId="gi-1"
    />,
  );
}

describe('ProfileSeriesGroupingSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDashboard.mockResolvedValue({ panels: [{ id: 7, title: 'CPU per pod' }] } as never);
  });

  it('lists the rules with the panel titles of the instance-scoped template', async () => {
    mockList.mockResolvedValue([rule()]);
    renderSection();

    const row = await screen.findByTestId('profile-series-grouping-rule-row');
    expect(mockList).toHaveBeenCalledWith('p-1', 'pd-1');
    expect(mockDashboard).toHaveBeenCalledWith('k8s-pods', 'gi-1');
    await waitFor(() => expect(within(row).getByText('CPU per pod')).toBeInTheDocument());
    expect(within(row).getByText('Average per pod')).toBeInTheDocument();
  });

  it('creates a rule for all panels with the default series, then reloads', async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce([rule({ panelId: null })]);
    mockCreate.mockResolvedValue(rule({ panelId: null }));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText('No series grouping rules.');

    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith('p-1', 'pd-1', {
        preset: 'k8s-pod',
        aggregations: ['avg', 'count'],
        panelId: null,
      }),
    );
    expect(await screen.findByTestId('profile-series-grouping-rule-row')).toHaveTextContent('All panels');
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  // Value: protects=a new rule never opens on, or offers, a slot that already has a rule (the API answers 409);
  //   fails_when=the default ignores taken slots or taken panels stay selectable; why_new=replaces the old
  //   "opens refused" case after the form started defaulting to a free slot; seam=none; no_claim=MUI Select internals
  it('opens a new rule on a free panel and marks the taken ones', async () => {
    mockList.mockResolvedValue([rule({ panelId: null })]);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId('profile-series-grouping-rule-row');
    await waitFor(() => expect(mockDashboard).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Applies to' })).toHaveTextContent('CPU per pod');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();

    await user.click(within(dialog).getByRole('combobox', { name: 'Applies to' }));
    const allPanels = await screen.findByRole('option', { name: 'All panels (has a rule)' });
    expect(allPanels).toHaveAttribute('aria-disabled', 'true');
  });

  it('refuses the save when no free slot is left, before the API would answer 409', async () => {
    mockDashboard.mockResolvedValue({ panels: [] } as never);
    mockList.mockResolvedValue([rule({ panelId: null })]);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId('profile-series-grouping-rule-row');

    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/All panels already has a rule, and the panel list could not be loaded/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the form open with the server message when a save fails', async () => {
    mockList.mockResolvedValue([rule()]);
    mockUpdate.mockRejectedValue(new Error('A series grouping rule needs at least one aggregation'));
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId('profile-series-grouping-rule-row');

    await user.click(screen.getByRole('button', { name: 'Edit rule' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('A series grouping rule needs at least one aggregation')).toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledWith('p-1', 'pd-1', 'pr-1', { preset: 'k8s-pod', aggregations: ['avg', 'count'] });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Value: protects=the enable switch sends the inverse and shows the server's row; fails_when=the payload is not
  //   inverted or the row is not replaced; why_new=toggle untested; seam=none; no_claim=API acceptance (mocked)
  it('toggles a rule and shows the row the server answered with', async () => {
    mockList.mockResolvedValue([rule()]);
    mockUpdate.mockResolvedValue(rule({ enabled: false }));
    const user = userEvent.setup();
    renderSection();
    const row = await screen.findByTestId('profile-series-grouping-rule-row');

    await user.click(within(row).getByRole('switch'));

    expect(mockUpdate).toHaveBeenCalledWith('p-1', 'pd-1', 'pr-1', { enabled: false });
    await waitFor(() => expect(within(row).getByRole('switch')).not.toBeChecked());
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  // Value: protects=a failed template lookup still leaves a usable form offering All panels; fails_when=the
  //   rejection is unhandled or the form depends on the panel list; why_new=failure path untested; seam=none;
  //   no_claim=which error the lookup raises (mocked)
  it('still offers All panels when the template lookup fails', async () => {
    mockDashboard.mockRejectedValue(new Error('grafana down'));
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(rule({ panelId: null }));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText('No series grouping rules.');

    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'Applies to' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All panels']);
    await user.click(screen.getByRole('option', { name: 'All panels' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('p-1', 'pd-1', expect.objectContaining({ panelId: null })));
  });

  it('asks before deleting, then deletes and reloads', async () => {
    mockList.mockResolvedValueOnce([rule()]).mockResolvedValueOnce([]);
    mockDelete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();
    await screen.findByTestId('profile-series-grouping-rule-row');

    await user.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(mockDelete).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('p-1', 'pd-1', 'pr-1'));
    expect(await screen.findByText('No series grouping rules.')).toBeInTheDocument();
  });
});
