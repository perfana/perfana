/**
 * TempoService Test Suite
 *
 * Comprehensive tests covering:
 * - searchTraces: filter building, URL construction, HTTP call, response parsing
 * - getTraceDetails: trace fetch, OTLP span conversion, duration calculation
 * - getMultipleTraces: batched parallel fetching, partial failure handling
 * - healthCheck: connectivity check, error handling
 * - buildTraceQLQuery: TraceQL string generation with/without sampler
 * - parseSearchResponse: duration normalisations, field aliases, missing traceId
 * - parseTraceResponse: OTLP & Jaeger formats, empty spans, duration from span times
 * - extractServiceName: attribute formats, missing resource/attributes
 * - convertOTLPSpan: attribute type coercion, events, status, missing fields
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TracingInstance } from '@perfana/shared';
import { TempoService } from './tempo.service';
import { SearchTracesDto } from './dto/tempo.dto';

// ---------------------------------------------------------------------------
// Global fetch mock — replace the real global fetch before any test runs
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<TracingInstance> = {}): TracingInstance {
  return {
    id: 'instance-uuid-1',
    label: 'My Tempo',
    tracingUrl: 'http://tempo:16686',
    tracingApiUrl: 'http://tempo:3200',
    tracingUi: 'tempo' as TracingInstance['tracingUi'],
    tracingIframeAllowed: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  } as TracingInstance;
}

function makeSearchDto(overrides: Partial<SearchTracesDto> = {}): SearchTracesDto {
  return {
    tracingInstanceId: 'instance-uuid-1',
    serviceName: 'checkout-service',
    testRunId: 'run-abc',
    scenario: 'Scenario1',
    transaction: 'PlaceOrder',
    startTime: '2025-01-01T00:00:00Z',
    endTime: '2025-01-01T01:00:00Z',
    ...overrides,
  } as SearchTracesDto;
}

/** Build a minimal OTLP resourceSpans structure for trace response data */
function makeOTLPTraceData(spanOverrides: Record<string, unknown> = {}) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout-service' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'trace-id-001',
                spanId: 'span-id-001',
                parentSpanId: undefined,
                name: 'POST /checkout',
                startTimeUnixNano: '1000000000',
                endTimeUnixNano: '2000000000',
                attributes: [
                  { key: 'http.method', value: { stringValue: 'POST' } },
                  { key: 'http.status_code', value: { intValue: 200 } },
                ],
                status: { code: 1, message: 'OK' },
                events: [
                  {
                    timeUnixNano: '1500000000',
                    name: 'retry',
                    attributes: [{ key: 'attempt', value: { intValue: 2 } }],
                  },
                ],
                ...spanOverrides,
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(''),
    status: 200,
  };
}

