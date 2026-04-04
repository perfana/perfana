/**
 * Unit tests for useTemplates hooks
 *
 * Tests all four exported hooks:
 * - useTemplates: template list with filtering, pagination, caching
 * - useTemplateSummaries: summaries for dropdowns
 * - useTemplateDetail: single template detail
 * - useTemplateActions: CRUD mutations and section management
 * - useInvalidateTemplates: cache invalidation utilities
 * - templatesQueryKeys: query key factory
 *
 * Strategy: mock the API layer (@/lib/api/reports) at the module level so the
 * hooks exercise their own logic (query keys, error extraction, state flags,
 * pending-action detection, cache invalidation) without hitting the network.
 * Each hook is rendered inside a fresh QueryClientProvider so React Query state
 * does not leak between tests.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useTemplates,
  useTemplateSummaries,
  useTemplateDetail,
  useTemplateActions,
  useInvalidateTemplates,
  templatesQueryKeys,
} from '@/app/test-runs/[id]/components/reporting/hooks/useTemplates';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock the entire reports API — every function called by the hooks is replaced
// with a jest.fn() that tests can configure per-test.
jest.mock('@/lib/api/reports', () => ({
  listTemplates: jest.fn(),
  getTemplateSummaries: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
  duplicateTemplate: jest.fn(),
  setDefaultTemplate: jest.fn(),
  addTemplateSection: jest.fn(),
  removeTemplateSection: jest.fn(),
  reorderTemplateSections: jest.fn(),
}));

// Pull typed references to the mocked functions so tests can call
// mockResolvedValue / mockRejectedValue without re-importing.
import {
  listTemplates,
  getTemplateSummaries,
  getTemplate,
  createTemplate as createTemplateApi,
  updateTemplate as updateTemplateApi,
  deleteTemplate as deleteTemplateApi,
  duplicateTemplate as duplicateTemplateApi,
  setDefaultTemplate as setDefaultTemplateApi,
  addTemplateSection as addTemplateSectionApi,
  removeTemplateSection as removeTemplateSectionApi,
  reorderTemplateSections as reorderTemplateSectionsApi,
} from '@/lib/api/reports';

const mockListTemplates = listTemplates as jest.MockedFunction<typeof listTemplates>;
const mockGetTemplateSummaries = getTemplateSummaries as jest.MockedFunction<typeof getTemplateSummaries>;
const mockGetTemplate = getTemplate as jest.MockedFunction<typeof getTemplate>;
const mockCreateTemplate = createTemplateApi as jest.MockedFunction<typeof createTemplateApi>;
const mockUpdateTemplate = updateTemplateApi as jest.MockedFunction<typeof updateTemplateApi>;
const mockDeleteTemplate = deleteTemplateApi as jest.MockedFunction<typeof deleteTemplateApi>;
const mockDuplicateTemplate = duplicateTemplateApi as jest.MockedFunction<typeof duplicateTemplateApi>;
const mockSetDefaultTemplate = setDefaultTemplateApi as jest.MockedFunction<typeof setDefaultTemplateApi>;
const mockAddTemplateSection = addTemplateSectionApi as jest.MockedFunction<typeof addTemplateSectionApi>;
const mockRemoveTemplateSection = removeTemplateSectionApi as jest.MockedFunction<typeof removeTemplateSectionApi>;
const mockReorderTemplateSections = reorderTemplateSectionsApi as jest.MockedFunction<typeof reorderTemplateSectionsApi>;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

import type {
  TemplateListItem,
  TemplateListResponse,
  TemplateSummary,
  TemplateDetail,
  ReportSectionConfig,
} from '@/lib/api/reports';

const TEMPLATE_LIST_ITEM_1: TemplateListItem = {
  id: 'tpl-1',
  name: 'Performance Report',
  description: 'Standard performance template',
  created_by: 'user-1',
  section_count: 3,
  section_types: ['header', 'slo', 'regressions'],
  is_default: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
};

const TEMPLATE_LIST_ITEM_2: TemplateListItem = {
  id: 'tpl-2',
  name: 'Load Test Summary',
  created_by: 'user-2',
  section_count: 2,
  section_types: ['header', 'trends'],
  is_default: false,
  created_at: '2024-01-03T00:00:00Z',
  updated_at: '2024-01-04T00:00:00Z',
};

const LIST_RESPONSE: TemplateListResponse = {
  items: [TEMPLATE_LIST_ITEM_1, TEMPLATE_LIST_ITEM_2],
  total: 2,
  offset: 0,
  limit: 50,
};

const TEMPLATE_SUMMARY_1: TemplateSummary = {
  id: 'tpl-1',
  name: 'Performance Report',
  is_default: true,
  section_count: 3,
};

const TEMPLATE_SUMMARY_2: TemplateSummary = {
  id: 'tpl-2',
  name: 'Load Test Summary',
  is_default: false,
  section_count: 2,
};

const TEMPLATE_DETAIL: TemplateDetail = {
  id: 'tpl-1',
  name: 'Performance Report',
  description: 'Standard performance template',
  created_by: 'user-1',
  system_id: 'sys-1',
  test_environment: 'production',
  workload: 'baseline',
  sections: [
    { type: 'header', order: 0, title: 'Header' },
    { type: 'slo', order: 1 },
    { type: 'regressions', order: 2 },
  ],
  is_default: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
};

const SECTION_CONFIG: ReportSectionConfig = {
  type: 'trends',
  order: 3,
  title: 'Trends Section',
};

// ---------------------------------------------------------------------------
// QueryClientProvider wrapper factory
// Creates a fresh client per test to avoid cache contamination.
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,      // disable retries so failures are immediate
        staleTime: 0,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { wrapper: Wrapper, queryClient };
}

// ---------------------------------------------------------------------------
// Helper: silence expected React Query console errors during error tests
// ---------------------------------------------------------------------------
let originalConsoleError: typeof console.error;

beforeEach(() => {
  jest.clearAllMocks();
  originalConsoleError = console.error;
  // Suppress React Query internal error boundary noise in test output
  console.error = jest.fn();
});

afterEach(() => {
  console.error = originalConsoleError;
});

// ===========================================================================
// Section 1 – templatesQueryKeys factory
// ===========================================================================

describe('templatesQueryKeys', () => {
  it('should return stable base key', () => {
    expect(templatesQueryKeys.all).toEqual(['report-templates']);
  });

  it('should build list key extending base key', () => {
    expect(templatesQueryKeys.list()).toEqual(['report-templates', 'list']);
  });

  it('should build listFiltered key with filter object appended', () => {
    const filters = { system_id: 'sys-1', limit: 10, offset: 0 };
    const key = templatesQueryKeys.listFiltered(filters);
    expect(key[0]).toBe('report-templates');
    expect(key[1]).toBe('list');
    expect(key[2]).toEqual(filters);
  });

  it('should build byScope key with scope params', () => {
    const key = templatesQueryKeys.byScope('sys-1', 'prod', 'baseline');
    expect(key).toEqual(['report-templates', 'scope', 'sys-1', 'prod', 'baseline']);
  });

  it('should build summaries key with scope params', () => {
    const key = templatesQueryKeys.summaries('sys-1', 'prod', 'baseline');
    expect(key).toEqual(['report-templates', 'summaries', 'sys-1', 'prod', 'baseline']);
  });

  it('should build detail key with templateId', () => {
    const key = templatesQueryKeys.detail('tpl-1');
    expect(key).toEqual(['report-templates', 'detail', 'tpl-1']);
  });

  it('should produce different keys for different templateIds', () => {
    expect(templatesQueryKeys.detail('tpl-1')).not.toEqual(templatesQueryKeys.detail('tpl-2'));
  });
});

// ===========================================================================
// Section 2 – useTemplates
// ===========================================================================

describe('useTemplates', () => {
  describe('Initial loading state', () => {
    it('should start with loading true and empty templates', () => {
      // Never resolves so we stay in loading state
      mockListTemplates.mockReturnValue(new Promise(() => {}));
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.templates).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Successful data fetching', () => {
    it('should return templates and counts on success', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.templates).toHaveLength(2);
      expect(result.current.total).toBe(2);
      expect(result.current.error).toBeNull();
    });

    it('should expose the default template when one is flagged', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.defaultTemplate).toEqual(TEMPLATE_LIST_ITEM_1);
    });

    it('should return undefined defaultTemplate when no template is default', async () => {
      const responseNoDefault: TemplateListResponse = {
        ...LIST_RESPONSE,
        items: [{ ...TEMPLATE_LIST_ITEM_1, is_default: false }, TEMPLATE_LIST_ITEM_2],
      };
      mockListTemplates.mockResolvedValue(responseNoDefault);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.defaultTemplate).toBeUndefined();
    });

    it('should set hasTemplates true when total > 0', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasTemplates).toBe(true);
    });

    it('should set hasTemplates false when total is 0', async () => {
      mockListTemplates.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasTemplates).toBe(false);
    });
  });

  describe('Pagination flags', () => {
    it('should set hasNextPage true when more items exist beyond current page', async () => {
      const paginated: TemplateListResponse = {
        items: [TEMPLATE_LIST_ITEM_1],
        total: 100,
        offset: 0,
        limit: 10,
      };
      mockListTemplates.mockResolvedValue(paginated);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates({ limit: 10, offset: 0 }), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasNextPage).toBe(true);
      expect(result.current.hasPreviousPage).toBe(false);
    });

    it('should set hasPreviousPage true when offset is greater than 0', async () => {
      const paginated: TemplateListResponse = {
        items: [TEMPLATE_LIST_ITEM_1],
        total: 100,
        offset: 10,
        limit: 10,
      };
      mockListTemplates.mockResolvedValue(paginated);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates({ limit: 10, offset: 10 }), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasPreviousPage).toBe(true);
    });

    it('should set hasNextPage false on last page', async () => {
      const paginated: TemplateListResponse = {
        items: [TEMPLATE_LIST_ITEM_1],
        total: 11,
        offset: 10,
        limit: 10,
      };
      mockListTemplates.mockResolvedValue(paginated);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates({ limit: 10, offset: 10 }), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasNextPage).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should expose error message from Error instance', async () => {
      mockListTemplates.mockRejectedValue(new Error('Network timeout'));
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.error).toBe('Network timeout');
      expect(result.current.loading).toBe(false);
    });

    it('should use fallback message for non-Error rejection', async () => {
      // Reject with a plain string, not an Error object
      mockListTemplates.mockRejectedValue('something went wrong');
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.error).toBe('Failed to fetch templates');
    });
  });

  describe('Disabled query', () => {
    it('should not call listTemplates when enabled is false', () => {
      const { wrapper } = createWrapper();

      renderHook(() => useTemplates({ enabled: false }), { wrapper });

      expect(mockListTemplates).not.toHaveBeenCalled();
    });
  });

  describe('Filter options', () => {
    it('should pass system_id, test_environment and workload to listTemplates', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      renderHook(
        () => useTemplates({ system_id: 'sys-1', test_environment: 'prod', workload: 'baseline' }),
        { wrapper }
      );

      await waitFor(() => expect(mockListTemplates).toHaveBeenCalledTimes(1));

      const calledWith = mockListTemplates.mock.calls[0][0];
      expect(calledWith).toMatchObject({
        system_id: 'sys-1',
        test_environment: 'prod',
        workload: 'baseline',
      });
    });

    it('should omit undefined optional filters from the API call', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(mockListTemplates).toHaveBeenCalledTimes(1));

      const calledWith = mockListTemplates.mock.calls[0][0];
      expect(calledWith).not.toHaveProperty('system_id');
      expect(calledWith).not.toHaveProperty('test_environment');
      expect(calledWith).not.toHaveProperty('workload');
    });
  });

  describe('refetch', () => {
    it('should trigger a new API call when refetch is invoked', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.refetch();
      });

      // Called at least twice (initial + refetch)
      expect(mockListTemplates.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('invalidateCache', () => {
    it('should not throw when invalidateCache is called', async () => {
      mockListTemplates.mockResolvedValue(LIST_RESPONSE);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplates(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.invalidateCache();
      });

      // If no error thrown, the invalidation completed
      expect(result.current.error).toBeNull();
    });
  });
});

// ===========================================================================
// Section 3 – useTemplateSummaries
// ===========================================================================

describe('useTemplateSummaries', () => {
  const SYS_ID = 'sys-1';
  const TEST_ENV = 'production';
  const WORKLOAD = 'baseline';

  describe('Successful data fetching', () => {
    it('should return summaries on success', async () => {
      mockGetTemplateSummaries.mockResolvedValue([TEMPLATE_SUMMARY_1, TEMPLATE_SUMMARY_2]);
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.summaries).toHaveLength(2);
      expect(result.current.error).toBeNull();
    });

    it('should identify the default template in summaries', async () => {
      mockGetTemplateSummaries.mockResolvedValue([TEMPLATE_SUMMARY_1, TEMPLATE_SUMMARY_2]);
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.defaultTemplate).toEqual(TEMPLATE_SUMMARY_1);
    });

    it('should report hasTemplates true when summaries exist', async () => {
      mockGetTemplateSummaries.mockResolvedValue([TEMPLATE_SUMMARY_1]);
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasTemplates).toBe(true);
    });

    it('should report hasTemplates false when no summaries returned', async () => {
      mockGetTemplateSummaries.mockResolvedValue([]);
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.hasTemplates).toBe(false);
    });

    it('should return defaultTemplate as undefined when no summary is default', async () => {
      const noDefault = [
        { ...TEMPLATE_SUMMARY_1, is_default: false },
        { ...TEMPLATE_SUMMARY_2, is_default: false },
      ];
      mockGetTemplateSummaries.mockResolvedValue(noDefault);
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.defaultTemplate).toBeUndefined();
    });
  });

  describe('Query disabled when scope params are missing', () => {
    it('should not call the API when systemId is empty', () => {
      const { wrapper } = createWrapper();
      renderHook(() => useTemplateSummaries('', TEST_ENV, WORKLOAD), { wrapper });
      expect(mockGetTemplateSummaries).not.toHaveBeenCalled();
    });

    it('should not call the API when testEnvironment is empty', () => {
      const { wrapper } = createWrapper();
      renderHook(() => useTemplateSummaries(SYS_ID, '', WORKLOAD), { wrapper });
      expect(mockGetTemplateSummaries).not.toHaveBeenCalled();
    });

    it('should not call the API when workload is empty', () => {
      const { wrapper } = createWrapper();
      renderHook(() => useTemplateSummaries(SYS_ID, TEST_ENV, ''), { wrapper });
      expect(mockGetTemplateSummaries).not.toHaveBeenCalled();
    });

    it('should not call the API when enabled option is false', () => {
      const { wrapper } = createWrapper();
      renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD, { enabled: false }),
        { wrapper }
      );
      expect(mockGetTemplateSummaries).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should expose error message from Error instance', async () => {
      mockGetTemplateSummaries.mockRejectedValue(new Error('Service unavailable'));
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.error).toBe('Service unavailable');
    });

    it('should use fallback message for non-Error rejection', async () => {
      mockGetTemplateSummaries.mockRejectedValue({ code: 500 });
      const { wrapper } = createWrapper();

      const { result } = renderHook(
        () => useTemplateSummaries(SYS_ID, TEST_ENV, WORKLOAD),
        { wrapper }
      );

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.error).toBe('Failed to fetch template summaries');
    });
  });
});

// ===========================================================================
// Section 4 – useTemplateDetail
// ===========================================================================

describe('useTemplateDetail', () => {
  describe('Successful data fetching', () => {
    it('should return template detail on success', async () => {
      mockGetTemplate.mockResolvedValue(TEMPLATE_DETAIL);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateDetail('tpl-1'), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.template).toEqual(TEMPLATE_DETAIL);
      expect(result.current.error).toBeNull();
    });

    it('should start with template null before data loads', () => {
      mockGetTemplate.mockReturnValue(new Promise(() => {}));
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateDetail('tpl-1'), { wrapper });

      expect(result.current.template).toBeNull();
      expect(result.current.loading).toBe(true);
    });
  });

  describe('Disabled query', () => {
    it('should not call the API when templateId is empty', () => {
      const { wrapper } = createWrapper();
      renderHook(() => useTemplateDetail(''), { wrapper });
      expect(mockGetTemplate).not.toHaveBeenCalled();
    });

    it('should not call the API when enabled option is false', () => {
      const { wrapper } = createWrapper();
      renderHook(() => useTemplateDetail('tpl-1', { enabled: false }), { wrapper });
      expect(mockGetTemplate).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should expose error message from Error instance', async () => {
      mockGetTemplate.mockRejectedValue(new Error('Template not found'));
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateDetail('tpl-1'), { wrapper });

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.error).toBe('Template not found');
    });

    it('should use fallback message for non-Error rejection', async () => {
      // Reject with a truthy non-Error value that has no .message property so the
      // hook falls through to the generic 'Failed to fetch template' message.
      mockGetTemplate.mockRejectedValue(42);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateDetail('tpl-1'), { wrapper });

      await waitFor(() => expect(result.current.error).not.toBeNull());

      expect(result.current.error).toBe('Failed to fetch template');
    });
  });

  describe('refetch', () => {
    it('should re-call getTemplate when refetch is invoked', async () => {
      mockGetTemplate.mockResolvedValue(TEMPLATE_DETAIL);
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateDetail('tpl-1'), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockGetTemplate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ===========================================================================
// Section 5 – useTemplateActions
// ===========================================================================

describe('useTemplateActions', () => {
  describe('Initial state', () => {
    it('should start with no pending action and no error', () => {
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions(), { wrapper });

      expect(result.current.isPending).toBe(false);
      expect(result.current.pendingAction).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // createTemplate
  // -------------------------------------------------------------------------

  describe('createTemplate', () => {
    it('should return created template and invoke onNotify with success on success', async () => {
      mockCreateTemplate.mockResolvedValue(TEMPLATE_DETAIL);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      const createRequest = {
        name: 'New Template',
        system_id: 'sys-1',
        test_environment: 'prod',
        workload: 'baseline',
        sections: [SECTION_CONFIG],
      };

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.createTemplate(createRequest);
      });

      expect(returned).toEqual(TEMPLATE_DETAIL);
      expect(onNotify).toHaveBeenCalledWith('Template created successfully', 'success');
    });

    it('should throw and invoke onNotify with error on failure', async () => {
      mockCreateTemplate.mockRejectedValue(new Error('Validation failed'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      const createRequest = {
        name: 'Bad Template',
        system_id: 'sys-1',
        test_environment: 'prod',
        workload: 'baseline',
        sections: [],
      };

      await act(async () => {
        await expect(result.current.createTemplate(createRequest)).rejects.toThrow('Validation failed');
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Validation failed', 'error')
      );
    });

    it('should use fallback error message when rejection is not an Error', async () => {
      mockCreateTemplate.mockRejectedValue('server error');
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(
          result.current.createTemplate({
            name: 'T',
            system_id: 's',
            test_environment: 'e',
            workload: 'w',
            sections: [],
          })
        ).rejects.toBeDefined();
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Failed to create template', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateTemplate
  // -------------------------------------------------------------------------

  describe('updateTemplate', () => {
    it('should return updated template and call onNotify on success', async () => {
      mockUpdateTemplate.mockResolvedValue(TEMPLATE_DETAIL);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.updateTemplate('tpl-1', { name: 'Updated Name' });
      });

      expect(returned).toEqual(TEMPLATE_DETAIL);
      expect(mockUpdateTemplate).toHaveBeenCalledWith('tpl-1', { name: 'Updated Name' });
      expect(onNotify).toHaveBeenCalledWith('Template updated successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockUpdateTemplate.mockRejectedValue(new Error('Conflict'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.updateTemplate('tpl-1', {})).rejects.toThrow('Conflict');
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Conflict', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteTemplate
  // -------------------------------------------------------------------------

  describe('deleteTemplate', () => {
    it('should resolve and call onNotify on success', async () => {
      mockDeleteTemplate.mockResolvedValue(undefined);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await result.current.deleteTemplate('tpl-1');
      });

      // The mutationFn receives the variable as its first argument; React Query may
      // pass additional internal context — use toHaveBeenCalledTimes and check the
      // first argument explicitly.
      expect(mockDeleteTemplate).toHaveBeenCalledTimes(1);
      expect(mockDeleteTemplate.mock.calls[0][0]).toBe('tpl-1');
      expect(onNotify).toHaveBeenCalledWith('Template deleted successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockDeleteTemplate.mockRejectedValue(new Error('Not found'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.deleteTemplate('tpl-99')).rejects.toThrow('Not found');
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Not found', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // duplicateTemplate
  // -------------------------------------------------------------------------

  describe('duplicateTemplate', () => {
    it('should return duplicated template and call onNotify on success', async () => {
      const duplicate = { ...TEMPLATE_DETAIL, id: 'tpl-copy', name: 'Copy of Report' };
      mockDuplicateTemplate.mockResolvedValue(duplicate);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.duplicateTemplate('tpl-1', { name: 'Copy of Report' });
      });

      expect(returned).toEqual(duplicate);
      expect(mockDuplicateTemplate).toHaveBeenCalledWith('tpl-1', { name: 'Copy of Report' });
      expect(onNotify).toHaveBeenCalledWith('Template duplicated successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockDuplicateTemplate.mockRejectedValue(new Error('Duplicate failed'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(
          result.current.duplicateTemplate('tpl-1', { name: 'Copy' })
        ).rejects.toThrow('Duplicate failed');
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Duplicate failed', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // setDefault
  // -------------------------------------------------------------------------

  describe('setDefault', () => {
    it('should return updated template and call onNotify on success', async () => {
      mockSetDefaultTemplate.mockResolvedValue({ ...TEMPLATE_DETAIL, is_default: true });
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.setDefault('tpl-1');
      });

      expect(returned?.is_default).toBe(true);
      expect(onNotify).toHaveBeenCalledWith('Default template set successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockSetDefaultTemplate.mockRejectedValue(new Error('Cannot set default'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.setDefault('tpl-1')).rejects.toThrow('Cannot set default');
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Cannot set default', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // addSection
  // -------------------------------------------------------------------------

  describe('addSection', () => {
    it('should return updated template and call onNotify on success', async () => {
      const withSection = {
        ...TEMPLATE_DETAIL,
        sections: [...TEMPLATE_DETAIL.sections, SECTION_CONFIG],
      };
      mockAddTemplateSection.mockResolvedValue(withSection);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.addSection('tpl-1', SECTION_CONFIG);
      });

      expect(returned?.sections).toHaveLength(4);
      expect(mockAddTemplateSection).toHaveBeenCalledWith('tpl-1', SECTION_CONFIG);
      expect(onNotify).toHaveBeenCalledWith('Section added successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockAddTemplateSection.mockRejectedValue(new Error('Section limit reached'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.addSection('tpl-1', SECTION_CONFIG)).rejects.toThrow(
          'Section limit reached'
        );
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Section limit reached', 'error')
      );
    });

    it('should use fallback error message when rejection is not an Error', async () => {
      // Reject with a truthy non-Error value (no .message property) so the hook
      // falls through to the generic 'Failed to add section' message.
      mockAddTemplateSection.mockRejectedValue(42);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.addSection('tpl-1', SECTION_CONFIG)).rejects.toBeDefined();
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Failed to add section', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // removeSection
  // -------------------------------------------------------------------------

  describe('removeSection', () => {
    it('should return updated template and call onNotify on success', async () => {
      const withoutSection = {
        ...TEMPLATE_DETAIL,
        sections: TEMPLATE_DETAIL.sections.slice(0, 2),
      };
      mockRemoveTemplateSection.mockResolvedValue(withoutSection);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.removeSection('tpl-1', 2);
      });

      expect(returned?.sections).toHaveLength(2);
      expect(mockRemoveTemplateSection).toHaveBeenCalledWith('tpl-1', 2);
      expect(onNotify).toHaveBeenCalledWith('Section removed successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockRemoveTemplateSection.mockRejectedValue(new Error('Index out of range'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.removeSection('tpl-1', 99)).rejects.toThrow(
          'Index out of range'
        );
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Index out of range', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // reorderSections
  // -------------------------------------------------------------------------

  describe('reorderSections', () => {
    it('should return updated template and call onNotify on success', async () => {
      mockReorderTemplateSections.mockResolvedValue(TEMPLATE_DETAIL);
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      let returned: TemplateDetail | undefined;
      await act(async () => {
        returned = await result.current.reorderSections('tpl-1', [2, 0, 1]);
      });

      expect(returned).toEqual(TEMPLATE_DETAIL);
      expect(mockReorderTemplateSections).toHaveBeenCalledWith('tpl-1', [2, 0, 1]);
      expect(onNotify).toHaveBeenCalledWith('Sections reordered successfully', 'success');
    });

    it('should throw and notify on failure', async () => {
      mockReorderTemplateSections.mockRejectedValue(new Error('Invalid order'));
      const onNotify = jest.fn();
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions({ onNotify }), { wrapper });

      await act(async () => {
        await expect(result.current.reorderSections('tpl-1', [0])).rejects.toThrow('Invalid order');
      });

      await waitFor(() =>
        expect(onNotify).toHaveBeenCalledWith('Invalid order', 'error')
      );
    });
  });

  // -------------------------------------------------------------------------
  // onNotify is optional
  // -------------------------------------------------------------------------

  describe('onNotify is optional', () => {
    it('should not throw when onNotify is not provided and mutation succeeds', async () => {
      mockCreateTemplate.mockResolvedValue(TEMPLATE_DETAIL);
      const { wrapper } = createWrapper();

      // No onNotify passed
      const { result } = renderHook(() => useTemplateActions(), { wrapper });

      await act(async () => {
        await expect(
          result.current.createTemplate({
            name: 'T',
            system_id: 's',
            test_environment: 'e',
            workload: 'w',
            sections: [],
          })
        ).resolves.toEqual(TEMPLATE_DETAIL);
      });
    });

    it('should not throw when onNotify is not provided and mutation fails', async () => {
      mockDeleteTemplate.mockRejectedValue(new Error('Gone'));
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions(), { wrapper });

      await act(async () => {
        await expect(result.current.deleteTemplate('tpl-1')).rejects.toThrow('Gone');
      });
    });
  });

  // -------------------------------------------------------------------------
  // resetError
  // -------------------------------------------------------------------------

  describe('resetError', () => {
    it('should clear the error state after a failed mutation', async () => {
      mockCreateTemplate.mockRejectedValue(new Error('Server error'));
      const { wrapper } = createWrapper();

      const { result } = renderHook(() => useTemplateActions(), { wrapper });

      // Trigger error
      await act(async () => {
        await expect(
          result.current.createTemplate({
            name: 'T',
            system_id: 's',
            test_environment: 'e',
            workload: 'w',
            sections: [],
          })
        ).rejects.toThrow();
      });

      // Error should be set
      await waitFor(() => expect(result.current.error).not.toBeNull());

      // Reset
      act(() => {
        result.current.resetError();
      });

      await waitFor(() => expect(result.current.error).toBeNull());
    });
  });
});

// ===========================================================================
// Section 6 – useInvalidateTemplates
// ===========================================================================

describe('useInvalidateTemplates', () => {
  it('should expose invalidateAll, invalidateScope and invalidateTemplate', () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useInvalidateTemplates(), { wrapper });

    expect(typeof result.current.invalidateAll).toBe('function');
    expect(typeof result.current.invalidateScope).toBe('function');
    expect(typeof result.current.invalidateTemplate).toBe('function');
  });

  it('invalidateAll should not throw', async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useInvalidateTemplates(), { wrapper });

    await act(async () => {
      await result.current.invalidateAll();
    });
  });

  it('invalidateScope should not throw when called with valid scope params', async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useInvalidateTemplates(), { wrapper });

    await act(async () => {
      await result.current.invalidateScope('sys-1', 'production', 'baseline');
    });
  });

  it('invalidateTemplate should not throw when called with a templateId', async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useInvalidateTemplates(), { wrapper });

    await act(async () => {
      await result.current.invalidateTemplate('tpl-1');
    });
  });

  it('invalidateAll should cause dependent queries to re-fetch', async () => {
    // Set up a templates query, let it load, then invalidate and verify re-fetch
    mockListTemplates.mockResolvedValue(LIST_RESPONSE);
    const { wrapper } = createWrapper();

    const { result: listResult } = renderHook(() => useTemplates(), { wrapper });
    const { result: invalidateResult } = renderHook(() => useInvalidateTemplates(), { wrapper });

    await waitFor(() => expect(listResult.current.loading).toBe(false));

    const callsBefore = mockListTemplates.mock.calls.length;

    await act(async () => {
      await invalidateResult.current.invalidateAll();
    });

    // React Query will schedule a re-fetch after invalidation — wait for it
    await waitFor(() => expect(mockListTemplates.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
