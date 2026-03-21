import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { MetricCollectionGapService } from './MetricCollectionGapService';
import { WorkerDatabaseService } from '../common/database.service';
import { DsMetricCollectionStatus } from '@perfana/shared/entities';

// Type for mocked WorkerDatabaseService
interface MockedDatabaseService {
  getTestRunByTestRunId: Mock;
  getAllCollectionStatuses: Mock;
  getIncompleteCollectionStatuses: Mock;
  markCollectionComplete: Mock;
}

describe('MetricCollectionGapService', () => {
  let service: MetricCollectionGapService;
  let mockDatabaseService: MockedDatabaseService;

  beforeEach(() => {
    // Create fresh mock database service before each test
    mockDatabaseService = {
      getTestRunByTestRunId: vi.fn(),
      getAllCollectionStatuses: vi.fn(),
      getIncompleteCollectionStatuses: vi.fn(),
      markCollectionComplete: vi.fn(),
    };

    // Directly instantiate the service with the mock
    service = new MetricCollectionGapService(
      mockDatabaseService as unknown as WorkerDatabaseService
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('detectGaps', () => {
    it('should return empty array when test run not found', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(null);

      await expect(service.detectGaps('test-run-1')).rejects.toThrow(
        'Test run not found: test-run-1'
      );
    });

    it('should return empty array when no collection statuses exist', async () => {
      const testRun = {
        testRunId: 'test-run-1',
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
      } as any;

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([]);

      const gaps = await service.detectGaps('test-run-1');

      expect(gaps).toEqual([]);
    });

    it('should detect missing ranges when collection is incomplete', async () => {
      const testRun = {
        testRunId: 'test-run-1',
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
      } as any;

      const collectionStatus: Partial<DsMetricCollectionStatus> = {
        test_run_id: 'test-run-1',
        source_type: 'grafana',
        source_id: 'grafana-instance-1',
        collected_ranges: [
          {
            from: new Date('2024-01-01T10:00:00Z'),
            to: new Date('2024-01-01T10:15:00Z'),
          },
          {
            from: new Date('2024-01-01T10:30:00Z'),
            to: new Date('2024-01-01T10:45:00Z'),
          },
        ],
        failed_ranges: [],
        is_complete: false,
      };

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        collectionStatus as DsMetricCollectionStatus,
      ]);

      const gaps = await service.detectGaps('test-run-1');

      expect(gaps).toHaveLength(1);
      expect(gaps[0].sourceType).toBe('grafana');
      expect(gaps[0].sourceId).toBe('grafana-instance-1');
      expect(gaps[0].missingRanges).toHaveLength(2); // Gap between ranges + gap at end
    });

    it('should include failed ranges with retries remaining', async () => {
      const testRun = {
        testRunId: 'test-run-1',
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
      } as any;

      const collectionStatus: Partial<DsMetricCollectionStatus> = {
        test_run_id: 'test-run-1',
        source_type: 'grafana',
        source_id: 'grafana-instance-1',
        collected_ranges: [],
        failed_ranges: [
          {
            from: new Date('2024-01-01T10:00:00Z'),
            to: new Date('2024-01-01T10:30:00Z'),
            attempts: 2,
            lastError: 'Timeout error',
          },
          {
            from: new Date('2024-01-01T10:30:00Z'),
            to: new Date('2024-01-01T11:00:00Z'),
            attempts: 5, // Max retries exceeded
            lastError: 'Persistent error',
          },
        ],
        is_complete: false,
      };

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        collectionStatus as DsMetricCollectionStatus,
      ]);

      const gaps = await service.detectGaps('test-run-1');

      expect(gaps).toHaveLength(1);
      expect(gaps[0].failedRanges).toHaveLength(1); // Only the one with attempts < 5
      expect(gaps[0].failedRanges[0].attempts).toBe(2);
    });
  });

  describe('isCollectionComplete', () => {
    it('should return false when no collection statuses exist', async () => {
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([]);

      const result = await service.isCollectionComplete('test-run-1');

      expect(result).toBe(false);
    });

    it('should return false when some statuses are incomplete', async () => {
      const statuses: Partial<DsMetricCollectionStatus>[] = [
        { is_complete: true } as any,
        { is_complete: false } as any,
      ];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue(
        statuses as DsMetricCollectionStatus[]
      );

      const result = await service.isCollectionComplete('test-run-1');

      expect(result).toBe(false);
    });

    it('should return true when all statuses are complete', async () => {
      const statuses: Partial<DsMetricCollectionStatus>[] = [
        { is_complete: true } as any,
        { is_complete: true } as any,
      ];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue(
        statuses as DsMetricCollectionStatus[]
      );

      const result = await service.isCollectionComplete('test-run-1');

      expect(result).toBe(true);
    });
  });

  describe('getIncompleteSources', () => {
    it('should return incomplete sources with details', async () => {
      const incompleteStatuses: Partial<DsMetricCollectionStatus>[] = [
        {
          source_type: 'grafana',
          source_id: 'grafana-1',
          failed_ranges: [
            {
              from: new Date('2024-01-01T10:00:00Z'),
              to: new Date('2024-01-01T10:30:00Z'),
              attempts: 3,
              lastError: 'Connection timeout',
            },
          ],
          last_collected_at: new Date('2024-01-01T09:00:00Z'),
        } as any,
      ];

      mockDatabaseService.getIncompleteCollectionStatuses.mockResolvedValue(
        incompleteStatuses as DsMetricCollectionStatus[]
      );

      const result = await service.getIncompleteSources('test-run-1');

      expect(result).toHaveLength(1);
      expect(result[0].sourceType).toBe('grafana');
      expect(result[0].sourceId).toBe('grafana-1');
      expect(result[0].failedRanges).toHaveLength(1);
    });
  });

  describe('markSourceComplete', () => {
    it('should mark collection as complete', async () => {
      await service.markSourceComplete('test-run-1', 'grafana', 'grafana-1');

      expect(mockDatabaseService.markCollectionComplete).toHaveBeenCalledWith(
        'test-run-1',
        'grafana',
        'grafana-1'
      );
    });
  });

  describe('calculateCoverage', () => {
    it('should return 0 when test run not found', async () => {
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(null);

      const coverage = await service.calculateCoverage('test-run-1');

      expect(coverage).toBe(0);
    });

    it('should return 0 when no collection statuses exist', async () => {
      const testRun = {
        testRunId: 'test-run-1',
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'),
      } as any;

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([]);

      const coverage = await service.calculateCoverage('test-run-1');

      expect(coverage).toBe(0);
    });

    it('should calculate coverage percentage correctly', async () => {
      const testRun = {
        testRunId: 'test-run-1',
        startTime: new Date('2024-01-01T10:00:00Z'),
        endTime: new Date('2024-01-01T11:00:00Z'), // 1 hour = 3600000ms
      } as any;

      const collectionStatus: Partial<DsMetricCollectionStatus> = {
        test_run_id: 'test-run-1',
        source_type: 'grafana',
        source_id: 'grafana-instance-1',
        collected_ranges: [
          {
            from: new Date('2024-01-01T10:00:00Z'),
            to: new Date('2024-01-01T10:30:00Z'), // 30 minutes
          },
        ],
        failed_ranges: [],
        is_complete: false,
      };

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(testRun);
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        collectionStatus as DsMetricCollectionStatus,
      ]);

      const coverage = await service.calculateCoverage('test-run-1');

      // 30 minutes out of 60 minutes = 50%
      expect(coverage).toBe(50);
    });
  });
});
