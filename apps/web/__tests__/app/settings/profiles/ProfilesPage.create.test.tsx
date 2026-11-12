/**
 * The Profiles page creates a profile in the organization it is listing. The API's own pick, for a
 * caller who names none, is the first organization (by id) where they are an org-admin, which for a
 * user in several need not be the one on screen: the new profile would vanish from this list, and its
 * ADAPT templates would reach another organization's runs.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    // Explicit, so a test that forgets to set it cannot inherit the previous test's organization
    // and become order-dependent.
    mockCurrentOrganizationId = null;
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

  /**
   * Value: protects=a created profile carries the tags typed in the dialog, and no tags key at all when none were; fails_when=the create branch drops values.tags or sends [] for an untagged profile; why_new=the two tests above assert the organization only, and toEqual cannot see an absent key; seam=none; no_claim=does not cover system tags, which create cannot carry
   */
  it('sends the tags typed in the dialog', async () => {
    mockCurrentOrganizationId = 'org-b-uuid';
    const user = userEvent.setup();
    render(<ProfilesPage />);
    await user.click(await screen.findByRole('button', { name: /add profile/i }));
    await user.type(screen.getByLabelText(/profile name/i), 'jvm');
    await user.type(screen.getByTestId('profile-tags-input'), 'frontend{Enter}api{Enter}');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(mockCreateProfile).toHaveBeenCalledTimes(1));

    expect(mockCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['frontend', 'api'] }),
    );
  });

  it('omits the tags key entirely when the user typed none', async () => {
    // An untagged profile stores NULL rather than an empty array, the shape every profile
    // created before this field had, so the key must be absent and not `[]`.
    await createThroughDialog('legacy');

    expect(mockCreateProfile.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ name: 'legacy', tags: undefined }),
    );
  });

  /**
   * The create half of the shared failure branch: the wording ternary and the non-Error fallback
   * arm. A duplicate profile name is a 400, so this is the rejection a user actually meets.
   */
  it('keeps the dialog and shows the create wording when the create fails', async () => {
    mockCurrentOrganizationId = 'org-b-uuid';
    mockCreateProfile.mockRejectedValue('boom'); // non-Error: exercises the fallback arm
    const user = userEvent.setup();
    render(<ProfilesPage />);
    await user.click(await screen.findByRole('button', { name: /add profile/i }));
    await user.type(screen.getByLabelText(/profile name/i), 'jvm');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Failed to create profile');
    expect(screen.queryByText('Failed to update profile')).not.toBeInTheDocument();
    // The typed name survives, so the user can fix the cause and retry rather than retyping.
    expect(screen.getByLabelText(/profile name/i)).toHaveValue('jvm');
    expect(mockFetchProfiles).toHaveBeenCalledTimes(1);
  });
});
