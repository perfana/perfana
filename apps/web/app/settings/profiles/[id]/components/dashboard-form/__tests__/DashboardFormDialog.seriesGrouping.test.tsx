/*
 * Value: protects=the grouping section appears only for a saved profile dashboard, scoped to its own Grafana
 *   instance (resolved from grafanaLabel); fails_when=it renders in create mode (no dashboard id to save against),
 *   without profileId, or with another instance's id (uid ambiguity, root CLAUDE.md #43);
 * why_new=the dialog's gating was untested; seam=none;
 * no_claim=the section's own behaviour (mocked here, covered by ProfileSeriesGroupingSection.test.tsx)
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardFormDialog from '../DashboardFormDialog';

jest.mock('@/components/series-grouping/ProfileSeriesGroupingSection', () => ({
  __esModule: true,
  default: (props: { profileId: string; profileDashboardId: string; dashboardUid: string; grafanaInstanceId?: string }) => (
    <div data-testid="grouping-section">
      {`${props.profileId}|${props.profileDashboardId}|${props.dashboardUid}|${String(props.grafanaInstanceId)}`}
    </div>
  ),
}));

const instances = [
  { id: 'gi-dev', label: 'Dev' },
  { id: 'gi-prod', label: 'Prod' },
] as never[];

const dashboard = {
  id: 'pd-1',
  profile: 'k8s',
  dashboardName: 'Pods',
  dashboardUid: 'k8s-pods',
  grafanaLabel: 'Prod',
  readOnly: false,
} as never;

function renderDialog(props: Partial<React.ComponentProps<typeof DashboardFormDialog>>) {
  return render(
    <DashboardFormDialog
      open
      mode="edit"
      availableDashboards={[]}
      availableInstances={instances}
      loading={false}
      onClose={jest.fn()}
      onSubmit={jest.fn()}
      {...props}
    />,
  );
}

describe('DashboardFormDialog — series grouping section', () => {
  it('renders in edit mode for a saved dashboard, with the instance its grafanaLabel names', () => {
    renderDialog({ profileId: 'p-1', dashboard });
    expect(screen.getByTestId('grouping-section')).toHaveTextContent('p-1|pd-1|k8s-pods|gi-prod');
  });

  it('is absent when creating, or without a profile id', () => {
    const { unmount } = renderDialog({ mode: 'create', profileId: 'p-1' });
    expect(screen.queryByTestId('grouping-section')).not.toBeInTheDocument();
    unmount();
    renderDialog({ dashboard });
    expect(screen.queryByTestId('grouping-section')).not.toBeInTheDocument();
  });
});
