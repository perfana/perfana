/**
 * Unit tests for useReports hooks
 *
 * Tests the report management hooks that wrap @tanstack/react-query:
 * - useReports: paginated list with filtering, polling, cache management
 * - useReportSummary: summary card data
 * - useReportDetail: single report with polling for in-progress status
 * - useReportHtml: HTML content retrieval
 * - useGenerateReport: template and ad-hoc generation mutations
 * - useReportActions: delete, retry, PDF, sharing mutations
 * - useInvalidateReports: cache invalidation helpers
 * - reportsQueryKeys: query key factory
 *
 * Pattern: mock the entire @/lib/api/reports module so no real HTTP
 * calls are made. Each test wraps renderHook with a fresh QueryClient
 * (via a wrapper) to guarantee isolation.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useReports,
  useReportSummary,
  useReportDetail,
  useReportHtml,
  useGenerateReport,
  useReportActions,
  useInvalidateReports,
  reportsQueryKeys,
} from '@/app/test-runs/[id]/components/reporting/hooks/useReports';

// ---------------------------------------------------------------------------
// Mock the entire reports API module
// ---------------------------------------------------------------------------

jest.mock('@/lib/api/reports', () => ({
  listReports: jest.fn(),
  getReportSummary: jest.fn(),
  getReport: jest.fn(),
  getReportHtml: jest.fn(),
  generateReportFromTemplate: jest.fn(),
  generateAdHocReport: jest.fn(),
  deleteReport: jest.fn(),
  retryReport: jest.fn(),
  generatePdf: jest.fn(),
  downloadPdf: jest.fn(),
  updateShareSettings: jest.fn(),
  enableSharing: jest.fn(),
  disableSharing: jest.fn(),
  getShareSettings: jest.fn(),
  isProcessingStatus: jest.fn((status: string) =>
    status === 'pending' || status === 'processing' || status === 'pdf_processing'
  ),
}));

import {
  listReports,
  getReportSummary,
  getReport,
  getReportHtml,
  generateReportFromTemplate,
  generateAdHocReport,
  deleteReport as deleteReportApi,
  retryReport as retryReportApi,
  generatePdf as generatePdfApi,
  downloadPdf as downloadPdfApi,
  updateShareSettings,
  isProcessingStatus,
  type ReportListItem,
  type ReportListResponse,
  type ReportSummary,
  type ReportDetail,
  type GenerateReportResponse,
  type GeneratePdfResponse,
  type ShareSettingsResponse,
} from '@/lib/api/reports';

const mockListReports = listReports as jest.MockedFunction<typeof listReports>;
const mockGetReportSummary = getReportSummary as jest.MockedFunction<typeof getReportSummary>;
const mockGetReport = getReport as jest.MockedFunction<typeof getReport>;
const mockGetReportHtml = getReportHtml as jest.MockedFunction<typeof getReportHtml>;
const mockGenerateReportFromTemplate = generateReportFromTemplate as jest.MockedFunction<typeof generateReportFromTemplate>;
const mockGenerateAdHocReport = generateAdHocReport as jest.MockedFunction<typeof generateAdHocReport>;
const mockDeleteReport = deleteReportApi as jest.MockedFunction<typeof deleteReportApi>;
const mockRetryReport = retryReportApi as jest.MockedFunction<typeof retryReportApi>;
const mockGeneratePdf = generatePdfApi as jest.MockedFunction<typeof generatePdfApi>;
const mockDownloadPdf = downloadPdfApi as jest.MockedFunction<typeof downloadPdfApi>;
const mockUpdateShareSettings = updateShareSettings as jest.MockedFunction<typeof updateShareSettings>;
const mockIsProcessingStatus = isProcessingStatus as jest.MockedFunction<typeof isProcessingStatus>;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = 'test-run-abc-123';
const REPORT_ID = 'report-uuid-456';

const makeReportListItem = (overrides: Partial<ReportListItem> = {}): ReportListItem => ({
  id: REPORT_ID,
  test_run_id: TEST_RUN_ID,
  template_name: 'Performance Report Template',
  name: 'Performance Report',
  generated_by: 'user-123',
  status: 'html_complete',
  share_enabled: false,
  share_id: 'share-xyz',
  share_view_count: 0,
  download_count: 0,
  has_pdf: false,
  created_at: '2024-01-15T10:00:00Z',
  ...overrides,
});

const makeReportListResponse = (
  items: ReportListItem[] = [makeReportListItem()],
  overrides: Partial<ReportListResponse> = {}
): ReportListResponse => ({
  items,
  total: items.length,
  offset: 0,
  limit: 20,
  ...overrides,
});

const makeReportSummary = (overrides: Partial<ReportSummary> = {}): ReportSummary => ({
  total_reports: 5,
  completed_reports: 3,
  pending_reports: 1,
  failed_reports: 1,
  total_downloads: 12,
  total_share_views: 8,
  ...overrides,
});

const makeReportDetail = (overrides: Partial<ReportDetail> = {}): ReportDetail => ({
  id: REPORT_ID,
  test_run_id: TEST_RUN_ID,
  template_id: 'tmpl-1',
  name: 'Performance Report',
  generated_by: 'user-123',
  share_id: 'share-xyz',
  share_enabled: false,
  share_view_count: 0,
  has_pdf: false,
  mime_type: 'text/html',
  status: 'html_complete',
  retry_count: 0,
  max_retries: 3,
  download_count: 0,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:05:00Z',
  ...overrides,
});

const makeGenerateResponse = (overrides: Partial<GenerateReportResponse> = {}): GenerateReportResponse => ({
  report_id: REPORT_ID,
  job_id: 'job-789',
  status: 'pending',
  ...overrides,
});

const makePdfResponse = (overrides: Partial<GeneratePdfResponse> = {}): GeneratePdfResponse => ({
  report_id: REPORT_ID,
  job_id: 'job-pdf-101',
  status: 'pdf_processing',
  ...overrides,
});

const makeShareResponse = (overrides: Partial<ShareSettingsResponse> = {}): ShareSettingsResponse => ({
  share_id: 'share-xyz',
  share_enabled: true,
  share_url: 'https://example.com/share/share-xyz',
  share_view_count: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// QueryClient wrapper factory
// Each call creates a fresh client so tests never share cache state
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries to make errors surface immediately in tests
        retry: false,
        // Disable stale time override for tests to control fetching
        staleTime: 0,
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { Wrapper, queryClient };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Reset isProcessingStatus to default implementation
  mockIsProcessingStatus.mockImplementation(
    (status: string) => status === 'pending' || status === 'processing' || status === 'pdf_processing'
  );
});

// ===========================================================================
// reportsQueryKeys factory
// ===========================================================================

describe('reportsQueryKeys', () => {
  it('all returns base key array', () => {
    expect(reportsQueryKeys.all).toEqual(['reports']);
  });

  it('list includes testRunId', () => {
    expect(reportsQueryKeys.list('run-1')).toEqual(['reports', 'list', 'run-1']);
  });

  it('listFiltered includes testRunId and filter object', () => {
    const filters = { limit: 10, offset: 0 };
    expect(reportsQueryKeys.listFiltered('run-1', filters)).toEqual([
      'reports', 'list', 'run-1', filters,
    ]);
  });

  it('summary includes testRunId', () => {
    expect(reportsQueryKeys.summary('run-1')).toEqual(['reports', 'summary', 'run-1']);
  });

  it('detail includes reportId', () => {
    expect(reportsQueryKeys.detail('rep-1')).toEqual(['reports', 'detail', 'rep-1']);
  });

  it('html includes reportId', () => {
    expect(reportsQueryKeys.html('rep-1')).toEqual(['reports', 'html', 'rep-1']);
  });

  it('share includes reportId', () => {
    expect(reportsQueryKeys.share('rep-1')).toEqual(['reports', 'share', 'rep-1']);
  });
});

// ===========================================================================
// useReports
// ===========================================================================

describe('useReports', () => {
  describe('Initial state', () => {
    it('should start in loading state with empty data', () => {
      // Arrange - never resolves so we capture the loading state
      mockListReports.mockImplementation(() => new Promise(() => {}));
      const { Wrapper } = createWrapper();

      // Act
      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      // Assert
      expect(result.current.loading).toBe(true);
      expect(result.current.reports).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.error).toBeNull();
      expect(result.current.hasReports).toBe(false);
    });

    it('should apply default options (limit=20, offset=0)', () => {
      mockListReports.mockResolvedValue(makeReportListResponse());
      const { Wrapper } = createWrapper();

      renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      expect(mockListReports).toHaveBeenCalledWith(
        TEST_RUN_ID,
        expect.objectContaining({ limit: 20, offset: 0, sortBy: 'created_at', sortOrder: 'desc' })
      );
    });

    it('should not fetch when testRunId is empty string', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReports(''), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockListReports).not.toHaveBeenCalled();
    });

    it('should not fetch when enabled is false', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReports(TEST_RUN_ID, { enabled: false }), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockListReports).not.toHaveBeenCalled();
    });
  });

  describe('Successful data fetching', () => {
    it('should fetch and return reports', async () => {
      // Arrange
      const reports = [makeReportListItem(), makeReportListItem({ id: 'report-2', name: 'Report B' })];
      mockListReports.mockResolvedValue(makeReportListResponse(reports, { total: 2 }));
      const { Wrapper } = createWrapper();

      // Act
      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      // Assert
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.reports).toHaveLength(2);
      expect(result.current.total).toBe(2);
      expect(result.current.error).toBeNull();
      expect(result.current.hasReports).toBe(true);
    });

    it('should return empty reports list when none exist', async () => {
      mockListReports.mockResolvedValue(makeReportListResponse([], { total: 0 }));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.reports).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.hasReports).toBe(false);
    });

    it('should pass filter options to the API', async () => {
      mockListReports.mockResolvedValue(makeReportListResponse());
      const { Wrapper } = createWrapper();

      renderHook(
        () => useReports(TEST_RUN_ID, { status: 'html_complete', limit: 10, offset: 5, sortBy: 'name', sortOrder: 'asc' }),
        { wrapper: Wrapper }
      );

      await waitFor(() => expect(mockListReports).toHaveBeenCalled());
      expect(mockListReports).toHaveBeenCalledWith(
        TEST_RUN_ID,
        expect.objectContaining({ status: 'html_complete', limit: 10, offset: 5, sortBy: 'name', sortOrder: 'asc' })
      );
    });

    it('should not include status in filter options when not provided', async () => {
      mockListReports.mockResolvedValue(makeReportListResponse());
      const { Wrapper } = createWrapper();

      renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(mockListReports).toHaveBeenCalled());
      const callArgs = mockListReports.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('status');
    });

    it('should reflect offset and limit from the API response', async () => {
      mockListReports.mockResolvedValue(makeReportListResponse([makeReportListItem()], { offset: 10, limit: 5 }));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID, { limit: 5, offset: 10 }), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.offset).toBe(10);
      expect(result.current.limit).toBe(5);
    });
  });

  describe('Pagination flags', () => {
    it('should compute hasNextPage correctly when more items exist', async () => {
      // total=50, offset=0, limit=20 → hasNextPage = true
      mockListReports.mockResolvedValue(makeReportListResponse(
        Array(20).fill(null).map((_, i) => makeReportListItem({ id: `rep-${i}` })),
        { total: 50, offset: 0, limit: 20 }
      ));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasNextPage).toBe(true);
      expect(result.current.hasPreviousPage).toBe(false);
    });

    it('should compute hasPreviousPage correctly on second page', async () => {
      // total=50, offset=20, limit=20 → hasPreviousPage = true
      mockListReports.mockResolvedValue(makeReportListResponse(
        Array(20).fill(null).map((_, i) => makeReportListItem({ id: `rep-${i}` })),
        { total: 50, offset: 20, limit: 20 }
      ));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID, { offset: 20 }), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasPreviousPage).toBe(true);
    });

    it('should compute hasNextPage=false on last page', async () => {
      // total=10, offset=0, limit=20 → hasNextPage = false
      mockListReports.mockResolvedValue(makeReportListResponse(
        [makeReportListItem()],
        { total: 10, offset: 0, limit: 20 }
      ));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  describe('hasProcessingReports flag', () => {
    it('should be true when any report has a processing status', async () => {
      const reports = [
        makeReportListItem({ id: 'r-1', status: 'html_complete' }),
        makeReportListItem({ id: 'r-2', status: 'processing' }),
      ];
      mockListReports.mockResolvedValue(makeReportListResponse(reports, { total: 2 }));
      mockIsProcessingStatus.mockImplementation((s) => s === 'processing');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasProcessingReports).toBe(true);
    });

    it('should be false when no reports are processing', async () => {
      const reports = [makeReportListItem({ status: 'html_complete' })];
      mockListReports.mockResolvedValue(makeReportListResponse(reports));
      mockIsProcessingStatus.mockReturnValue(false);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.hasProcessingReports).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should expose error message from Error instance', async () => {
      mockListReports.mockRejectedValue(new Error('Failed to fetch reports: 500'));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Failed to fetch reports: 500');
      expect(result.current.reports).toEqual([]);
    });

    it('should expose error message from plain object with message property', async () => {
      mockListReports.mockRejectedValue({ message: 'Custom API error' });
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Custom API error');
    });

    it('should use fallback message for non-object errors', async () => {
      mockListReports.mockRejectedValue('string error');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Failed to fetch reports');
    });
  });

  describe('refetch', () => {
    it('should refetch data when refetch is called', async () => {
      const initial = makeReportListResponse([makeReportListItem({ name: 'Report V1' })], { total: 1 });
      const updated = makeReportListResponse([makeReportListItem({ name: 'Report V2' })], { total: 1 });
      mockListReports.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.reports[0].name).toBe('Report V1');

      // Act - trigger refetch and wait for new data
      act(() => { result.current.refetch(); });

      await waitFor(() => expect(result.current.reports[0].name).toBe('Report V2'));
      expect(mockListReports).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateCache', () => {
    it('should call invalidateCache without throwing', async () => {
      mockListReports.mockResolvedValue(makeReportListResponse());
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Should not throw
      await act(async () => { await result.current.invalidateCache(); });
    });
  });

  describe('Return value structure', () => {
    it('should expose all required properties', async () => {
      mockListReports.mockResolvedValue(makeReportListResponse());
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReports(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      const required = [
        'reports', 'total', 'offset', 'limit', 'loading', 'isFetching',
        'error', 'refetch', 'invalidateCache', 'hasNextPage', 'hasPreviousPage',
        'hasReports', 'hasProcessingReports',
      ];
      required.forEach((key) => expect(result.current).toHaveProperty(key));
    });
  });
});

// ===========================================================================
// useReportSummary
// ===========================================================================

describe('useReportSummary', () => {
  describe('Initial state', () => {
    it('should start in loading state with null summary', () => {
      mockGetReportSummary.mockImplementation(() => new Promise(() => {}));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportSummary(TEST_RUN_ID), { wrapper: Wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.summary).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should not fetch when testRunId is empty', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReportSummary(''), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockGetReportSummary).not.toHaveBeenCalled();
    });

    it('should not fetch when enabled is false', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReportSummary(TEST_RUN_ID, { enabled: false }), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockGetReportSummary).not.toHaveBeenCalled();
    });
  });

  describe('Successful data fetching', () => {
    it('should return summary data', async () => {
      const summary = makeReportSummary({ total_reports: 10, completed_reports: 8 });
      mockGetReportSummary.mockResolvedValue(summary);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportSummary(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.summary).toEqual(summary);
      expect(result.current.error).toBeNull();
      expect(mockGetReportSummary).toHaveBeenCalledWith(TEST_RUN_ID);
    });
  });

  describe('Error handling', () => {
    it('should expose error message from Error instance', async () => {
      mockGetReportSummary.mockRejectedValue(new Error('Failed to fetch report summary: 404'));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportSummary(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Failed to fetch report summary: 404');
      expect(result.current.summary).toBeNull();
    });

    it('should use fallback message for non-Error rejections', async () => {
      mockGetReportSummary.mockRejectedValue('some string');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportSummary(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Failed to fetch report summary');
    });
  });

  describe('invalidateCache', () => {
    it('should call invalidateCache without throwing', async () => {
      mockGetReportSummary.mockResolvedValue(makeReportSummary());
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportSummary(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.invalidateCache(); });
    });
  });

  describe('Return value structure', () => {
    it('should expose all required properties', async () => {
      mockGetReportSummary.mockResolvedValue(makeReportSummary());
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportSummary(TEST_RUN_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      ['summary', 'loading', 'isFetching', 'error', 'refetch', 'invalidateCache'].forEach(
        (key) => expect(result.current).toHaveProperty(key)
      );
    });
  });
});

// ===========================================================================
// useReportDetail
// ===========================================================================

describe('useReportDetail', () => {
  describe('Initial state', () => {
    it('should start with null report and loading=true', () => {
      mockGetReport.mockImplementation(() => new Promise(() => {}));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.report).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should not fetch when reportId is empty', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReportDetail(''), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockGetReport).not.toHaveBeenCalled();
    });

    it('should not fetch when enabled is false', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReportDetail(REPORT_ID, { enabled: false }), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockGetReport).not.toHaveBeenCalled();
    });
  });

  describe('Successful data fetching', () => {
    it('should return report detail on success', async () => {
      const report = makeReportDetail();
      mockGetReport.mockResolvedValue(report);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.report).toEqual(report);
      expect(result.current.error).toBeNull();
    });

    it('should set isProcessing=true when report status is pending', async () => {
      mockGetReport.mockResolvedValue(makeReportDetail({ status: 'pending' }));
      mockIsProcessingStatus.mockImplementation((s) => s === 'pending');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.isProcessing).toBe(true);
    });

    it('should set isProcessing=false when report is html_complete', async () => {
      mockGetReport.mockResolvedValue(makeReportDetail({ status: 'html_complete' }));
      mockIsProcessingStatus.mockReturnValue(false);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should expose error message on failure', async () => {
      mockGetReport.mockRejectedValue(new Error('Report not found'));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Report not found');
      expect(result.current.report).toBeNull();
    });

    it('should use fallback error message for non-Error rejections', async () => {
      mockGetReport.mockRejectedValue('string rejection');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Failed to fetch report');
    });
  });

  describe('Return value structure', () => {
    it('should expose all required properties', async () => {
      mockGetReport.mockResolvedValue(makeReportDetail());
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportDetail(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      ['report', 'loading', 'isFetching', 'error', 'refetch', 'isProcessing'].forEach(
        (key) => expect(result.current).toHaveProperty(key)
      );
    });
  });
});

// ===========================================================================
// useReportHtml
// ===========================================================================

describe('useReportHtml', () => {
  describe('Initial state', () => {
    it('should start with null html and loading=true', () => {
      mockGetReportHtml.mockImplementation(() => new Promise(() => {}));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportHtml(REPORT_ID), { wrapper: Wrapper });

      expect(result.current.loading).toBe(true);
      expect(result.current.html).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should not fetch when reportId is empty', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReportHtml(''), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockGetReportHtml).not.toHaveBeenCalled();
    });

    it('should not fetch when enabled is false', async () => {
      const { Wrapper } = createWrapper();

      renderHook(() => useReportHtml(REPORT_ID, { enabled: false }), { wrapper: Wrapper });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockGetReportHtml).not.toHaveBeenCalled();
    });
  });

  describe('Successful data fetching', () => {
    it('should return HTML string on success', async () => {
      const htmlContent = '<html><body><h1>Performance Report</h1></body></html>';
      mockGetReportHtml.mockResolvedValue(htmlContent);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportHtml(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.html).toBe(htmlContent);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should expose error message on failure', async () => {
      mockGetReportHtml.mockRejectedValue(new Error('Report HTML not available'));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportHtml(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Report HTML not available');
      expect(result.current.html).toBeNull();
    });

    it('should use fallback error for non-object rejections', async () => {
      mockGetReportHtml.mockRejectedValue('plain string error');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportHtml(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('Failed to fetch report HTML');
    });
  });

  describe('Return value structure', () => {
    it('should expose all required properties', async () => {
      mockGetReportHtml.mockResolvedValue('<html></html>');
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportHtml(REPORT_ID), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      ['html', 'loading', 'error', 'refetch'].forEach(
        (key) => expect(result.current).toHaveProperty(key)
      );
    });
  });
});

// ===========================================================================
// useGenerateReport
// ===========================================================================

describe('useGenerateReport', () => {
  describe('Initial state', () => {
    it('should start with isGenerating=false and no error', () => {
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport(), { wrapper: Wrapper });

      expect(result.current.isGenerating).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.generateFromTemplate).toBe('function');
      expect(typeof result.current.generateAdHoc).toBe('function');
      expect(typeof result.current.resetError).toBe('function');
    });
  });

  describe('generateFromTemplate', () => {
    it('should call generateReportFromTemplate with the request and return response', async () => {
      const response = makeGenerateResponse();
      mockGenerateReportFromTemplate.mockResolvedValue(response);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport(), { wrapper: Wrapper });

      let returnValue: GenerateReportResponse;
      await act(async () => {
        returnValue = await result.current.generateFromTemplate({
          test_run_id: TEST_RUN_ID,
          template_id: 'tmpl-1',
          name: 'My Report',
        });
      });

      expect(returnValue!).toEqual(response);
      // React Query v5 passes a context object as a second arg to mutationFn
      expect(mockGenerateReportFromTemplate).toHaveBeenCalledWith(
        { test_run_id: TEST_RUN_ID, template_id: 'tmpl-1', name: 'My Report' },
        expect.objectContaining({ client: expect.anything() })
      );
    });

    it('should call onNotify with success message on success', async () => {
      mockGenerateReportFromTemplate.mockResolvedValue(makeGenerateResponse());
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        await result.current.generateFromTemplate({ test_run_id: TEST_RUN_ID, template_id: 'tmpl-1' });
      });

      expect(onNotify).toHaveBeenCalledWith('Report generation started', 'success');
    });

    it('should call onNotify with error message on failure', async () => {
      mockGenerateReportFromTemplate.mockRejectedValue(new Error('Template not found'));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try {
          await result.current.generateFromTemplate({ test_run_id: TEST_RUN_ID, template_id: 'tmpl-1' });
        } catch (_e) {
          // mutation throws on error
        }
      });

      expect(onNotify).toHaveBeenCalledWith('Template not found', 'error');
    });

    it('should use fallback error message for non-Error rejections from template generation', async () => {
      mockGenerateReportFromTemplate.mockRejectedValue({ code: 500 });
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try {
          await result.current.generateFromTemplate({ test_run_id: TEST_RUN_ID, template_id: 'tmpl-1' });
        } catch (_e) {
          // noop
        }
      });

      expect(onNotify).toHaveBeenCalledWith('Failed to generate report', 'error');
    });

    it('should set isGenerating=true during generation', async () => {
      let resolveFn: (value: GenerateReportResponse) => void;
      mockGenerateReportFromTemplate.mockImplementation(
        () => new Promise<GenerateReportResponse>((resolve) => { resolveFn = resolve; })
      );
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport(), { wrapper: Wrapper });

      act(() => {
        result.current.generateFromTemplate({ test_run_id: TEST_RUN_ID, template_id: 'tmpl-1' });
      });

      await waitFor(() => expect(result.current.isGenerating).toBe(true));

      await act(async () => { resolveFn!(makeGenerateResponse()); });
      await waitFor(() => expect(result.current.isGenerating).toBe(false));
    });
  });

  describe('generateAdHoc', () => {
    it('should call generateAdHocReport with the request and return response', async () => {
      const response = makeGenerateResponse();
      mockGenerateAdHocReport.mockResolvedValue(response);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport(), { wrapper: Wrapper });

      let returnValue: GenerateReportResponse;
      await act(async () => {
        returnValue = await result.current.generateAdHoc({
          test_run_id: TEST_RUN_ID,
          name: 'Ad-hoc Report',
          sections: [],
        });
      });

      expect(returnValue!).toEqual(response);
      // React Query v5 passes a context object as a second arg to mutationFn
      expect(mockGenerateAdHocReport).toHaveBeenCalledWith(
        { test_run_id: TEST_RUN_ID, name: 'Ad-hoc Report', sections: [] },
        expect.objectContaining({ client: expect.anything() })
      );
    });

    it('should call onNotify with ad-hoc success message', async () => {
      mockGenerateAdHocReport.mockResolvedValue(makeGenerateResponse());
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        await result.current.generateAdHoc({ test_run_id: TEST_RUN_ID, name: 'Report', sections: [] });
      });

      expect(onNotify).toHaveBeenCalledWith('Ad-hoc report generation started', 'success');
    });

    it('should call onNotify with error message on ad-hoc failure', async () => {
      mockGenerateAdHocReport.mockRejectedValue(new Error('Invalid sections'));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try {
          await result.current.generateAdHoc({ test_run_id: TEST_RUN_ID, name: 'Report', sections: [] });
        } catch (_e) {
          // noop
        }
      });

      expect(onNotify).toHaveBeenCalledWith('Invalid sections', 'error');
    });
  });

  describe('cache invalidation on success', () => {
    it('should invalidate list and summary caches for testRunId after generateFromTemplate', async () => {
      mockGenerateReportFromTemplate.mockResolvedValue(makeGenerateResponse());
      // Provide a reports query to populate the cache first
      mockListReports.mockResolvedValue(makeReportListResponse());
      mockGetReportSummary.mockResolvedValue(makeReportSummary());
      const { Wrapper, queryClient } = createWrapper();

      const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(
        () => useGenerateReport({ testRunId: TEST_RUN_ID }),
        { wrapper: Wrapper }
      );

      await act(async () => {
        await result.current.generateFromTemplate({ test_run_id: TEST_RUN_ID, template_id: 'tmpl-1' });
      });

      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: reportsQueryKeys.list(TEST_RUN_ID) })
      );
      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: reportsQueryKeys.summary(TEST_RUN_ID) })
      );
    });
  });

  describe('resetError', () => {
    it('should reset error state after a failed generation', async () => {
      mockGenerateReportFromTemplate.mockRejectedValue(new Error('Some error'));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useGenerateReport(), { wrapper: Wrapper });

      await act(async () => {
        try { await result.current.generateFromTemplate({ test_run_id: TEST_RUN_ID, template_id: 'tmpl-1' }); } catch (_e) { /* noop */ }
      });

      await waitFor(() => expect(result.current.error).toBe('Some error'));

      act(() => { result.current.resetError(); });

      // React Query reset() is synchronous but the state update propagates asynchronously
      await waitFor(() => expect(result.current.error).toBeNull());
    });
  });
});

