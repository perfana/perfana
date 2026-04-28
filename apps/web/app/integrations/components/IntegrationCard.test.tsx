/**
 * IntegrationCard RBAC integration tests — FE.3
 *
 * Regression: org-member navigated to /integrations, saw an enabled "Configure"
 * button on the Dynatrace card, clicked it, the form opened, submitted, and the
 * API returned 403 with no prior UX signal.
 *
 * Fix: Configure and Delete buttons are wrapped in <RequiresPermission> so that
 * non-admins see disabled buttons with an "Org admin only" tooltip.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegrationCardComponent } from './IntegrationCard';
import { Speed } from '@mui/icons-material';

// Mock auth hook — we control can() per test.
jest.mock('@/hooks/usePermissions', () => ({
  usePermissions: jest.fn(),
}));

// Mock org context — always return a stable org ID.
jest.mock('@/lib/contexts/organization-context', () => ({
  useOrganizationContext: () => ({ currentOrganizationId: 'demo-org-id' }),
}));

const { usePermissions } = require('@/hooks/usePermissions');

// Minimal wrapper providing React Query context.
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

// Minimal handlers — filled so TypeScript prop shape is satisfied.
const minimalHandlers = {
  onToggleExpand: jest.fn(),
  onSettings: jest.fn(),
  onDelete: jest.fn(),
  onConnect: jest.fn(),
  onSnackbar: jest.fn(),
};

// A connected Dynatrace card that will reach the Configure/Delete branch.
// Note: the component also renders a header IconButton with aria-label
// "Configure <name>" for quick-access. We target the CardActions MUI Button
// by its visible text content — `getAllByRole` + filtering by text node.
const dynatraceCard = {
  id: 'dynatrace-abc123',
  integrationType: 'dynatrace' as const,
  name: 'Prod Dynatrace',
  tldr: 'prod.saas.dynatrace.com • SAAS • Basic Configuration',
  category: 'APM',
  status: 'connected' as const,
  icon: <Speed />,
  color: '#1496FF',
  // No _permissions field — mimics current API response (Phase 3b not yet shipped
  // for Dynatrace, so resourcePermissions falls through to capability check).
  instanceData: {
    id: 'abc123',
    host: 'https://prod.saas.dynatrace.com',
    apiToken: 'token',
    dynatraceType: 'saas' as const,
    label: 'Prod Dynatrace',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
};

/**
 * Return the MUI Button (not the header IconButton) that contains the visible
 * text "Configure". The header icon button uses aria-label only, not a text node.
 */
function getConfigureButton() {
  return screen.getAllByRole('button', { name: /configure/i }).find(
    (btn) => btn.textContent?.toLowerCase().includes('configure'),
  )!;
}

function getDeleteButton() {
  return screen.getByRole('button', { name: /delete/i });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('IntegrationCard — RBAC button gating', () => {
  it('REGRESSION: org-member sees Configure DISABLED with tooltip on Dynatrace card', async () => {
    // Reproduces the exact bug scenario: org-member has no update capability.
    usePermissions.mockReturnValue({
      can: () => false,
      isLoaded: true,
    });

    render(
      wrap(
        <IntegrationCardComponent
          card={dynatraceCard}
          isExpanded
          {...minimalHandlers}
        />,
      ),
    );

    const configure = getConfigureButton();
    expect(configure).toBeDisabled();
    expect(configure).toHaveAttribute('aria-disabled', 'true');

    // Tooltip is anchored on the wrapping <span> — fire mouseEnter on it.
    const tooltipWrapper = configure.closest('span')!;
    fireEvent.mouseEnter(tooltipWrapper);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent(/org admin only/i);
  });

  it('org-admin sees Configure and Delete ENABLED', () => {
    usePermissions.mockReturnValue({
      can: (action: string) =>
        action === 'integration:dynatrace:update' ||
        action === 'integration:dynatrace:delete',
      isLoaded: true,
    });

    render(
      wrap(
        <IntegrationCardComponent
          card={dynatraceCard}
          isExpanded
          {...minimalHandlers}
        />,
      ),
    );

    expect(getConfigureButton()).toBeEnabled();
    expect(getDeleteButton()).toBeEnabled();
  });

  it('global admin sees Configure ENABLED via capabilities (not _permissions)', async () => {
    // Global admin has all capabilities — can() returns true for any action.
    usePermissions.mockReturnValue({
      can: () => true,
      isLoaded: true,
    });

    // Use a Dynatrace card (no async data fetching) to avoid act() noise.
    // The test point is: can() returning true → button enabled regardless of
    // whether _permissions is present on instanceData.
    const cardWithoutPermissions = {
      ...dynatraceCard,
      // Explicitly no _permissions field on instanceData.
      instanceData: {
        id: 'no-perms',
        host: 'https://dt.example.com',
        apiToken: 'token',
        dynatraceType: 'saas' as const,
        label: 'Global Admin DT',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    };

    await act(async () => {
      render(
        wrap(
          <IntegrationCardComponent
            card={cardWithoutPermissions}
            isExpanded
            {...minimalHandlers}
          />,
        ),
      );
    });

    expect(getConfigureButton()).toBeEnabled();
    expect(getDeleteButton()).toBeEnabled();
  });

  it('disabled Configure button does NOT call onSettings when clicked', () => {
    usePermissions.mockReturnValue({ can: () => false, isLoaded: true });

    const onSettings = jest.fn();

    render(
      wrap(
        <IntegrationCardComponent
          card={dynatraceCard}
          isExpanded
          {...minimalHandlers}
          onSettings={onSettings}
        />,
      ),
    );

    const configure = getConfigureButton();
    expect(configure).toBeDisabled();

    // fireEvent bypasses pointer-events; RequiresPermission's onClick interceptor
    // calls e.stopPropagation() and e.preventDefault() — onSettings must not fire.
    fireEvent.click(configure);
    expect(onSettings).not.toHaveBeenCalled();
  });

  it('Delete button is also gated — org-member sees it DISABLED', () => {
    usePermissions.mockReturnValue({ can: () => false, isLoaded: true });

    render(
      wrap(
        <IntegrationCardComponent
          card={dynatraceCard}
          isExpanded
          {...minimalHandlers}
        />,
      ),
    );

    const deleteBtn = getDeleteButton();
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute('aria-disabled', 'true');
  });
});
