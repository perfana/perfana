/**
 * The opt-in agent scope on a new API key: off by default, and when ticked the create request
 * carries the `comments:write` role (design: test-run-analysis-stories.md, "Reversing v1 R3").
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { ApiKeyFormDialog } from '@/app/settings/components/ApiKeyFormDialog';
import { useApiKeys } from '@/app/settings/hooks/useApiKeys';
import * as apiKeys from '@/lib/api-keys';

jest.mock('@/lib/api-keys', () => ({
  ...jest.requireActual('@/lib/api-keys'),
  fetchApiKeys: jest.fn().mockResolvedValue([]),
  createApiKey: jest.fn().mockResolvedValue({ apiKey: { id: 'k1', description: 'Agent', roles: ['comments:write'] }, token: 't' }),
}));
jest.mock('@/lib/contexts/organization-context', () => ({
  useOrganizationContext: () => ({ currentOrganizationId: null, organizations: [] }),
}));

const mocked = apiKeys as jest.Mocked<typeof apiKeys>;

describe('API key comments:write option', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the comments:write role only when the box is ticked', async () => {
    const { result } = renderHook(() => useApiKeys({ onSnackbar: jest.fn() } as never));
    await act(async () => {
      await result.current.handleCreateKey({ description: 'CI', ttl: '30d' });
    });
    expect(mocked.createApiKey.mock.calls[0]![0]).not.toHaveProperty('roles');
    await act(async () => {
      await result.current.handleCreateKey({ description: 'Agent', ttl: '30d', commentsWrite: true });
    });
    expect(mocked.createApiKey.mock.calls[1]![0]).toMatchObject({ roles: ['comments:write'] });
  });

  it('shows the option unticked with a one-line explanation', async () => {
    const { result } = renderHook(() => useApiKeys({ onSnackbar: jest.fn() } as never));
    render(<ApiKeyFormDialog open form={result.current.form} organizations={[]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    const box = screen.getByRole('checkbox', { name: /Allow writing comments/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/grants nothing else/)).toBeInTheDocument();
    fireEvent.click(box);
    await waitFor(() => expect(result.current.form.getValues('commentsWrite')).toBe(true));
  });
});
