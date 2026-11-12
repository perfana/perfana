import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileFormDialog } from '../components/ProfileFormDialog';
import type { Profile } from '@/lib/profiles';

const profile = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'p-1',
    name: 'checkout',
    description: 'Checkout journey',
    tags: ['perfana', 'frontend', 'perfana-template'],
    readOnly: false,
    dashboardCount: 0,
    sloCount: 0,
    deepLinksCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Profile;

const addTag = (text: string) => {
  const input = screen.getByTestId('profile-tags-input');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('ProfileFormDialog — create', () => {
  it('submits the tags the user typed', () => {
    const onSubmit = jest.fn();
    render(
      <ProfileFormDialog open profile={null} saving={false} onClose={() => {}} onSubmit={onSubmit} />
    );

    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: ' billing ' } });
    addTag('frontend');
    addTag('api');
    fireEvent.click(screen.getByTestId('profile-form-submit'));

    // The name is trimmed here because create needs it so. The description comes back EXACTLY as
    // typed — the caller trims it for create and compares it against the stored value for an
    // edit, which it can only do if the dialog has not already rewritten it.
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'billing',
      description: '',
      tags: ['frontend', 'api'],
    });
  });

  it('cannot be submitted without a name', () => {
    const onSubmit = jest.fn();
    render(
      <ProfileFormDialog open profile={null} saving={false} onClose={() => {}} onSubmit={onSubmit} />
    );

    expect(screen.getByTestId('profile-form-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('profile-name-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('profile-form-submit')).toBeDisabled();
  });

  it('opens empty rather than carrying the last edited profile', () => {
    const { rerender } = render(
      <ProfileFormDialog
        open
        profile={profile()}
        saving={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId('profile-name-input')).toHaveValue('checkout');

    rerender(
      <ProfileFormDialog
        open={false}
        profile={null}
        saving={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );
    rerender(
      <ProfileFormDialog
        open
        profile={null}
        saving={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId('profile-name-input')).toHaveValue('');
  });
});

describe('ProfileFormDialog — edit', () => {
  it('shows the user tags and hides the system ones', () => {
    render(
      <ProfileFormDialog
        open
        profile={profile()}
        saving={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.queryByText('perfana')).not.toBeInTheDocument();
    expect(screen.queryByText('perfana-template')).not.toBeInTheDocument();
  });

  /**
   * The one that matters: `PUT /profiles/:id` replaces the array, so a submit built from the
   * visible chips alone would delete the two system tags the dialog never showed — and a
   * profile's tags decide which dashboards and SLOs it provisions.
   */
  it('keeps the hidden system tags when the user edits the visible ones', () => {
    const onSubmit = jest.fn();
    render(
      <ProfileFormDialog
        open
        profile={profile()}
        saving={false}
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    addTag('api');
    fireEvent.click(screen.getByTestId('profile-form-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'checkout',
      description: 'Checkout journey',
      tags: ['frontend', 'api', 'perfana', 'perfana-template'],
    });
  });

  it('keeps the system tags even when every visible tag is removed', () => {
    const onSubmit = jest.fn();
    render(
      <ProfileFormDialog
        open
        profile={profile({ tags: ['perfana', 'frontend'] })}
        saving={false}
        onClose={() => {}}
        onSubmit={onSubmit}
      />
    );

    // Backspace in the empty input, which is how a user clears the last chip. Reaching for MUI's
    // internal `CancelIcon` testid couples this to a name MUI owns and can rename.
    fireEvent.keyDown(screen.getByTestId('profile-tags-input'), { key: 'Backspace' });
    fireEvent.click(screen.getByTestId('profile-form-submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['perfana'] })
    );
  });

  it('titles itself for the profile and labels the button Save', () => {
    render(
      <ProfileFormDialog
        open
        profile={profile()}
        saving={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByText('Edit checkout')).toBeInTheDocument();
    expect(screen.getByTestId('profile-form-submit')).toHaveTextContent('Save');
  });
});

describe('ProfileFormDialog — in-flight and suggestions', () => {
  /**
   * The only double-submit guard on this dialog. `createProfile` is not idempotent, so a second
   * click during an in-flight create attempts a duplicate name.
   */
  it('refuses a second submit while a save is in flight, in both modes', () => {
    const onSubmit = jest.fn();
    const { unmount } = render(
      <ProfileFormDialog open profile={profile()} saving onClose={() => {}} onSubmit={onSubmit} />
    );

    const submit = screen.getByTestId('profile-form-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('Saving...');
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
    // Cancel is disabled too, so all the ways out of the dialog agree with each other.
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    unmount();

    render(
      <ProfileFormDialog open profile={null} saving onClose={() => {}} onSubmit={onSubmit} />
    );
    const create = screen.getByTestId('profile-form-submit');
    expect(create).toBeDisabled();
    expect(create).toHaveTextContent('Creating...');
  });

  /**
   * The suggestion list is fed `profiles.flatMap(p => p.tags)`, which on a real install carries
   * `perfana` from every profile in the organization. The `visibleProfileTags` call inside the
   * options memo is the only thing keeping the hidden tags out of the dropdown.
   */
  it('offers each non-system suggestion once, sorted', () => {
    render(
      <ProfileFormDialog
        open
        profile={null}
        tagSuggestions={['perfana', 'web', 'api', 'web', 'perfana-template', 'no-anomaly-detection']}
        saving={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    );

    fireEvent.focus(screen.getByTestId('profile-tags-input'));
    fireEvent.keyDown(screen.getByTestId('profile-tags-input'), { key: 'ArrowDown' });

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['api', 'web']);
  });
});
