/**
 * The Profiles page's edit action, from the row to the API call.
 *
 * `PUT /profiles/:id` REPLACES the tags array and the page hides Perfana's own three tags, so the
 * page is the last place the merge can be lost: the dialog's own tests prove it hands the merged
 * array to `onSubmit`, and these prove the page forwards that array to `updateProfile` rather than
 * rebuilding it. The edit button also sits inside a row that navigates, and a failed save is the
 * only thing standing between the user and a silently discarded edit.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { Profile } from '@/lib/profiles';

const mockCreateProfile = jest.fn();
const mockUpdateProfile = jest.fn();
const mockFetchProfiles = jest.fn();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/lib/profiles', () => ({
  fetchProfiles: (...args: unknown[]) => mockFetchProfiles(...args),
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

jest.mock('@/lib/compare-templates', () => ({
  fetchCompareTemplates: jest.fn().mockResolvedValue({ templates: [] }),
  templatesPageHref: () => '/settings/profiles/adapt-templates',
}));

jest.mock('@/lib/contexts/organization-context', () => ({
  useOrganizationContext: () => ({
    currentOrganizationId: 'org-b-uuid',
    currentOrganization: { id: 'org-b-uuid', name: 'Org B' },
    organizations: [],
    isLoading: false,
  }),
}));

import ProfilesPage from '@/app/settings/profiles/page';

const profile = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'p-1',
    name: 'checkout',
    description: 'Checkout journey',
    tags: ['perfana', 'frontend'],
    readOnly: false,
    dashboardCount: 0,
    sloCount: 0,
    deepLinksCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Profile;

const provisioned = profile({
  id: 'p-2',
  name: 'jvm',
  tags: ['perfana', 'perfana-template'],
  readOnly: true,
});

async function openEditDialog(user: ReturnType<typeof userEvent.setup>, id = 'p-1') {
  render(<ProfilesPage />);
  await user.click(await screen.findByTestId(`edit-profile-${id}`));
  return screen.findByTestId('profile-form-submit');
}

beforeEach(() => {
  jest.clearAllMocks();
  // The provisioned profile goes FIRST on purpose: the profile these tests edit must not also be
  // profiles[0], or this repo's recurring first-row-selection bug would pass every assertion
  // below (see "The first-row class" in apps/api/CLAUDE.md).
  mockFetchProfiles.mockResolvedValue([provisioned, profile()]);
  mockUpdateProfile.mockResolvedValue({ id: 'p-1' });
  mockCreateProfile.mockResolvedValue({ id: 'new' });
});

describe('ProfilesPage edit', () => {
  /**
   * Value: protects=the page forwards the dialog's merged tag array to updateProfile, hidden system tags included; fails_when=handleSubmitProfile rebuilds tags from the visible chips or drops the key; why_new=dialog tests stop at its own onSubmit spy, no test calls updateProfile at all; seam=none; no_claim=does not assert the API persists them
   */
  it('sends the edited tags plus the hidden system tag, and reloads the list', async () => {
    const user = userEvent.setup();
    const submit = await openEditDialog(user);

    // Opened from the row, prefilled from that profile, with only the user-facing tag shown.
    expect(screen.getByText('Edit checkout')).toBeInTheDocument();
    expect(screen.getByTestId('profile-name-input')).toHaveValue('checkout');

    await user.type(screen.getByTestId('profile-tags-input'), 'api{Enter}');
    await user.click(submit);

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    // No `name` and no `description`: neither was touched, and an edit must never send the name.
    expect(mockUpdateProfile).toHaveBeenCalledWith('p-1', {
      tags: ['frontend', 'api', 'perfana'],
    });
    expect(mockCreateProfile).not.toHaveBeenCalled();
    // The list is re-read, so the row shows what was saved.
    await waitFor(() => expect(mockFetchProfiles).toHaveBeenCalledTimes(2));
  });

  /**
   * Value: protects=a rejected save states why INSIDE the dialog and leaves the edit intact; fails_when=the error renders on the page behind the modal, where aria-hidden and the backdrop put it out of reach; why_new=no test drives a failing updateProfile from the page; seam=none; no_claim=does not measure pixel occlusion, only reachability
   */
  it('tells the user inside the dialog why the save failed', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('Profile is read-only'));
    const user = userEvent.setup();
    const submit = await openEditDialog(user);

    await user.type(screen.getByTestId('profile-tags-input'), 'api{Enter}');
    await user.click(submit);

    // `within(dialog).findByRole` is the whole point: MUI puts the page under aria-hidden while
    // the dialog is open, so a role query scoped to the dialog CANNOT be satisfied by a page-level
    // Alert. A plain findByText can, and did — which is how an invisible error passed as covered.
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Profile is read-only');

    // Still open, still holding the edit, and submittable again rather than stuck on "Saving...".
    expect(screen.getByTestId('profile-name-input')).toHaveValue('checkout');
    await waitFor(() => expect(screen.getByTestId('profile-form-submit')).toBeEnabled());
    expect(mockFetchProfiles).toHaveBeenCalledTimes(1);
  });

  /**
   * Value: protects=emptying the description field actually clears it on the API; fails_when=the edit branch sends values.description, which JSON.stringify drops so the API's !== undefined guard keeps the old text; why_new=every other edit test leaves the description untouched; seam=none; no_claim=does not assert the API persists the empty string
   */
  it('clears the description when the user empties the field', async () => {
    const user = userEvent.setup();
    const submit = await openEditDialog(user);

    await user.clear(screen.getByTestId('profile-description-input'));
    await user.click(submit);

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    // Asserted through a JSON round trip, because an `undefined` value never reaches the API and
    // would otherwise satisfy a plain toEqual against `description: ''`.
    const body = JSON.parse(JSON.stringify(mockUpdateProfile.mock.calls[0]![1]));
    expect(body).toEqual({ description: '', tags: ['frontend', 'perfana'] });
  });

  /**
   * Value: protects=an edit never sends a name, so it cannot rename a profile whose stored name has padding; fails_when=the edit branch forwards values.name, which the dialog trims, so " jmeter " is saved as "jmeter" and the profile's dashboards and deep links are orphaned; why_new=the read-only field looks like the whole guard and is not — the trim defeats it; seam=none; no_claim=does not prove the API would refuse such a rename, which it accepts
   */
  it('sends no name even when the stored one has padding the dialog would trim away', async () => {
    mockFetchProfiles.mockResolvedValue([provisioned, profile({ name: ' jmeter ' })]);
    const user = userEvent.setup();
    render(<ProfilesPage />);
    await user.click(await screen.findByTestId('edit-profile-p-1'));
    await user.click(await screen.findByTestId('profile-form-submit'));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const body = mockUpdateProfile.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('name');
    // And Save is reachable at all, which a whitespace-only name would otherwise prevent while
    // the only field that could fix it is read-only.
    expect(mockUpdateProfile).toHaveBeenCalledWith('p-1', { tags: ['frontend', 'perfana'] });
  });

  /**
   * Value: protects=a whitespace-only description is never stored, so the list keeps its "-" placeholder; fails_when=the edit branch compares or sends the raw field instead of the trimmed one; why_new=no test types whitespace into a description; seam=none; no_claim=does not cover a description that is whitespace in the stored row already
   */
  it('does not store whitespace when the user types only spaces into an empty description', async () => {
    mockFetchProfiles.mockResolvedValue([provisioned, profile({ description: undefined })]);
    const user = userEvent.setup();
    render(<ProfilesPage />);
    await user.click(await screen.findByTestId('edit-profile-p-1'));
    await user.type(await screen.findByTestId('profile-description-input'), '   ');
    await user.click(screen.getByTestId('profile-form-submit'));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    // Nothing changed once trimmed, so the key is omitted and the column stays NULL. Sending
    // '   ' would render a blank cell instead of "-" and could not be cleared afterwards.
    expect(mockUpdateProfile.mock.calls[0]![1]).not.toHaveProperty('description');
  });

  it('keeps Save usable for a profile whose stored name is only whitespace', async () => {
    mockFetchProfiles.mockResolvedValue([provisioned, profile({ name: '   ' })]);
    const user = userEvent.setup();
    render(<ProfilesPage />);
    await user.click(await screen.findByTestId('edit-profile-p-1'));

    expect(await screen.findByTestId('profile-form-submit')).toBeEnabled();
  });

  /**
   * Value: protects=the dialog offers no rename, because two tables reference a profile by name with no foreign key; fails_when=the disabled guard on the name field is dropped, so a rename orphans the profile's dashboards and deep links; why_new=the name field was read-only nowhere before this dialog existed; seam=none; no_claim=does not prove the API refuses a rename, which it still accepts
   */
  it('does not offer a rename, and says why', async () => {
    const user = userEvent.setup();
    await openEditDialog(user);

    expect(screen.getByTestId('profile-name-input')).toBeDisabled();
    expect(
      screen.getByText(/cannot be renamed: its dashboards and deep links reference it by name/i)
    ).toBeInTheDocument();
  });

  /**
   * Value: protects=the edit button opens the dialog instead of following the row's navigation; fails_when=the stopPropagation on the IconButton onClick is dropped; why_new=nothing exercises the action cell, and the row handler is older than it; seam=none; no_claim=does not cover keyboard activation
   */
  it('does not navigate when the edit button is clicked, though the row still does', async () => {
    const user = userEvent.setup();
    await openEditDialog(user);

    expect(mockPush).not.toHaveBeenCalled();

    // The row itself is still a link to the profile, which is why the button needs the guard.
    await user.keyboard('{Escape}');
    await user.click(screen.getByText('checkout'));
    expect(mockPush).toHaveBeenCalledWith('/settings/profiles/p-1');
  });

  /**
   * Value: protects=a provisioned profile offers no edit, so the UI never posts an edit the API answers 400 to; fails_when=the readOnly guard on the IconButton disabled prop is lost; why_new=readOnly only ever appears as the Provisioned chip in existing tests; seam=none; no_claim=does not assert the tooltip wording
   */
  it('disables the edit button for a provisioned profile', async () => {
    render(<ProfilesPage />);
    const button = await screen.findByTestId('edit-profile-p-2');

    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(screen.queryByTestId('profile-form-submit')).not.toBeInTheDocument();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
});
