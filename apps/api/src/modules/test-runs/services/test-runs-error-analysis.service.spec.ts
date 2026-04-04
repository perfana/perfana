/**
 * Unit tests for TestRunsErrorAnalysisService
 *
 * Tests all public methods:
 * - getErrorSummary: aggregation, error rate calc, fallback on missing raw data
 * - getErrorsByCode: grouping, numeric parsing, empty results
 * - getErrorsByTransaction: grouping by transaction/sampler/url, limit behaviour
 * - getErrorsOverTime: time-bucketed counts, ordering
 * - getErrorsOverTimeByCode: pivot transformation, multi-code merging, ordering
 * - getErrorDetails: detailed trace retrieval, nullable field fallbacks
 *
 * Coverage targets:
 * - Happy path for every method
 * - Empty / no-error scenarios
 * - Single-row and many-row result sets
 * - Numeric parsing edge cases (string integers from DB)
 * - Error rate calculation (with and without raw request data)
 * - Graceful degradation when requests_raw query throws
 * - Nullable field defaults (responseMessage, responseData, etc.)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TestRunsErrorAnalysisService } from './test-runs-error-analysis.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataSourceMock(queryImpl?: jest.Mock) {
  return { query: queryImpl ?? jest.fn() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TestRunsErrorAnalysisService', () => {
  let service: TestRunsErrorAnalysisService;
  let mockQuery: jest.Mock;

  const TEST_RUN_ID = 'tr-uuid-abc-123';

  beforeEach(async () => {
    mockQuery = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsErrorAnalysisService,
        {
          provide: getDataSourceToken(),
          useValue: makeDataSourceMock(mockQuery),
        },
      ],
    }).compile();

    service = module.get<TestRunsErrorAnalysisService>(TestRunsErrorAnalysisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // getErrorSummary
  // =========================================================================

  describe('getErrorSummary', () => {
    describe('Happy path', () => {
      it('should return aggregated counts parsed as integers', async () => {
        // Arrange — first call: summary, second call: total requests
        mockQuery
          .mockResolvedValueOnce([
            {
              totalErrors: '42',
              uniqueResponseCodes: '3',
              transactionsWithErrors: '7',
              uniqueErrorUrls: '5',
            },
          ])
          .mockResolvedValueOnce([{ total: '500' }]);

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert
        expect(result.totalErrors).toBe(42);
        expect(result.uniqueResponseCodes).toBe(3);
        expect(result.transactionsWithErrors).toBe(7);
        expect(result.uniqueErrorUrls).toBe(5);
      });

      it('should calculate error rate correctly when raw requests data is available', async () => {
        // Arrange
        mockQuery
          .mockResolvedValueOnce([
            { totalErrors: '50', uniqueResponseCodes: '2', transactionsWithErrors: '4', uniqueErrorUrls: '3' },
          ])
          .mockResolvedValueOnce([{ total: '1000' }]);

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert — 50/1000 * 100 = 5%
        expect(result.totalRequests).toBe(1000);
        expect(result.errorRate).toBe(5);
      });

      it('should set errorRate to 0 when totalRequests is 0', async () => {
        // Arrange
        mockQuery
          .mockResolvedValueOnce([
            { totalErrors: '10', uniqueResponseCodes: '1', transactionsWithErrors: '1', uniqueErrorUrls: '1' },
          ])
          .mockResolvedValueOnce([{ total: '0' }]);

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert
        expect(result.totalRequests).toBe(0);
        expect(result.errorRate).toBe(0);
      });

      it('should pass testRunId as query parameter', async () => {
        // Arrange
        mockQuery
          .mockResolvedValueOnce([
            { totalErrors: '1', uniqueResponseCodes: '1', transactionsWithErrors: '1', uniqueErrorUrls: '1' },
          ])
          .mockResolvedValueOnce([{ total: '10' }]);

        // Act
        await service.getErrorSummary(TEST_RUN_ID);

        // Assert — both queries receive the testRunId
        expect(mockQuery.mock.calls[0][1]).toEqual([TEST_RUN_ID]);
        expect(mockQuery.mock.calls[1][1]).toEqual([TEST_RUN_ID]);
      });
    });

    describe('Edge cases', () => {
      it('should return zero summary when query returns empty array', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert
        expect(result).toEqual({
          totalErrors: 0,
          uniqueResponseCodes: 0,
          transactionsWithErrors: 0,
          uniqueErrorUrls: 0,
        });
        // The error rate query should not be attempted when no errors exist
        expect(mockQuery).toHaveBeenCalledTimes(1);
      });

      it('should return zero summary when query returns null/undefined', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce(null);

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert
        expect(result.totalErrors).toBe(0);
        expect(result.errorRate).toBeUndefined();
      });

      it('should omit errorRate fields when requests_raw query returns empty array', async () => {
        // Arrange
        mockQuery
          .mockResolvedValueOnce([
            { totalErrors: '5', uniqueResponseCodes: '1', transactionsWithErrors: '1', uniqueErrorUrls: '1' },
          ])
          .mockResolvedValueOnce([]);

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert — summary fields present, optional rate fields absent
        expect(result.totalErrors).toBe(5);
        expect(result.totalRequests).toBeUndefined();
        expect(result.errorRate).toBeUndefined();
      });

      it('should return summary without errorRate when requests_raw query throws', async () => {
        // Arrange
        mockQuery
          .mockResolvedValueOnce([
            { totalErrors: '8', uniqueResponseCodes: '2', transactionsWithErrors: '3', uniqueErrorUrls: '2' },
          ])
          .mockRejectedValueOnce(new Error('relation "requests_raw" does not exist'));

        // Act — must not throw; the catch block swallows the error
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert — core summary is intact
        expect(result.totalErrors).toBe(8);
        expect(result.totalRequests).toBeUndefined();
        expect(result.errorRate).toBeUndefined();
      });

      it('should handle non-Error objects thrown by requests_raw query gracefully', async () => {
        // Arrange — throws a plain string (not an Error instance)
        mockQuery
          .mockResolvedValueOnce([
            { totalErrors: '3', uniqueResponseCodes: '1', transactionsWithErrors: '1', uniqueErrorUrls: '1' },
          ])
          .mockRejectedValueOnce('unexpected string rejection');

        // Act
        const result = await service.getErrorSummary(TEST_RUN_ID);

        // Assert — does not throw, returns partial summary
        expect(result.totalErrors).toBe(3);
        expect(result.errorRate).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // getErrorsByCode
  // =========================================================================

  describe('getErrorsByCode', () => {
    describe('Happy path', () => {
      it('should map rows to ErrorByCode objects with parsed numerics', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { responseCode: '500', errorCount: '30', avgResponseTime: '1234.56', minResponseTime: 800, maxResponseTime: 2000 },
          { responseCode: '404', errorCount: '12', avgResponseTime: '320.00', minResponseTime: 100, maxResponseTime: 600 },
        ]);

        // Act
        const results = await service.getErrorsByCode(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          responseCode: '500',
          errorCount: 30,
          avgResponseTime: 1234.56,
          minResponseTime: 800,
          maxResponseTime: 2000,
        });
        expect(results[1]).toEqual({
          responseCode: '404',
          errorCount: 12,
          avgResponseTime: 320,
          minResponseTime: 100,
          maxResponseTime: 600,
        });
      });

      it('should pass testRunId as query parameter', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        await service.getErrorsByCode(TEST_RUN_ID);

        // Assert
        expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [TEST_RUN_ID]);
      });
    });

    describe('Edge cases', () => {
      it('should return empty array when no errors exist', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        const results = await service.getErrorsByCode(TEST_RUN_ID);

        // Assert
        expect(results).toEqual([]);
      });

      it('should return single-element array for a single error code', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { responseCode: '503', errorCount: '1', avgResponseTime: '5000.00', minResponseTime: 5000, maxResponseTime: 5000 },
        ]);

        // Act
        const results = await service.getErrorsByCode(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(1);
        expect(results[0].responseCode).toBe('503');
        expect(results[0].errorCount).toBe(1);
      });

      it('should parse avgResponseTime as float, not integer', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { responseCode: '502', errorCount: '5', avgResponseTime: '1234.78', minResponseTime: 1000, maxResponseTime: 1500 },
        ]);

        // Act
        const results = await service.getErrorsByCode(TEST_RUN_ID);

        // Assert
        expect(results[0].avgResponseTime).toBeCloseTo(1234.78);
      });
    });
  });

  // =========================================================================
  // getErrorsByTransaction
  // =========================================================================

  describe('getErrorsByTransaction', () => {
    describe('Happy path', () => {
      it('should map rows to ErrorByTransaction objects', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          {
            transactionName: 'checkout',
            samplerName: 'HTTP Request',
            url: 'https://api.example.com/checkout',
            responseCode: '500',
            errorCount: '15',
            avgResponseTime: '780.50',
          },
        ]);

        // Act
        const results = await service.getErrorsByTransaction(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
          transactionName: 'checkout',
          samplerName: 'HTTP Request',
          url: 'https://api.example.com/checkout',
          responseCode: '500',
          errorCount: 15,
          avgResponseTime: 780.5,
        });
      });

      it('should include responseCode field', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          {
            transactionName: 'login',
            samplerName: 'HTTP Sampler',
            url: '/api/login',
            responseCode: '401',
            errorCount: '3',
            avgResponseTime: '200.00',
          },
        ]);

        // Act
        const results = await service.getErrorsByTransaction(TEST_RUN_ID);

        // Assert
        expect(results[0].responseCode).toBe('401');
      });

      it('should return multiple transactions ordered as received from DB', async () => {
        // Arrange — DB returns already ordered by errorCount DESC
        mockQuery.mockResolvedValueOnce([
          { transactionName: 'search', samplerName: 'S1', url: '/search', responseCode: '500', errorCount: '50', avgResponseTime: '100.00' },
          { transactionName: 'login', samplerName: 'S2', url: '/login', responseCode: '401', errorCount: '20', avgResponseTime: '50.00' },
          { transactionName: 'upload', samplerName: 'S3', url: '/upload', responseCode: '413', errorCount: '5', avgResponseTime: '300.00' },
        ]);

        // Act
        const results = await service.getErrorsByTransaction(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(3);
        expect(results[0].transactionName).toBe('search');
        expect(results[1].transactionName).toBe('login');
        expect(results[2].transactionName).toBe('upload');
      });
    });

    describe('Edge cases', () => {
      it('should return empty array when no transactions have errors', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        const results = await service.getErrorsByTransaction(TEST_RUN_ID);

        // Assert
        expect(results).toEqual([]);
      });
    });
  });

  // =========================================================================
  // getErrorsOverTime
  // =========================================================================

  describe('getErrorsOverTime', () => {
    describe('Happy path', () => {
      it('should map rows to ErrorOverTime objects with parsed errorsPerMinute', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:00:00.000Z', errorsPerMinute: '5' },
          { timeBucket: '2024-01-15T10:01:00.000Z', errorsPerMinute: '12' },
          { timeBucket: '2024-01-15T10:02:00.000Z', errorsPerMinute: '2' },
        ]);

        // Act
        const results = await service.getErrorsOverTime(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(3);
        expect(results[0]).toEqual({
          timeBucket: '2024-01-15T10:00:00.000Z',
          errorsPerMinute: 5,
        });
        expect(results[2].errorsPerMinute).toBe(2);
      });

      it('should preserve time ordering returned by the database', async () => {
        // Arrange — already ordered by DB
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T09:58:00.000Z', errorsPerMinute: '1' },
          { timeBucket: '2024-01-15T09:59:00.000Z', errorsPerMinute: '8' },
          { timeBucket: '2024-01-15T10:00:00.000Z', errorsPerMinute: '3' },
        ]);

        // Act
        const results = await service.getErrorsOverTime(TEST_RUN_ID);

        // Assert
        expect(results[0].timeBucket).toBe('2024-01-15T09:58:00.000Z');
        expect(results[1].timeBucket).toBe('2024-01-15T09:59:00.000Z');
        expect(results[2].timeBucket).toBe('2024-01-15T10:00:00.000Z');
      });
    });

    describe('Edge cases', () => {
      it('should return empty array when there are no errors', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        const results = await service.getErrorsOverTime(TEST_RUN_ID);

        // Assert
        expect(results).toEqual([]);
      });

      it('should handle a single time bucket', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:00:00.000Z', errorsPerMinute: '99' },
        ]);

        // Act
        const results = await service.getErrorsOverTime(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(1);
        expect(results[0].errorsPerMinute).toBe(99);
      });
    });
  });

  // =========================================================================
  // getErrorsOverTimeByCode
  // =========================================================================

  describe('getErrorsOverTimeByCode', () => {
    describe('Happy path', () => {
      it('should pivot response codes into dynamic properties per time bucket', async () => {
        // Arrange — two response codes in the same minute bucket
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '500', errorCount: '10' },
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '503', errorCount: '3' },
          { timeBucket: '2024-01-15T10:01:00.000Z', responseCode: '500', errorCount: '7' },
        ]);

        // Act
        const results = await service.getErrorsOverTimeByCode(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(2);

        const first = results[0];
        expect(first.timeBucket).toBe('2024-01-15T10:00:00.000Z');
        expect(first['500']).toBe(10);
        expect(first['503']).toBe(3);

        const second = results[1];
        expect(second.timeBucket).toBe('2024-01-15T10:01:00.000Z');
        expect(second['500']).toBe(7);
        // Code 503 absent in the second bucket — should not be present
        expect(second['503']).toBeUndefined();
      });

      it('should sort result by timeBucket ascending', async () => {
        // Arrange — DB rows in reverse order to test client-side sort
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:02:00.000Z', responseCode: '500', errorCount: '1' },
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '500', errorCount: '5' },
          { timeBucket: '2024-01-15T10:01:00.000Z', responseCode: '404', errorCount: '2' },
        ]);

        // Act
        const results = await service.getErrorsOverTimeByCode(TEST_RUN_ID);

        // Assert — sorted ascending
        expect(results[0].timeBucket).toBe('2024-01-15T10:00:00.000Z');
        expect(results[1].timeBucket).toBe('2024-01-15T10:01:00.000Z');
        expect(results[2].timeBucket).toBe('2024-01-15T10:02:00.000Z');
      });

      it('should parse errorCount as integer', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '500', errorCount: '42' },
        ]);

        // Act
        const results = await service.getErrorsOverTimeByCode(TEST_RUN_ID);

        // Assert
        expect(results[0]['500']).toBe(42);
        expect(typeof results[0]['500']).toBe('number');
      });

      it('should handle multiple response codes across multiple time buckets', async () => {
        // Arrange — 3 codes across 3 buckets
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '500', errorCount: '10' },
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '503', errorCount: '5' },
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '404', errorCount: '2' },
          { timeBucket: '2024-01-15T10:01:00.000Z', responseCode: '500', errorCount: '8' },
          { timeBucket: '2024-01-15T10:01:00.000Z', responseCode: '503', errorCount: '1' },
          { timeBucket: '2024-01-15T10:02:00.000Z', responseCode: '404', errorCount: '3' },
        ]);

        // Act
        const results = await service.getErrorsOverTimeByCode(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(3);
        expect(results[0]['500']).toBe(10);
        expect(results[0]['503']).toBe(5);
        expect(results[0]['404']).toBe(2);
        expect(results[1]['500']).toBe(8);
        expect(results[1]['503']).toBe(1);
        expect(results[2]['404']).toBe(3);
      });
    });

    describe('Edge cases', () => {
      it('should return empty array when no errors exist', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        const results = await service.getErrorsOverTimeByCode(TEST_RUN_ID);

        // Assert
        expect(results).toEqual([]);
      });

      it('should handle a single row (one code, one bucket)', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          { timeBucket: '2024-01-15T10:00:00.000Z', responseCode: '500', errorCount: '1' },
        ]);

        // Act
        const results = await service.getErrorsOverTimeByCode(TEST_RUN_ID);

        // Assert
        expect(results).toHaveLength(1);
        expect(results[0].timeBucket).toBe('2024-01-15T10:00:00.000Z');
        expect(results[0]['500']).toBe(1);
      });
    });
  });

  // =========================================================================
  // getErrorDetails
  // =========================================================================

  describe('getErrorDetails', () => {
    const TRANSACTION = 'checkout';
    const SAMPLER = 'HTTP Request';
    const URL = 'https://api.example.com/checkout';

    describe('Happy path', () => {
      it('should map all fields from the database row', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          {
            time: '2024-01-15T10:05:30.000Z',
            transactionName: 'checkout',
            samplerName: 'HTTP Request',
            responseCode: '500',
            responseTime: 1234,
            url: 'https://api.example.com/checkout',
            responseMessage: 'Internal Server Error',
            responseData: '<html>500</html>',
            requestHeaders: 'Authorization: Bearer token',
            responseHeaders: 'Content-Type: text/html',
          },
        ]);

        // Act
        const results = await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
          time: '2024-01-15T10:05:30.000Z',
          transactionName: 'checkout',
          samplerName: 'HTTP Request',
          responseCode: '500',
          responseTime: 1234,
          url: 'https://api.example.com/checkout',
          responseMessage: 'Internal Server Error',
          responseData: '<html>500</html>',
          requestHeaders: 'Authorization: Bearer token',
          responseHeaders: 'Content-Type: text/html',
        });
      });

      it('should pass all four filter parameters to the query', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert
        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          [TEST_RUN_ID, TRANSACTION, SAMPLER, URL],
        );
      });

      it('should return up to 10 rows (query has LIMIT 10)', async () => {
        // Arrange — simulate DB returning exactly 10 rows
        const rows = Array.from({ length: 10 }, (_, i) => ({
          time: `2024-01-15T10:0${i}:00.000Z`,
          transactionName: TRANSACTION,
          samplerName: SAMPLER,
          responseCode: '500',
          responseTime: 1000 + i,
          url: URL,
          responseMessage: `Error ${i}`,
          responseData: '',
          requestHeaders: '',
          responseHeaders: '',
        }));
        mockQuery.mockResolvedValueOnce(rows);

        // Act
        const results = await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert
        expect(results).toHaveLength(10);
      });

      it('should default nullable string fields to empty string when null', async () => {
        // Arrange — nullable fields come back as null from DB
        mockQuery.mockResolvedValueOnce([
          {
            time: '2024-01-15T10:00:00.000Z',
            transactionName: TRANSACTION,
            samplerName: SAMPLER,
            responseCode: '502',
            responseTime: 500,
            url: URL,
            responseMessage: null,
            responseData: null,
            requestHeaders: null,
            responseHeaders: null,
          },
        ]);

        // Act
        const results = await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert — nulls converted to empty strings via || ''
        expect(results[0].responseMessage).toBe('');
        expect(results[0].responseData).toBe('');
        expect(results[0].requestHeaders).toBe('');
        expect(results[0].responseHeaders).toBe('');
      });

      it('should default nullable string fields to empty string when undefined', async () => {
        // Arrange — fields missing entirely from DB row
        mockQuery.mockResolvedValueOnce([
          {
            time: '2024-01-15T10:00:00.000Z',
            transactionName: TRANSACTION,
            samplerName: SAMPLER,
            responseCode: '503',
            responseTime: 300,
            url: URL,
            // responseMessage, responseData, requestHeaders, responseHeaders intentionally absent
          },
        ]);

        // Act
        const results = await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert
        expect(results[0].responseMessage).toBe('');
        expect(results[0].responseData).toBe('');
        expect(results[0].requestHeaders).toBe('');
        expect(results[0].responseHeaders).toBe('');
      });
    });

    describe('Edge cases', () => {
      it('should return empty array when no matching errors found', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([]);

        // Act
        const results = await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert
        expect(results).toEqual([]);
      });

      it('should handle multiple detail rows correctly', async () => {
        // Arrange
        mockQuery.mockResolvedValueOnce([
          {
            time: '2024-01-15T10:05:30.000Z',
            transactionName: TRANSACTION,
            samplerName: SAMPLER,
            responseCode: '500',
            responseTime: 1200,
            url: URL,
            responseMessage: 'Error A',
            responseData: 'data A',
            requestHeaders: 'headers A',
            responseHeaders: 'resp headers A',
          },
          {
            time: '2024-01-15T10:04:00.000Z',
            transactionName: TRANSACTION,
            samplerName: SAMPLER,
            responseCode: '500',
            responseTime: 900,
            url: URL,
            responseMessage: 'Error B',
            responseData: 'data B',
            requestHeaders: 'headers B',
            responseHeaders: 'resp headers B',
          },
        ]);

        // Act
        const results = await service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL);

        // Assert
        expect(results).toHaveLength(2);
        expect(results[0].responseMessage).toBe('Error A');
        expect(results[1].responseMessage).toBe('Error B');
      });
    });

    describe('Error scenarios', () => {
      it('should propagate database errors to the caller', async () => {
        // Arrange
        mockQuery.mockRejectedValueOnce(new Error('connection refused'));

        // Act & Assert
        await expect(
          service.getErrorDetails(TEST_RUN_ID, TRANSACTION, SAMPLER, URL),
        ).rejects.toThrow('connection refused');
      });
    });
  });

  // =========================================================================
  // Error propagation for methods that do NOT swallow errors
  // =========================================================================

  describe('Database error propagation', () => {
    it('getErrorsByCode should propagate a database error', async () => {
      // Arrange
      mockQuery.mockRejectedValueOnce(new Error('DB timeout'));

      // Act & Assert
      await expect(service.getErrorsByCode(TEST_RUN_ID)).rejects.toThrow('DB timeout');
    });

    it('getErrorsByTransaction should propagate a database error', async () => {
      // Arrange
      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

      // Act & Assert
      await expect(service.getErrorsByTransaction(TEST_RUN_ID)).rejects.toThrow('DB connection lost');
    });

    it('getErrorsOverTime should propagate a database error', async () => {
      // Arrange
      mockQuery.mockRejectedValueOnce(new Error('query timeout'));

      // Act & Assert
      await expect(service.getErrorsOverTime(TEST_RUN_ID)).rejects.toThrow('query timeout');
    });

    it('getErrorsOverTimeByCode should propagate a database error', async () => {
      // Arrange
      mockQuery.mockRejectedValueOnce(new Error('query failed'));

      // Act & Assert
      await expect(service.getErrorsOverTimeByCode(TEST_RUN_ID)).rejects.toThrow('query failed');
    });
  });
});