// ===========================================================================
// useReportActions
// ===========================================================================

describe('useReportActions', () => {
  describe('Initial state', () => {
    it('should start with isPending=false and pendingAction=null', () => {
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      expect(result.current.isPending).toBe(false);
      expect(result.current.pendingAction).toBeNull();
    });
  });

  describe('deleteReport', () => {
    it('should call deleteReport API and notify success', async () => {
      mockDeleteReport.mockResolvedValue(undefined);
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => { await result.current.deleteReport(REPORT_ID); });

      // React Query v5 passes a context object as a second arg to mutationFn
      expect(mockDeleteReport).toHaveBeenCalledWith(REPORT_ID, expect.objectContaining({ client: expect.anything() }));
      expect(onNotify).toHaveBeenCalledWith('Report deleted successfully', 'success');
    });

    it('should notify error on delete failure', async () => {
      mockDeleteReport.mockRejectedValue(new Error('Delete not allowed'));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try { await result.current.deleteReport(REPORT_ID); } catch (_e) { /* noop */ }
      });

      expect(onNotify).toHaveBeenCalledWith('Delete not allowed', 'error');
    });

    it('should use fallback error message for non-Error rejections on delete', async () => {
      mockDeleteReport.mockRejectedValue({ code: 403 });
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try { await result.current.deleteReport(REPORT_ID); } catch (_e) { /* noop */ }
      });

      expect(onNotify).toHaveBeenCalledWith('Failed to delete report', 'error');
    });

    it('should set pendingAction=delete while deleting', async () => {
      let resolveFn: () => void;
      mockDeleteReport.mockImplementation(
        () => new Promise<void>((resolve) => { resolveFn = resolve; })
      );
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      act(() => { result.current.deleteReport(REPORT_ID); });

      await waitFor(() => expect(result.current.pendingAction).toBe('delete'));
      expect(result.current.isPending).toBe(true);

      await act(async () => { resolveFn!(); });
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });

    it('should invalidate list and summary caches for testRunId after delete', async () => {
      mockDeleteReport.mockResolvedValue(undefined);
      const { Wrapper, queryClient } = createWrapper();
      const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(
        () => useReportActions({ testRunId: TEST_RUN_ID }),
        { wrapper: Wrapper }
      );

      await act(async () => { await result.current.deleteReport(REPORT_ID); });

      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: reportsQueryKeys.list(TEST_RUN_ID) })
      );
      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: reportsQueryKeys.summary(TEST_RUN_ID) })
      );
    });
  });

  describe('retryReport', () => {
    it('should call retryReport API and notify success', async () => {
      const response = makeGenerateResponse();
      mockRetryReport.mockResolvedValue(response);
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      let returnValue: GenerateReportResponse;
      await act(async () => {
        returnValue = await result.current.retryReport(REPORT_ID);
      });

      expect(returnValue!).toEqual(response);
      // React Query v5 passes a context object as a second arg to mutationFn
      expect(mockRetryReport).toHaveBeenCalledWith(REPORT_ID, expect.objectContaining({ client: expect.anything() }));
      expect(onNotify).toHaveBeenCalledWith('Report generation retry started', 'success');
    });

    it('should notify error on retry failure', async () => {
      mockRetryReport.mockRejectedValue(new Error('Max retries exceeded'));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try { await result.current.retryReport(REPORT_ID); } catch (_e) { /* noop */ }
      });

      expect(onNotify).toHaveBeenCalledWith('Max retries exceeded', 'error');
    });

    it('should set pendingAction=retry while retrying', async () => {
      let resolveFn: (v: GenerateReportResponse) => void;
      mockRetryReport.mockImplementation(
        () => new Promise<GenerateReportResponse>((resolve) => { resolveFn = resolve; })
      );
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      act(() => { result.current.retryReport(REPORT_ID); });

      await waitFor(() => expect(result.current.pendingAction).toBe('retry'));

      await act(async () => { resolveFn!(makeGenerateResponse()); });
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });
  });

  describe('generatePdf', () => {
    it('should call generatePdf API with reportId and options', async () => {
      const pdfResponse = makePdfResponse();
      mockGeneratePdf.mockResolvedValue(pdfResponse);
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      let returnValue: GeneratePdfResponse;
      await act(async () => {
        returnValue = await result.current.generatePdf(REPORT_ID, { paperFormat: 'a4' });
      });

      expect(returnValue!).toEqual(pdfResponse);
      expect(mockGeneratePdf).toHaveBeenCalledWith(REPORT_ID, { paperFormat: 'a4' });
      expect(onNotify).toHaveBeenCalledWith('PDF generation started', 'success');
    });

    it('should call generatePdf API without options when not provided', async () => {
      mockGeneratePdf.mockResolvedValue(makePdfResponse());
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.generatePdf(REPORT_ID);
      });

      expect(mockGeneratePdf).toHaveBeenCalledWith(REPORT_ID, undefined);
    });

    it('should set pendingAction=pdf while generating PDF', async () => {
      let resolveFn: (v: GeneratePdfResponse) => void;
      mockGeneratePdf.mockImplementation(
        () => new Promise<GeneratePdfResponse>((resolve) => { resolveFn = resolve; })
      );
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      act(() => { result.current.generatePdf(REPORT_ID); });

      await waitFor(() => expect(result.current.pendingAction).toBe('pdf'));

      await act(async () => { resolveFn!(makePdfResponse()); });
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });

    it('should notify error on PDF generation failure', async () => {
      mockGeneratePdf.mockRejectedValue(new Error('PDF generation failed'));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try { await result.current.generatePdf(REPORT_ID); } catch (_e) { /* noop */ }
      });

      expect(onNotify).toHaveBeenCalledWith('PDF generation failed', 'error');
    });
  });

  describe('downloadPdf', () => {
    it('should call downloadPdf API and return Blob', async () => {
      const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
      mockDownloadPdf.mockResolvedValue(blob);
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      let returnValue: Blob;
      await act(async () => {
        returnValue = await result.current.downloadPdf(REPORT_ID);
      });

      expect(returnValue!).toBe(blob);
      // React Query v5 passes a context object as a second arg to mutationFn
      expect(mockDownloadPdf).toHaveBeenCalledWith(REPORT_ID, expect.objectContaining({ client: expect.anything() }));
    });

    it('should set pendingAction=download while downloading', async () => {
      let resolveFn: (v: Blob) => void;
      mockDownloadPdf.mockImplementation(
        () => new Promise<Blob>((resolve) => { resolveFn = resolve; })
      );
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      act(() => { result.current.downloadPdf(REPORT_ID); });

      await waitFor(() => expect(result.current.pendingAction).toBe('download'));

      await act(async () => { resolveFn!(new Blob()); });
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });

    it('should notify error on download failure', async () => {
      mockDownloadPdf.mockRejectedValue(new Error('PDF not available'));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        try { await result.current.downloadPdf(REPORT_ID); } catch (_e) { /* noop */ }
      });

      expect(onNotify).toHaveBeenCalledWith('PDF not available', 'error');
    });
  });

  describe('updateShare', () => {
    it('should call updateShareSettings with correct args', async () => {
      const shareResponse = makeShareResponse({ share_enabled: true });
      mockUpdateShareSettings.mockResolvedValue(shareResponse);
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      let returnValue: ShareSettingsResponse;
      await act(async () => {
        returnValue = await result.current.updateShare(REPORT_ID, { share_enabled: true });
      });

      expect(returnValue!).toEqual(shareResponse);
      expect(mockUpdateShareSettings).toHaveBeenCalledWith(REPORT_ID, { share_enabled: true });
      expect(onNotify).toHaveBeenCalledWith('Sharing enabled successfully', 'success');
    });

    it('should notify "disabled" when share_enabled is false', async () => {
      mockUpdateShareSettings.mockResolvedValue(makeShareResponse({ share_enabled: false }));
      const onNotify = jest.fn();
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions({ onNotify }), { wrapper: Wrapper });

      await act(async () => {
        await result.current.updateShare(REPORT_ID, { share_enabled: false });
      });

      expect(onNotify).toHaveBeenCalledWith('Sharing disabled successfully', 'success');
    });

    it('should set pendingAction=share while updating', async () => {
      let resolveFn: (v: ShareSettingsResponse) => void;
      mockUpdateShareSettings.mockImplementation(
        () => new Promise<ShareSettingsResponse>((resolve) => { resolveFn = resolve; })
      );
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      act(() => { result.current.updateShare(REPORT_ID, { share_enabled: true }); });

      await waitFor(() => expect(result.current.pendingAction).toBe('share'));

      await act(async () => { resolveFn!(makeShareResponse()); });
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });
  });

  describe('enableSharing', () => {
    it('should call updateShareSettings with share_enabled=true', async () => {
      mockUpdateShareSettings.mockResolvedValue(makeShareResponse({ share_enabled: true }));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.enableSharing(REPORT_ID);
      });

      expect(mockUpdateShareSettings).toHaveBeenCalledWith(
        REPORT_ID,
        { share_enabled: true, expires_at: undefined }
      );
    });

    it('should pass expiresAt when provided', async () => {
      mockUpdateShareSettings.mockResolvedValue(makeShareResponse({ share_enabled: true }));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.enableSharing(REPORT_ID, '2025-12-31T23:59:59Z');
      });

      expect(mockUpdateShareSettings).toHaveBeenCalledWith(
        REPORT_ID,
        { share_enabled: true, expires_at: '2025-12-31T23:59:59Z' }
      );
    });
  });

  describe('disableSharing', () => {
    it('should call updateShareSettings with share_enabled=false', async () => {
      mockUpdateShareSettings.mockResolvedValue(makeShareResponse({ share_enabled: false }));
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.disableSharing(REPORT_ID);
      });

      expect(mockUpdateShareSettings).toHaveBeenCalledWith(
        REPORT_ID,
        { share_enabled: false }
      );
    });
  });

  describe('Return value structure', () => {
    it('should expose all required action properties', () => {
      const { Wrapper } = createWrapper();

      const { result } = renderHook(() => useReportActions(), { wrapper: Wrapper });

      const required = [
        'deleteReport', 'retryReport', 'generatePdf', 'downloadPdf',
        'updateShare', 'enableSharing', 'disableSharing', 'isPending', 'pendingAction',
      ];
      required.forEach((key) => expect(result.current).toHaveProperty(key));
    });
  });
});