function makeErrorResponse(status: number, text = 'error') {
  return {
    ok: false,
    json: jest.fn(),
    text: jest.fn().mockResolvedValue(text),
    status,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TempoService', () => {
  let service: TempoService;
  let repo: jest.Mocked<Repository<TracingInstance>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TempoService,
        {
          provide: getRepositoryToken(TracingInstance),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TempoService>(TempoService);
    repo = module.get(getRepositoryToken(TracingInstance));

    // Suppress logger noise in test output
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // =========================================================================
  // searchTraces
  // =========================================================================

  describe('searchTraces', () => {
    it('should return traces on a successful search', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      const responseBody = {
        traces: [
          {
            traceID: 'trace-001',
            durationMs: 42,
            startTimeUnixNano: '1700000000000000000',
            spanCount: 3,
            rootServiceName: 'checkout-service',
            rootTraceName: 'POST /checkout',
          },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert
      expect(result.totalCount).toBe(1);
      expect(result.traces[0]?.traceId).toBe('trace-001');
      expect(result.traces[0]?.durationMs).toBe(42);
    });

    it('should call the Tempo search API with correct URL parameters', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({ traces: [] }));
      const dto = makeSearchDto({ limit: 50 });

      // Act
      await service.searchTraces(dto);

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/api/search');
      expect(url).toContain('limit=50');
      expect(url).toContain('start=');
      expect(url).toContain('end=');
      expect(url).toContain('q=');
    });

    it('should strip trailing slash from tracingApiUrl', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance({ tracingApiUrl: 'http://tempo:3200/' }));
      mockFetch.mockResolvedValue(makeOkResponse({ traces: [] }));

      // Act
      await service.searchTraces(makeSearchDto());

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).not.toContain('//api');
    });

    it('should use default limit of 100 when none provided', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({ traces: [] }));

      // Act
      await service.searchTraces(makeSearchDto({ limit: undefined }));

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('limit=100');
    });

    it('should throw BadRequestException when tracingApiUrl is not configured', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance({ tracingApiUrl: undefined }));

      // Act & Assert
      await expect(service.searchTraces(makeSearchDto())).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when Tempo returns a non-ok status', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'internal server error'));

      // Act & Assert
      await expect(service.searchTraces(makeSearchDto())).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when URL fails SSRF validation', async () => {
      // Arrange — loopback is blocked by the validator
      repo.findOne.mockResolvedValue(makeInstance({ tracingApiUrl: 'http://127.0.0.1:3200' }));

      // Act & Assert
      await expect(service.searchTraces(makeSearchDto())).rejects.toThrow(BadRequestException);
    });

    it('should rethrow errors from fetch', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockRejectedValue(new Error('network timeout'));

      // Act & Assert
      await expect(service.searchTraces(makeSearchDto())).rejects.toThrow('network timeout');
    });

    it('should throw when tracing instance is not found', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.searchTraces(makeSearchDto())).rejects.toThrow('Tracing instance not found');
    });

    it('should include sampler in TraceQL when provided', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({ traces: [] }));

      // Act
      await service.searchTraces(makeSearchDto({ sampler: 'GET /items' }));

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('Scenario1|PlaceOrder|GET /items');
      // Exact match operator for sampler case
      expect(decoded).toContain('= "Scenario1|PlaceOrder|GET /items"');
    });

    it('should use regex match in TraceQL when no sampler provided', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({ traces: [] }));

      // Act
      await service.searchTraces(makeSearchDto({ sampler: undefined }));

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('=~');
    });

    it('should return empty traces array when response has no traces key', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({}));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert
      expect(result.traces).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  // =========================================================================
  // getTraceDetails
  // =========================================================================

  describe('getTraceDetails', () => {
    it('should return parsed trace details for a valid OTLP response', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.traceId).toBe('trace-id-001');
      expect(result.spanCount).toBe(1);
      expect(result.spans[0]?.operationName).toBe('POST /checkout');
      expect(result.spans[0]?.serviceName).toBe('checkout-service');
    });

    it('should calculate durationMs from span start/end times', async () => {
      // Arrange — 1 000 000 000 ns to 2 000 000 000 ns => 1000 ms
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.durationMs).toBe(1000);
    });

    it('should set durationMs to 0 when there are no spans', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({ resourceSpans: [] }));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.durationMs).toBe(0);
      expect(result.spanCount).toBe(0);
    });

    it('should handle instrumentationLibrarySpans alias (older Tempo versions)', async () => {
      // Arrange
      const data = {
        resourceSpans: [
          {
            resource: { attributes: [] },
            instrumentationLibrarySpans: [
              {
                spans: [
                  {
                    traceId: 'trace-001',
                    spanId: 'span-001',
                    name: 'GET /health',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '1500000000',
                  },
                ],
              },
            ],
          },
        ],
      };
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.spanCount).toBe(1);
      expect(result.spans[0]?.operationName).toBe('GET /health');
    });

    it('should handle batches alias (Jaeger-format response)', async () => {
      // Arrange
      const data = {
        batches: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'api-service' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'trace-001',
                    spanId: 'span-002',
                    name: 'SELECT query',
                    startTimeUnixNano: '2000000000',
                    endTimeUnixNano: '2100000000',
                  },
                ],
              },
            ],
          },
        ],
      };
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.spanCount).toBe(1);
      expect(result.spans[0]?.serviceName).toBe('api-service');
    });

    it('should throw BadRequestException when tracingApiUrl is not configured', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance({ tracingApiUrl: undefined }));

      // Act & Assert
      await expect(service.getTraceDetails('instance-uuid-1', 'trace-001')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException on non-ok HTTP response', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'trace not found'));

      // Act & Assert
      await expect(service.getTraceDetails('instance-uuid-1', 'trace-001')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should rethrow network errors', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      // Act & Assert
      await expect(service.getTraceDetails('instance-uuid-1', 'trace-001')).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });

  // =========================================================================
  // getMultipleTraces
  // =========================================================================

  describe('getMultipleTraces', () => {
    it('should return traces for all provided IDs', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getMultipleTraces('instance-uuid-1', ['trace-001', 'trace-002']);

      // Assert
      expect(result).toHaveLength(2);
      // traceId comes from the DTO returned by getTraceDetails, which uses the param
      expect(result[0]?.traceId).toBe('trace-001');
      expect(result[1]?.traceId).toBe('trace-002');
    });

    it('should return an empty array when no trace IDs provided', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());

      // Act
      const result = await service.getMultipleTraces('instance-uuid-1', []);

      // Assert
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip failed traces and return successfully fetched ones', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch
        .mockResolvedValueOnce(makeOkResponse(makeOTLPTraceData()))
        .mockResolvedValueOnce(makeErrorResponse(500, 'oops'));

      // Act
      const result = await service.getMultipleTraces('instance-uuid-1', ['trace-ok', 'trace-fail']);

      // Assert — only the successful trace is included
      expect(result).toHaveLength(1);
      expect(result[0]?.traceId).toBe('trace-ok');
    });

    it('should process more than 10 trace IDs in batches', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));
      const ids = Array.from({ length: 15 }, (_, i) => `trace-${i}`);

      // Act
      const result = await service.getMultipleTraces('instance-uuid-1', ids);

      // Assert
      expect(result).toHaveLength(15);
      expect(mockFetch).toHaveBeenCalledTimes(15);
    });
  });

  // =========================================================================
  // healthCheck
  // =========================================================================

  describe('healthCheck', () => {
    it('should return success when Tempo /ready responds with 200', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      // Act
      const result = await service.healthCheck('instance-uuid-1');

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Tempo is healthy');
    });

    it('should call the /ready endpoint', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      // Act
      await service.healthCheck('instance-uuid-1');

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('http://tempo:3200/ready');
    });

    it('should return failure when Tempo /ready responds with non-200', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue({ ok: false, status: 503 });

      // Act
      const result = await service.healthCheck('instance-uuid-1');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('503');
    });

    it('should return failure when tracingApiUrl is not configured', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance({ tracingApiUrl: undefined }));

      // Act
      const result = await service.healthCheck('instance-uuid-1');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('does not have an API URL');
    });

    it('should return failure with error message on network error', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED connect ECONNREFUSED'));

      // Act
      const result = await service.healthCheck('instance-uuid-1');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('ECONNREFUSED');
    });

    it('should return failure with fallback message for non-Error throws', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockRejectedValue('plain string error');

      // Act
      const result = await service.healthCheck('instance-uuid-1');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed');
    });

    it('should return failure when URL fails SSRF validation', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(makeInstance({ tracingApiUrl: 'http://169.254.169.254:3200' }));

      // Act
      const result = await service.healthCheck('instance-uuid-1');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid Tempo URL');
    });

    it('should return failure when instance is not found', async () => {
      // Arrange
      repo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.healthCheck('non-existent-id');

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Tracing instance not found');
    });
  });

  // =========================================================================
  // parseSearchResponse (exercised via searchTraces)
  // =========================================================================

  describe('parseSearchResponse (via searchTraces)', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(makeInstance());
    });

    it('should handle durationNanos field', async () => {
      // Arrange
      const responseBody = {
        traces: [{ traceID: 'abc', durationNanos: 5_000_000 }],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert — 5_000_000 ns / 1_000_000 = 5 ms
      expect(result.traces[0]?.durationMs).toBe(5);
    });

    it('should handle duration field as nanoseconds when value > 1e9', async () => {
      // Arrange
      const responseBody = {
        traces: [{ traceID: 'abc', duration: 2_000_000_000 }],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert — 2_000_000_000 ns / 1_000_000 = 2000 ms
      expect(result.traces[0]?.durationMs).toBe(2000);
    });

    it('should handle duration field as milliseconds when value <= 1e9', async () => {
      // Arrange
      const responseBody = {
        traces: [{ traceID: 'abc', duration: 500 }],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert — value <= 1e9, treated as ms directly
      expect(result.traces[0]?.durationMs).toBe(500);
    });

    it('should skip traces without a traceId/traceID', async () => {
      // Arrange
      const responseBody = {
        traces: [
          { durationMs: 10 },                        // no id — skip
          { traceID: 'valid-trace', durationMs: 20 }, // valid
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert
      expect(result.traces).toHaveLength(1);
      expect(result.traces[0]?.traceId).toBe('valid-trace');
    });

    it('should accept both traces and batches top-level keys', async () => {
      // Arrange
      const responseBody = {
        batches: [{ traceID: 'batch-trace', durationMs: 7 }],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert
      expect(result.traces[0]?.traceId).toBe('batch-trace');
    });

    it('should derive spanCount from spans array length when spanCount field is absent', async () => {
      // Arrange
      const responseBody = {
        traces: [{ traceID: 'abc', spans: [{}, {}, {}] }],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert
      expect(result.traces[0]?.spanCount).toBe(3);
    });

    it('should use startTimeUnixNano or fall back to startTime', async () => {
      // Arrange
      const responseBody = {
        traces: [
          { traceID: 'abc', startTimeUnixNano: '1700000000000000000' },
          { traceID: 'def', startTime: 1700000000 },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(responseBody));

      // Act
      const result = await service.searchTraces(makeSearchDto());

      // Assert
      expect(result.traces[0]?.startTimeUnixNano).toBe('1700000000000000000');
      expect(result.traces[1]?.startTimeUnixNano).toBe('1700000000');
    });
  });

  // =========================================================================
  // parseTraceResponse / convertOTLPSpan / extractServiceName
  // (exercised via getTraceDetails)
  // =========================================================================

  describe('OTLP span conversion (via getTraceDetails)', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(makeInstance());
    });

    it('should map span attributes to a flat object', async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.spans[0]?.attributes?.['http.method']).toBe('POST');
      expect(result.spans[0]?.attributes?.['http.status_code']).toBe(200);
    });

    it('should map span events', async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.spans[0]?.events).toHaveLength(1);
      expect(result.spans[0]?.events?.[0]?.name).toBe('retry');
      expect(result.spans[0]?.events?.[0]?.attributes?.['attempt']).toBe(2);
    });

    it('should map span status code and message', async () => {
      // Arrange
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.spans[0]?.status?.code).toBe(1);
      expect(result.spans[0]?.status?.message).toBe('OK');
    });

    it('should calculate durationNanos from startTime and endTime', async () => {
      // Arrange — 2000000000 - 1000000000 = 1000000000 ns
      mockFetch.mockResolvedValue(makeOkResponse(makeOTLPTraceData()));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-id-001');

      // Assert
      expect(result.spans[0]?.durationNanos).toBe(1_000_000_000);
    });

    it('should set serviceName to "unknown" when resource is missing', async () => {
      // Arrange
      const data = {
        resourceSpans: [
          {
            resource: undefined,
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 't1',
                    spanId: 's1',
                    name: 'op',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '1100000000',
                  },
                ],
              },
            ],
          },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.serviceName).toBe('unknown');
    });

    it('should set serviceName to "unknown" when resource has no attributes', async () => {
      // Arrange
      const data = {
        resourceSpans: [
          {
            resource: {},
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 't1',
                    spanId: 's1',
                    name: 'op',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '1100000000',
                  },
                ],
              },
            ],
          },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.serviceName).toBe('unknown');
    });

    it('should use nested StringValue for service name (alternative Tempo encoding)', async () => {
      // Arrange
      const data = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: 'service.name',
                  value: { Value: { StringValue: 'nested-service' } },
                },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 't1',
                    spanId: 's1',
                    name: 'op',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '1100000000',
                  },
                ],
              },
            ],
          },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.serviceName).toBe('nested-service');
    });

    it('should handle span with no attributes', async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeOkResponse(
          makeOTLPTraceData({ attributes: undefined }),
        ),
      );

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.attributes).toEqual({});
    });

    it('should handle span with no events', async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeOkResponse(makeOTLPTraceData({ events: undefined })),
      );

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.events).toBeUndefined();
    });

    it('should handle span with no status', async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeOkResponse(makeOTLPTraceData({ status: undefined })),
      );

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.status).toBeUndefined();
    });

    it('should handle span with no parentSpanId', async () => {
      // Arrange
      mockFetch.mockResolvedValue(
        makeOkResponse(makeOTLPTraceData({ parentSpanId: undefined })),
      );

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.parentSpanId).toBeUndefined();
    });

    it('should fall back to startTime/endTime when UnixNano fields are missing', async () => {
      // Arrange — older format uses startTime / endTime
      const data = {
        resourceSpans: [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 't1',
                    spanId: 's1',
                    name: 'legacy',
                    startTime: '3000000000',
                    endTime: '4000000000',
                  },
                ],
              },
            ],
          },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.startTimeUnixNano).toBe('3000000000');
      expect(result.spans[0]?.endTimeUnixNano).toBe('4000000000');
      expect(result.spans[0]?.durationNanos).toBe(1_000_000_000);
    });

    it('should handle attribute with nested IntValue encoding', async () => {
      // Arrange
      const data = makeOTLPTraceData({
        attributes: [
          {
            key: 'retry.count',
            value: { Value: { IntValue: 5 } },
          },
        ],
      });
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert
      expect(result.spans[0]?.attributes?.['retry.count']).toBe(5);
    });

    it('should compute trace duration across multiple spans', async () => {
      // Arrange — span1: 1000–2000 ns, span2: 1500–3000 ns => total 2000 ns = 2e-6 ms
      const data = {
        resourceSpans: [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 't1',
                    spanId: 's1',
                    name: 'first',
                    startTimeUnixNano: '1000',
                    endTimeUnixNano: '2000',
                  },
                  {
                    traceId: 't1',
                    spanId: 's2',
                    name: 'second',
                    startTimeUnixNano: '1500',
                    endTimeUnixNano: '3000',
                  },
                ],
              },
            ],
          },
        ],
      };
      mockFetch.mockResolvedValue(makeOkResponse(data));

      // Act
      const result = await service.getTraceDetails('instance-uuid-1', 'trace-001');

      // Assert — (3000 - 1000) ns / 1_000_000 = 0.000002 ms
      expect(result.durationMs).toBeCloseTo((3000 - 1000) / 1_000_000, 10);
      expect(result.spanCount).toBe(2);
    });
  });

  // =========================================================================
  // buildTraceQLQuery (exercised indirectly via searchTraces)
  // =========================================================================

  describe('buildTraceQLQuery (via searchTraces)', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(makeInstance());
      mockFetch.mockResolvedValue(makeOkResponse({ traces: [] }));
    });

    it('should always include service.name and perfana-test-run-id conditions', async () => {
      // Act
      await service.searchTraces(makeSearchDto());

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('resource.service.name="checkout-service"');
      expect(decoded).toContain('"perfana-test-run-id" = "run-abc"');
    });

    it('should quote service name and test run id in the query', async () => {
      // Act
      await service.searchTraces(makeSearchDto({ serviceName: 'my-svc', testRunId: 'run-1' }));

      // Assert
      const [url] = mockFetch.mock.calls[0] as [string];
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('resource.service.name="my-svc"');
      expect(decoded).toContain('"perfana-test-run-id" = "run-1"');
    });

    it('should wrap all conditions in curly braces', async () => {
      // Act
      await service.searchTraces(makeSearchDto());

      // Assert — extract the raw (encoded) q= value then decode it
      const [url] = mockFetch.mock.calls[0] as [string];
      const match = url.match(/[?&]q=([^&]+)/);
      expect(match).not.toBeNull();
      const qParam = decodeURIComponent(match![1]!);
      expect(qParam.trimStart()).toMatch(/^\{/);
      expect(qParam.trimEnd()).toMatch(/\}$/);
    });
  });
});
