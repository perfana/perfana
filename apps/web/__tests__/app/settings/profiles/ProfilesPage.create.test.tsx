/**
 * The Profiles page creates a profile in the organization it is listing. The API's own pick, for a
 * caller who names none, is the first organization (by id) where they are an org-admin, which for a
 * user in several need not be the one on screen: the new profile would vanish from this list, and its
 * ADAPT templates would reach another organization's runs.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const mockCreateProfile = jest.fn();
const mockFetchProfiles = jest.fn();
let mockCurrentOrganizationId: string | null = null;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/profiles', () => ({
  fetchProfiles: (...args: unknown[]) => mockFetchProfiles(...args),
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
}));

jest.mock('@/lib/compare-templates', () => ({
  fetchCompareTemplates: jest.fn().mockResolvedValue({ templates: [] }),
  templatesPageHref: () => '/settings/profiles/adapt-templates',
}));

jest.mock('@/lib/contexts/organization-context', () => ({
  useOrganizationContext: () => ({
    currentOrganizationId: mockCurrentOrganizationId,
    currentOrganization: mockCurrentOrganizationId ? { id: mockCurrentOrganizationId, name: 'Org B' } : null,
    organizations: [],
    isLoading: false,
  }),
}));

import ProfilesPage from '@/app/settings/profiles/page';

async function createThroughDialog(name: string) {
  const user = userEvent.setup();
  render(<ProfilesPage />);
  await user.click(await screen.findByRole('button', { name: /add profile/i }));
  await user.type(screen.getByLabelText(/profile name/i), name);
  await user.click(screen.getByRole('button', { name: /^create$/i }));
  await waitFor(() => expect(mockCreateProfile).toHaveBeenCalledTimes(1));
}

describe('ProfilesPage create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchProfiles.mockResolvedValue([]);
    mockCreateProfile.mockResolvedValue({ id: 'new' });
  });

  it('creates the profile in the organization the page is showing', async () => {
    mockCurrentOrganizationId = 'org-b-uuid';

    await createThroughDialog('jvm');

    expect(mockFetchProfiles).toHaveBeenCalledWith('org-b-uuid');
    expect(mockCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'jvm', organizationId: 'org-b-uuid' }),
    );
  });

  it('names no organization when none is selected, leaving the pick to the API', async () => {
    mockCurrentOrganizationId = null;

    await createThroughDialog('jvm');

    expect(mockCreateProfile.mock.calls[0]![0]).toEqual({ name: 'jvm', description: undefined, organizationId: undefined });
  });
});
