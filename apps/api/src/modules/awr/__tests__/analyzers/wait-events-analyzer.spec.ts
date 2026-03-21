/**
 * Unit tests for WaitEventsAnalyzer
 *
 * Tests for analyzing wait events from AWR reports:
 * - High DB time wait events
 * - I/O wait events
 * - Lock contention events
 * - Commit wait events
 * - High average wait time events
 * - Timeout issues
 */

import { WaitEventsAnalyzer } from '../../analyzers/wait-events-analyzer';
import { DEFAULT_AWR_ANALYSIS_CONFIG, createAwrAnalysisConfig } from '../../config/awr-analysis.config';
import type { ParsedAwrData, WaitEvents, WaitEvent } from '../../types/awr-data.types';
import type { AwrInsight } from '../../types/insights.types';

describe('WaitEventsAnalyzer', () => {
  let analyzer: WaitEventsAnalyzer;

  beforeEach(() => {
    analyzer = new WaitEventsAnalyzer(DEFAULT_AWR_ANALYSIS_CONFIG);
  });

  describe('getName', () => {
    it('should return "WaitEventsAnalyzer"', () => {
      expect(analyzer.getName()).toBe('WaitEventsAnalyzer');
    });
  });

  describe('getCategory', () => {
    it('should return "wait_events"', () => {
      expect(analyzer.getCategory()).toBe('wait_events');
    });
  });

  describe('analyze', () => {
    describe('no data scenarios', () => {
      it('should return empty array for empty data', () => {
        const data: ParsedAwrData = {};
        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });

      it('should return empty array when waitEvents is undefined', () => {
        const data: ParsedAwrData = { waitEvents: undefined };
        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });

      it('should return empty array when waitEvents has no events', () => {
        const data: ParsedAwrData = { waitEvents: {} };
        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });
    });

    describe('high DB time wait events', () => {
      it('should generate insight for wait event above minDbTimePercent', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'db file sequential read',
            percentDbTime: 10, // Above default threshold of 5%
            waits: 10000,
            totalWaitTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        expect(insights.length).toBeGreaterThan(0);
        const insight = insights.find(i => i.waitEvent === 'db file sequential read');
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('wait_events');
        expect(insight?.tags).toContain('high-db-time');
      });

      it('should generate critical severity for very high DB time', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'critical wait',
            percentDbTime: 20, // Above criticalDbTimePercent of 15%
            waits: 5000,
            totalWaitTime: 100,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-db-time'));
        expect(insight?.severity).toBe('critical');
      });

      it('should generate warning severity for moderate DB time', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'warning wait',
            percentDbTime: 12, // Above minDbTimePercent*2 (10%)
            waits: 3000,
            totalWaitTime: 60,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-db-time'));
        expect(insight?.severity).toBe('warning');
      });

      it('should generate info severity for low DB time', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'info wait',
            percentDbTime: 6, // Just above threshold
            waits: 1000,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-db-time'));
        expect(insight?.severity).toBe('info');
      });

      it('should not generate insight below threshold', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'below threshold',
            percentDbTime: 2, // Below threshold
            waits: 100,
            totalWaitTime: 1,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'below threshold' && i.tags?.includes('high-db-time'));
        expect(insight).toBeUndefined();
      });
    });

    describe('I/O wait events', () => {
      it('should identify db file sequential read as I/O wait', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'db file sequential read',
            percentDbTime: 15,
            waits: 5000,
            totalWaitTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('io-wait'));
        expect(insight).toBeDefined();
        expect(insight?.waitEvent).toBe('db file sequential read');
      });

      it('should identify db file scattered read as I/O wait', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'db file scattered read',
            percentDbTime: 12,
            waits: 3000,
            totalWaitTime: 40,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('io-wait'));
        expect(insight).toBeDefined();
      });

      it('should identify direct path read as I/O wait', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'direct path read',
            percentDbTime: 11,
            waits: 2000,
            totalWaitTime: 30,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('io-wait'));
        expect(insight).toBeDefined();
      });

      it('should include specific I/O recommendations', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'db file sequential read',
            percentDbTime: 15,
            waits: 5000,
            totalWaitTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('io-wait'));
        expect(insight?.recommendation).toContain('index');
      });
    });

    describe('lock contention events', () => {
      it('should identify row lock contention', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'enq: TX - row lock contention',
            percentDbTime: 8,
            waits: 1000,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('lock-contention'));
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('lock_contention');
      });

      it('should identify TM contention', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'enq: TM - contention',
            percentDbTime: 6,
            waits: 500,
            totalWaitTime: 15,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('lock-contention'));
        expect(insight).toBeDefined();
      });

      it('should identify library cache lock', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'library cache lock',
            percentDbTime: 7,
            waits: 800,
            totalWaitTime: 18,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('lock-contention'));
        expect(insight).toBeDefined();
      });

      it('should identify buffer busy waits', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'buffer busy waits',
            percentDbTime: 6,
            waits: 600,
            totalWaitTime: 12,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('lock-contention'));
        expect(insight).toBeDefined();
      });

      it('should generate critical severity for high lock contention', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'enq: TX - row lock contention',
            percentDbTime: 15,
            waits: 5000,
            totalWaitTime: 100,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('lock-contention'));
        expect(insight?.severity).toBe('critical');
      });
    });

    describe('commit wait events', () => {
      it('should identify log file sync as commit wait', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'log file sync',
            percentDbTime: 12,
            waits: 2000,
            totalWaitTime: 25,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('commit-wait'));
        expect(insight).toBeDefined();
        expect(insight?.waitClass).toBe('Commit');
      });

      it('should identify log file parallel write as commit wait', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'log file parallel write',
            percentDbTime: 11,
            waits: 1500,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('commit-wait'));
        expect(insight).toBeDefined();
      });

      it('should identify log buffer space as commit wait', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'log buffer space',
            percentDbTime: 10,
            waits: 1000,
            totalWaitTime: 15,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('commit-wait'));
        expect(insight).toBeDefined();
      });

      it('should include commit-specific recommendations', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'log file sync',
            percentDbTime: 12,
            waits: 2000,
            totalWaitTime: 25,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('commit-wait'));
        expect(insight?.recommendation).toContain('log');
      });
    });

    describe('high average wait time', () => {
      it('should identify events with high average wait time', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'slow wait event',
            percentDbTime: 3,
            waits: 100,
            totalWaitTime: 10,
            avgWaitMs: 100, // Above default threshold of 50ms
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-avg-wait'));
        expect(insight).toBeDefined();
        expect(insight?.value).toBe(100);
        expect(insight?.unit).toBe('ms');
      });

      it('should calculate avg wait time if not provided', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'calculated wait',
            percentDbTime: 3,
            waits: 100,
            totalWaitTime: 10, // 10 seconds / 100 waits = 100ms avg
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-avg-wait'));
        expect(insight).toBeDefined();
      });

      it('should not flag events with low average wait time', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'fast wait event',
            percentDbTime: 3,
            waits: 10000,
            totalWaitTime: 10,
            avgWaitMs: 1,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'fast wait event' && i.tags?.includes('high-avg-wait'));
        expect(insight).toBeUndefined();
      });
    });

    describe('timeout issues', () => {
      it('should identify events with high timeout rate', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'timeout event',
            percentDbTime: 5,
            waits: 1000,
            timeouts: 200, // 20% timeout rate
            totalWaitTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-timeout'));
        expect(insight).toBeDefined();
        expect(insight?.value).toBeCloseTo(20, 2);
        expect(insight?.unit).toBe('%');
      });

      it('should not flag events with low timeout rate', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'low timeout event',
            percentDbTime: 5,
            waits: 1000,
            timeouts: 50, // 5% timeout rate
            totalWaitTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'low timeout event' && i.tags?.includes('high-timeout'));
        expect(insight).toBeUndefined();
      });

      it('should handle zero waits', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'zero waits event',
            percentDbTime: 5,
            waits: 0,
            timeouts: 0,
            totalWaitTime: 0,
          }),
        ]);

        expect(() => analyzer.analyze(data)).not.toThrow();
      });
    });

    describe('wait class detection', () => {
      it('should detect User I/O wait class', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'db file sequential read',
            percentDbTime: 15,
            waits: 1000,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'db file sequential read');
        expect(insight?.waitClass).toBe('User I/O');
      });

      it('should detect Commit wait class', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'log file sync',
            percentDbTime: 15,
            waits: 1000,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'log file sync');
        expect(insight?.waitClass).toBe('Commit');
      });

      it('should detect Concurrency wait class', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'latch: shared pool',
            percentDbTime: 8,
            waits: 500,
            totalWaitTime: 10,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent?.includes('latch'));
        expect(insight?.waitClass).toBe('Concurrency');
      });

      it('should detect Network wait class', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'SQL*Net message from client',
            percentDbTime: 10,
            waits: 5000,
            totalWaitTime: 30,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent?.includes('SQL*Net'));
        expect(insight?.waitClass).toBe('Network');
      });

      it('should use provided wait class if available', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'custom event',
            waitClass: 'Application',
            percentDbTime: 10,
            waits: 500,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'custom event');
        expect(insight?.waitClass).toBe('Application');
      });
    });

    describe('combining foreground and top events', () => {
      it('should analyze events from foreground array', () => {
        const data: ParsedAwrData = {
          waitEvents: {
            foreground: [
              createWaitEvent({
                event: 'foreground event',
                percentDbTime: 10,
                waits: 1000,
                totalWaitTime: 20,
              }),
            ],
          },
        };

        const insights = analyzer.analyze(data);

        expect(insights.find(i => i.waitEvent === 'foreground event')).toBeDefined();
      });

      it('should analyze events from topEvents array', () => {
        const data: ParsedAwrData = {
          waitEvents: {
            topEvents: [
              createWaitEvent({
                event: 'top event',
                percentDbTime: 10,
                waits: 1000,
                totalWaitTime: 20,
              }),
            ],
          },
        };

        const insights = analyzer.analyze(data);

        expect(insights.find(i => i.waitEvent === 'top event')).toBeDefined();
      });

      it('should avoid duplicate analysis of same event', () => {
        const data: ParsedAwrData = {
          waitEvents: {
            foreground: [
              createWaitEvent({
                event: 'duplicate event',
                percentDbTime: 10,
                waits: 1000,
                totalWaitTime: 20,
              }),
            ],
            topEvents: [
              createWaitEvent({
                event: 'duplicate event',
                percentDbTime: 10,
                waits: 1000,
                totalWaitTime: 20,
              }),
            ],
          },
        };

        const insights = analyzer.analyze(data);

        const dbTimeInsights = insights.filter(
          i => i.waitEvent === 'duplicate event' && i.tags?.includes('high-db-time')
        );
        // Should only have one high-db-time insight for this event
        expect(dbTimeInsights.length).toBe(1);
      });
    });

    describe('insight content', () => {
      it('should include wait event in title', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'test wait event',
            percentDbTime: 10,
            waits: 1000,
            totalWaitTime: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'test wait event');
        expect(insight?.title).toContain('test wait event');
      });

      it('should include total wait time in description', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'time test event',
            percentDbTime: 10,
            waits: 1000,
            totalWaitTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'time test event');
        expect(insight?.description).toBeDefined();
      });

      it('should include impact score', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'impact event',
            percentDbTime: 15,
            waits: 2000,
            totalWaitTime: 40,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'impact event');
        expect(insight?.impactScore).toBeDefined();
        expect(insight?.impactScore).toBeGreaterThan(0);
      });

      it('should include metadata with raw values', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'metadata event',
            percentDbTime: 10,
            waits: 1000,
            totalWaitTime: 20,
            avgWaitMs: 20,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'metadata event');
        expect(insight?.metadata?.rawValues).toBeDefined();
      });
    });

    describe('sorting', () => {
      it('should sort insights by impact score descending', () => {
        const data = createParsedAwrData([
          createWaitEvent({ event: 'low', percentDbTime: 6, waits: 100, totalWaitTime: 5 }),
          createWaitEvent({ event: 'high', percentDbTime: 20, waits: 5000, totalWaitTime: 100 }),
          createWaitEvent({ event: 'med', percentDbTime: 12, waits: 1000, totalWaitTime: 30 }),
        ]);

        const insights = analyzer.analyze(data);
        const dbTimeInsights = insights.filter(i => i.tags?.includes('high-db-time'));

        if (dbTimeInsights.length >= 2) {
          const firstScore = dbTimeInsights[0]?.impactScore ?? 0;
          const secondScore = dbTimeInsights[1]?.impactScore ?? 0;
          expect(firstScore).toBeGreaterThanOrEqual(secondScore);
        }
      });
    });

    describe('custom configuration', () => {
      it('should respect custom thresholds', () => {
        const customConfig = createAwrAnalysisConfig({
          thresholds: {
            waitEvents: { minDbTimePercent: 1 },
          },
        });
        const customAnalyzer = new WaitEventsAnalyzer(customConfig);

        const data = createParsedAwrData([
          createWaitEvent({
            event: 'custom threshold event',
            percentDbTime: 2, // Would be below default threshold
            waits: 100,
            totalWaitTime: 1,
          }),
        ]);

        const insights = customAnalyzer.analyze(data);

        const insight = insights.find(i => i.waitEvent === 'custom threshold event');
        expect(insight).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should handle events with undefined percentDbTime', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'undefined percent',
            waits: 1000,
            totalWaitTime: 20,
          }),
        ]);

        expect(() => analyzer.analyze(data)).not.toThrow();
      });

      it('should handle events with zero waits', () => {
        const data = createParsedAwrData([
          createWaitEvent({
            event: 'zero waits',
            percentDbTime: 10,
            waits: 0,
            totalWaitTime: 0,
          }),
        ]);

        expect(() => analyzer.analyze(data)).not.toThrow();
      });

      it('should handle empty foreground array', () => {
        const data: ParsedAwrData = {
          waitEvents: { foreground: [] },
        };

        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });
    });
  });
});

// ==================== Test Helpers ====================

interface WaitEventInput {
  event: string;
  waitClass?: string;
  waits: number;
  timeouts?: number;
  totalWaitTime: number;
  avgWaitMs?: number;
  percentDbTime?: number;
  percentWaitTime?: number;
}

/**
 * Create a wait event with defaults
 */
function createWaitEvent(input: WaitEventInput): WaitEvent {
  return {
    event: input.event,
    waitClass: input.waitClass,
    waits: input.waits,
    timeouts: input.timeouts,
    totalWaitTime: input.totalWaitTime,
    avgWaitMs: input.avgWaitMs,
    percentDbTime: input.percentDbTime,
    percentWaitTime: input.percentWaitTime,
  };
}

/**
 * Create parsed AWR data with wait events in foreground
 */
function createParsedAwrData(events: WaitEvent[]): ParsedAwrData {
  return {
    waitEvents: {
      foreground: events,
    },
  };
}
