import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MetricConfigForm, { MetricConfigData } from '@/app/test-runs/[id]/components/configuration-comparison/MetricConfigForm';
import { createCompareTemplate } from '@/lib/compare-templates';
import { fetchProfiles } from '@/lib/profiles';

jest.mock('@/lib/compare-templates', () => ({ createCompareTemplate: jest.fn() }));
jest.mock('@/lib/profiles', () => ({ fetchProfiles: jest.fn() }));
jest.mock('@/lib/contexts/organization-context', () => ({
  useOrganizationContext: () => ({ organizations: [{ id: 'org-a', name: 'Acme' }], isAdmin: false }),
}));

const configData: MetricConfigData = {
  rowKey: 'row-1',
  systemUnderTestId: 'sut',
  testEnvironment: 'acc',
  workload: 'load',
  applicationDashboardId: 'ad-1',
  panelId: '7',
  panelTitle: 'Heap used',
  metricName: 'heap used',
  dashboardLabel: 'JVM',
  dashboardUid: 'jvm-overview',
  organizationId: 'org-a',
  runTags: ['jvm'],
  currentConfig: {
    ignore: false,
    metricClassification: { classification: 'USE_saturation', higherIsBetter: false },
    thresholds: { aggregation: 'q95', percentageThreshold: 15, iqrThreshold: 2, absoluteThreshold: null },
    configSource: 'panel',
  },
};

describe('MetricConfigForm — Save as template', () => {
  beforeEach(() => {
    jest.mocked(fetchProfiles).mockResolvedValue([
      { id: 'p1', name: 'jvm', tags: ['jvm'], dashboardCount: 0, sloCount: 0, deepLinksCount: 0, createdAt: '', updatedAt: '' },
    ]);
    jest.mocked(createCompareTemplate).mockResolvedValue({} as never);
  });

  it('is absent without onTemplateSaved', () => {
    render(<MetricConfigForm configData={configData} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /save as template/i })).not.toBeInTheDocument();
  });

  it('creates the template in the matching profile and leaves the row unsaved', async () => {
    const onSave = jest.fn();
    const onTemplateSaved = jest.fn();
    render(<MetricConfigForm configData={configData} onSave={onSave} onCancel={jest.fn()} onTemplateSaved={onTemplateSaved} />);

    fireEvent.click(screen.getByRole('button', { name: /save as template/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(fetchProfiles).toHaveBeenCalledWith('org-a'));
    // The matching profile is the default target.
    await waitFor(() => expect(within(dialog).getByText('Profile jvm')).toBeInTheDocument());

    fireEvent.click(within(dialog).getByRole('button', { name: /save template/i }));

    await waitFor(() => expect(createCompareTemplate).toHaveBeenCalledTimes(1));
    expect(createCompareTemplate).toHaveBeenCalledWith(
      { kind: 'profile', profileId: 'p1' },
      expect.objectContaining({ dashboardUid: 'jvm-overview', panelId: 7, percentageThreshold: 0.15 }),
    );
    expect(jest.mocked(createCompareTemplate).mock.calls[0][1]).not.toHaveProperty('metricName');
    await waitFor(() => expect(onTemplateSaved).toHaveBeenCalledWith(expect.stringContaining('Profile jvm')));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server refusal in the dialog', async () => {
    jest.mocked(createCompareTemplate).mockRejectedValue(new Error('A template with this key already exists'));
    render(<MetricConfigForm configData={configData} onSave={jest.fn()} onCancel={jest.fn()} onTemplateSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save as template/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Profile jvm')).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /save template/i }));
    expect(await within(dialog).findByText('A template with this key already exists')).toBeInTheDocument();
  });
});