// ===========================================================================
// useInvalidateReports
// ===========================================================================

describe('useInvalidateReports', () => {
  it('should return invalidate, invalidateReport, and invalidateAll functions', () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useInvalidateReports(), { wrapper: Wrapper });

    expect(typeof result.current.invalidate).toBe('function');
    expect(typeof result.current.invalidateReport).toBe('function');
    expect(typeof result.current.invalidateAll).toBe('function');
  });

  it('invalidate should call invalidateQueries for list and summary keys', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useInvalidateReports(), { wrapper: Wrapper });

    await act(async () => { await result.current.invalidate(TEST_RUN_ID); });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportsQueryKeys.list(TEST_RUN_ID) })
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportsQueryKeys.summary(TEST_RUN_ID) })
    );
  });

  it('invalidateReport should call invalidateQueries for detail and html keys', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useInvalidateReports(), { wrapper: Wrapper });

    await act(async () => { await result.current.invalidateReport(REPORT_ID); });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportsQueryKeys.detail(REPORT_ID) })
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportsQueryKeys.html(REPORT_ID) })
    );
  });

  it('invalidateAll should call invalidateQueries with the base reports key', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const invalidateQueriesSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useInvalidateReports(), { wrapper: Wrapper });

    await act(async () => { await result.current.invalidateAll(); });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: reportsQueryKeys.all })
    );
  });
});
