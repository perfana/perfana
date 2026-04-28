import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequiresPermission } from './RequiresPermission';

jest.mock('@/hooks/usePermissions', () => ({
  usePermissions: jest.fn(),
}));
const { usePermissions } = require('@/hooks/usePermissions');

describe('RequiresPermission', () => {
  beforeEach(() => {
    usePermissions.mockReset();
  });

  it('renders children unmodified when can() returns true', () => {
    usePermissions.mockReturnValue({ can: () => true, isLoaded: true });

    render(
      <RequiresPermission action="integration:dynatrace:update" orgId="org-a">
        <button onClick={jest.fn()}>Configure</button>
      </RequiresPermission>,
    );

    const btn = screen.getByRole('button', { name: /configure/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('renders children inside a disabled wrapper when can() returns false', () => {
    usePermissions.mockReturnValue({ can: () => false, isLoaded: true });

    render(
      <RequiresPermission action="integration:dynatrace:update" orgId="org-a">
        <button>Configure</button>
      </RequiresPermission>,
    );

    const btn = screen.getByRole('button', { name: /configure/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('hovering a disabled child surfaces a tooltip with the configured disabledReason', async () => {
    usePermissions.mockReturnValue({ can: () => false, isLoaded: true });

    render(
      <RequiresPermission
        action="integration:dynatrace:update"
        orgId="org-a"
        disabledReason="Org admin only"
      >
        <button>Configure</button>
      </RequiresPermission>,
    );

    const btn = screen.getByRole('button', { name: /configure/i });
    // MUI Tooltip attaches to the wrapper span; fire mouseEnter on it
    const wrapper = btn.closest('span')!;
    fireEvent.mouseEnter(wrapper);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Org admin only');
  });

  it('uses default tooltip text "Org admin only" when disabledReason is omitted', async () => {
    usePermissions.mockReturnValue({ can: () => false, isLoaded: true });

    render(
      <RequiresPermission action="integration:dynatrace:update" orgId="org-a">
        <button>Configure</button>
      </RequiresPermission>,
    );

    const btn = screen.getByRole('button', { name: /configure/i });
    const wrapper = btn.closest('span')!;
    fireEvent.mouseEnter(wrapper);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Org admin only');
    });
  });

  it('reads resourcePermissions when provided, ignoring capabilities when action is in the map', () => {
    // Mirror the real usePermissions.can precedence rule:
    // if ctx.resourcePermissions has the action key, use that value; otherwise fall through.
    const canMock = jest.fn().mockImplementation(
      (action: string, ctx?: { organizationId?: string; resourcePermissions?: Record<string, boolean> }) => {
        if (ctx?.resourcePermissions && action in ctx.resourcePermissions) {
          return ctx.resourcePermissions[action] === true;
        }
        return false; // no capability in byOrg
      },
    );
    usePermissions.mockReturnValue({ can: canMock, isLoaded: true });

    render(
      <RequiresPermission
        action="integration:dynatrace:update"
        orgId="org-a"
        resourcePermissions={{ 'integration:dynatrace:update': true }}
      >
        <button>Configure</button>
      </RequiresPermission>,
    );

    // resourcePermissions grants the action → child rendered unmodified (not disabled)
    expect(screen.getByRole('button', { name: /configure/i })).not.toBeDisabled();

    // Verify can() was called with the resourcePermissions context (component passed it through)
    expect(canMock).toHaveBeenCalledWith('integration:dynatrace:update', {
      organizationId: 'org-a',
      resourcePermissions: { 'integration:dynatrace:update': true },
    });
  });

  it('falls back to can() when action is absent from resourcePermissions', () => {
    // can() returns false; resourcePermissions has a different key — so can() is consulted
    const canMock = jest.fn().mockReturnValue(false);
    usePermissions.mockReturnValue({ can: canMock, isLoaded: true });

    render(
      <RequiresPermission
        action="integration:dynatrace:update"
        orgId="org-a"
        resourcePermissions={{ delete: true }}  // update is NOT in this map
      >
        <button>Configure</button>
      </RequiresPermission>,
    );

    // can() returned false and update wasn't in resourcePermissions → disabled
    expect(screen.getByRole('button', { name: /configure/i })).toBeDisabled();
    expect(canMock).toHaveBeenCalledWith('integration:dynatrace:update', {
      organizationId: 'org-a',
      resourcePermissions: { delete: true },
    });
  });

  it('disabled child does not invoke onClick when clicked', async () => {
    const user = userEvent.setup();
    usePermissions.mockReturnValue({ can: () => false, isLoaded: true });
    const handleClick = jest.fn();

    render(
      <RequiresPermission action="integration:dynatrace:update" orgId="org-a">
        <button onClick={handleClick}>Configure</button>
      </RequiresPermission>,
    );

    // userEvent.click on a disabled button is silently ignored by the browser —
    // but our interceptor also blocks any programmatic path.
    await user.click(screen.getByRole('button', { name: /configure/i }));
    expect(handleClick).not.toHaveBeenCalled();
  });
});
