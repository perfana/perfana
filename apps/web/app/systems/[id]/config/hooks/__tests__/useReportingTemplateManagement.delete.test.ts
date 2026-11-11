/**
 * The template delete dialog had no failure path: the hook's try/finally let the rejection escape
 * into an async click handler, so the dialog just stayed open with nothing on screen and an
 * unhandled rejection in the console.
 */

import { renderHook, act } from '@testing-library/react';
import { useReportingTemplateManagement } from '../useReportingTemplateManagement';

jest.mock('@/lib/api/reports', () => ({
  deleteTemplate: jest.fn(),
  getTemplates: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  duplicateTemplate: jest.fn(),
  setDefaultTemplate: jest.fn(),
}));

import { deleteTemplate } from '@/lib/api/reports';

const mockDelete = deleteTemplate as jest.MockedFunction<typeof deleteTemplate>;
const template = { id: 'tpl-1', name: 'Nightly' } as never;

describe('useReportingTemplateManagement delete', () => {
  beforeEach(() => mockDelete.mockReset());

  it('shows the failure and keeps the dialog open', async () => {
    mockDelete.mockRejectedValue(new Error('Failed to delete template: boom'));
    const { result } = renderHook(() => useReportingTemplateManagement());
    act(() => result.current.handleDeleteTemplate(template));

    await act(async () => {
      await expect(result.current.handleConfirmDelete()).resolves.toBeUndefined();
    });

    expect(result.current.deleteError).toBe('Failed to delete template: boom');
    expect(result.current.deleteConfirmOpen).toBe(true);
    expect(result.current.deleteLoading).toBe(false);
  });

  it('does not carry a failure over to the next time the dialog opens', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useReportingTemplateManagement());
    act(() => result.current.handleDeleteTemplate(template));
    await act(async () => { await result.current.handleConfirmDelete(); });

    act(() => result.current.handleDeleteTemplate(template));

    expect(result.current.deleteError).toBeNull();
  });

  it('closes the dialog and reports nothing on success', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReportingTemplateManagement());
    act(() => result.current.handleDeleteTemplate(template));

    await act(async () => { await result.current.handleConfirmDelete(); });

    expect(mockDelete).toHaveBeenCalledWith('tpl-1');
    expect(result.current.deleteError).toBeNull();
    expect(result.current.deleteConfirmOpen).toBe(false);
  });
});
