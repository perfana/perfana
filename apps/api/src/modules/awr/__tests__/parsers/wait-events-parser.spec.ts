/**
 * Unit tests for WaitEventsParser
 *
 * Tests for parsing AWR report Wait Events sections:
 * - Foreground wait events
 * - Background wait events
 * - Wait class detection
 * - Grouping by wait class
 * - Total wait time calculation
 */

import { WaitEventsParser } from '../../parsers/sections/wait-events-parser';
import type { WaitEvents, WaitEvent } from '../../types/awr-data.types';

describe('WaitEventsParser', () => {
  let parser: WaitEventsParser;

  beforeEach(() => {
    parser = new WaitEventsParser();
  });

  describe('getSectionName', () => {
    it('should return "Wait Events"', () => {
      expect(parser.getSectionName()).toBe('Wait Events');
    });
  });

  describe('parse', () => {
    describe('basic functionality', () => {
      it('should return null for empty HTML', () => {
        const result = parser.parse('');
        expect(result).toBeNull();
      });

      it('should return null for HTML without wait events', () => {
        const html = '<html><body><p>No wait events here</p></body></html>';
        const result = parser.parse(html);
        expect(result).toBeNull();
      });

      it('should return null for table without event column', () => {
        const html = `
          <html><body>
            <table summary="Top 10 Foreground Events">
              <tr><th>Name</th><th>Value</th></tr>
              <tr><td>Test</td><td>123</td></tr>
            </table>
          </body></html>
        `;
        const result = parser.parse(html);
        expect(result).toBeNull();
      });
    });

    describe('foreground events parsing', () => {
      it('should parse foreground wait events', () => {
        const html = createWaitEventsHtml('foreground', [
          {
            event: 'db file sequential read',
            waits: '10000',
            totalWaitTime: '50.5',
            avgWaitMs: '5.05',
            percentDbTime: '15.2',
          },
          {
            event: 'log file sync',
            waits: '5000',
            totalWaitTime: '25.3',
            avgWaitMs: '5.06',
            percentDbTime: '7.6',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.foreground).toBeDefined();
        expect(result?.foreground?.length).toBe(2);
        expect(result?.foreground?.[0].event).toBe('db file sequential read');
        expect(result?.foreground?.[0].waits).toBe(10000);
      });

      it('should extract all foreground event fields', () => {
        const html = createWaitEventsHtml('foreground', [
          {
            event: 'db file scattered read',
            waitClass: 'User I/O',
            waits: '50000',
            timeouts: '100',
            totalWaitTime: '120.5',
            avgWaitMs: '2.41',
            percentDbTime: '25.5',
            percentWaitTime: '45.2',
          },
        ]);

        const result = parser.parse(html);
        const event = result?.foreground?.[0];

        expect(event).toBeDefined();
        expect(event?.event).toBe('db file scattered read');
        expect(event?.waitClass).toBe('User I/O');
        expect(event?.waits).toBe(50000);
        expect(event?.timeouts).toBe(100);
        expect(event?.totalWaitTime).toBeCloseTo(120.5, 2);
        expect(event?.avgWaitMs).toBeCloseTo(2.41, 2);
        expect(event?.percentDbTime).toBeCloseTo(25.5, 2);
        expect(event?.percentWaitTime).toBeCloseTo(45.2, 2);
      });
    });

    describe('background events parsing', () => {
      it('should parse background wait events', () => {
        const html = createWaitEventsHtml('background', [
          {
            event: 'db file parallel write',
            waits: '8000',
            totalWaitTime: '30.2',
          },
          {
            event: 'log file parallel write',
            waits: '6000',
            totalWaitTime: '20.1',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.background).toBeDefined();
        expect(result?.background?.length).toBe(2);
        expect(result?.background?.[0].event).toBe('db file parallel write');
      });
    });

    describe('wait class detection', () => {
      it('should detect User I/O wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'db file sequential read', waits: '100', totalWaitTime: '1' },
          { event: 'db file scattered read', waits: '100', totalWaitTime: '1' },
          { event: 'direct path read', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        result?.foreground?.forEach(event => {
          expect(event.waitClass).toBe('User I/O');
        });
      });

      it('should detect System I/O wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'db file parallel write', waits: '100', totalWaitTime: '1' },
          { event: 'log file parallel write', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        result?.foreground?.forEach(event => {
          expect(event.waitClass).toBe('System I/O');
        });
      });

      it('should detect Concurrency wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'latch: cache buffers chains', waits: '100', totalWaitTime: '1' },
          { event: 'enq: TX - row lock contention', waits: '100', totalWaitTime: '1' },
          { event: 'buffer busy waits', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        result?.foreground?.forEach(event => {
          expect(event.waitClass).toBe('Concurrency');
        });
      });

      it('should detect Commit wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'log file sync', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        expect(result?.foreground?.[0].waitClass).toBe('Commit');
      });

      it('should detect Network wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'SQL*Net message from client', waits: '100', totalWaitTime: '1' },
          { event: 'SQL*Net more data to client', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        result?.foreground?.forEach(event => {
          expect(event.waitClass).toBe('Network');
        });
      });

      it('should detect Cluster wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'gc buffer busy acquire', waits: '100', totalWaitTime: '1' },
          { event: 'gc current block 2-way', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        result?.foreground?.forEach(event => {
          expect(event.waitClass).toBe('Cluster');
        });
      });

      it('should use provided wait class if available', () => {
        const html = createWaitEventsHtml('foreground', [
          {
            event: 'some custom event',
            waitClass: 'Application',
            waits: '100',
            totalWaitTime: '1',
          },
        ]);

        const result = parser.parse(html);

        expect(result?.foreground?.[0].waitClass).toBe('Application');
      });
    });

    describe('grouping by class', () => {
      it('should group events by wait class', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'db file sequential read', waits: '1000', totalWaitTime: '10' },
          { event: 'db file scattered read', waits: '2000', totalWaitTime: '20' },
          { event: 'log file sync', waits: '500', totalWaitTime: '5' },
          { event: 'latch: cache buffers', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        expect(result?.byClass).toBeDefined();
        expect(result?.byClass?.['User I/O']).toBeDefined();
        expect(result?.byClass?.['User I/O']?.length).toBe(2);
        expect(result?.byClass?.['Commit']).toBeDefined();
        expect(result?.byClass?.['Commit']?.length).toBe(1);
        expect(result?.byClass?.['Concurrency']).toBeDefined();
      });

      it('should avoid duplicate events when grouping', () => {
        const html = `
          <html><body>
            ${createWaitEventsSection('foreground', [
              { event: 'db file sequential read', waits: '1000', totalWaitTime: '10' },
            ])}
            ${createWaitEventsSection('background', [
              { event: 'db file sequential read', waits: '500', totalWaitTime: '5' },
            ])}
          </body></html>
        `;

        const result = parser.parse(html);

        // Should only have one entry per unique event
        expect(result?.byClass?.['User I/O']?.length).toBe(1);
      });
    });

    describe('top events', () => {
      it('should populate topEvents from foreground events', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'event1', waits: '1000', totalWaitTime: '10' },
          { event: 'event2', waits: '2000', totalWaitTime: '20' },
        ]);

        const result = parser.parse(html);

        expect(result?.topEvents).toBeDefined();
        expect(result?.topEvents?.length).toBe(2);
      });
    });

    describe('total wait time calculation', () => {
      it('should calculate total wait time from foreground events', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'event1', waits: '100', totalWaitTime: '10' },
          { event: 'event2', waits: '200', totalWaitTime: '20' },
          { event: 'event3', waits: '300', totalWaitTime: '30' },
        ]);

        const result = parser.parse(html);

        expect(result?.totalWaitTime).toBeCloseTo(60, 2);
      });

      it('should prefer foreground events for total calculation', () => {
        const html = `
          <html><body>
            ${createWaitEventsSection('foreground', [
              { event: 'fg event', waits: '100', totalWaitTime: '10' },
            ])}
            ${createWaitEventsSection('background', [
              { event: 'bg event', waits: '100', totalWaitTime: '100' },
            ])}
          </body></html>
        `;

        const result = parser.parse(html);

        // Should only count foreground when available
        expect(result?.totalWaitTime).toBeCloseTo(10, 2);
      });
    });

    describe('number parsing', () => {
      it('should parse numbers with comma separators', () => {
        const html = createWaitEventsHtml('foreground', [
          {
            event: 'test event',
            waits: '1,000,000',
            totalWaitTime: '1,234.56',
          },
        ]);

        const result = parser.parse(html);

        expect(result?.foreground?.[0].waits).toBe(1000000);
        expect(result?.foreground?.[0].totalWaitTime).toBeCloseTo(1234.56, 2);
      });

      it('should parse percentage values', () => {
        const html = createWaitEventsHtml('foreground', [
          {
            event: 'test event',
            waits: '1000',
            totalWaitTime: '10',
            percentDbTime: '25.5%',
            percentWaitTime: '45.2%',
          },
        ]);

        const result = parser.parse(html);

        expect(result?.foreground?.[0].percentDbTime).toBeCloseTo(25.5, 2);
        expect(result?.foreground?.[0].percentWaitTime).toBeCloseTo(45.2, 2);
      });

      it('should handle zero values', () => {
        const html = createWaitEventsHtml('foreground', [
          {
            event: 'zero event',
            waits: '0',
            totalWaitTime: '0',
            timeouts: '0',
          },
        ]);

        const result = parser.parse(html);

        expect(result?.foreground?.[0].waits).toBe(0);
        expect(result?.foreground?.[0].totalWaitTime).toBe(0);
        expect(result?.foreground?.[0].timeouts).toBe(0);
      });
    });

    describe('column detection', () => {
      it('should detect columns from various header names', () => {
        const html = `
          <html><body>
            <table summary="Top 10 Foreground Events">
              <tr>
                <th>Event Name</th>
                <th>Wait Class</th>
                <th>Total Waits</th>
                <th>Time Outs</th>
                <th>Time (s)</th>
                <th>Avg Wait (ms)</th>
                <th>% DB Time</th>
              </tr>
              <tr>
                <td>test event</td>
                <td>User I/O</td>
                <td>1000</td>
                <td>5</td>
                <td>10.5</td>
                <td>10.5</td>
                <td>25.5</td>
              </tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.foreground?.[0].event).toBe('test event');
        expect(result?.foreground?.[0].waitClass).toBe('User I/O');
        expect(result?.foreground?.[0].waits).toBe(1000);
        expect(result?.foreground?.[0].timeouts).toBe(5);
        expect(result?.foreground?.[0].totalWaitTime).toBeCloseTo(10.5, 2);
        expect(result?.foreground?.[0].avgWaitMs).toBeCloseTo(10.5, 2);
        expect(result?.foreground?.[0].percentDbTime).toBeCloseTo(25.5, 2);
      });

      it('should handle waits per second column', () => {
        const html = `
          <html><body>
            <table summary="Top 10 Foreground Events">
              <tr>
                <th>Event</th>
                <th>Waits</th>
                <th>Total Time</th>
                <th>Waits/sec</th>
              </tr>
              <tr>
                <td>test event</td>
                <td>1000</td>
                <td>10</td>
                <td>16.7</td>
              </tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.foreground?.[0].waitsPerSecond).toBeCloseTo(16.7, 2);
      });
    });

    describe('table identification', () => {
      it('should find table by summary attribute', () => {
        const html = `
          <html><body>
            <table summary="Some other table">
              <tr><td>Ignore</td></tr>
            </table>
            <table summary="Top 10 Foreground Events">
              <tr><th>Event</th><th>Waits</th><th>Total Time</th></tr>
              <tr><td>found event</td><td>100</td><td>1</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.foreground?.[0].event).toBe('found event');
      });

      it('should find table after section heading', () => {
        const html = `
          <html><body>
            <h2>Top 10 Foreground Events</h2>
            <table>
              <tr><th>Event</th><th>Waits</th><th>Total Time</th></tr>
              <tr><td>heading event</td><td>100</td><td>1</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.foreground?.[0].event).toBe('heading event');
      });

      it('should try multiple foreground identifiers', () => {
        const identifiers = [
          'Top 10 Foreground Events',
          'Foreground Events',
          'Top Timed Foreground Events',
        ];

        for (const identifier of identifiers) {
          const html = `
            <html><body>
              <h2>${identifier}</h2>
              <table>
                <tr><th>Event</th><th>Waits</th><th>Total Time</th></tr>
                <tr><td>test event</td><td>100</td><td>1</td></tr>
              </table>
            </body></html>
          `;

          const result = parser.parse(html);
          expect(result?.foreground).toBeDefined();
        }
      });
    });

    describe('edge cases', () => {
      it('should skip header-like values in data rows', () => {
        const html = `
          <html><body>
            <table summary="Top 10 Foreground Events">
              <tr><th>Event</th><th>Waits</th><th>Total Time</th></tr>
              <tr><td>Event Name</td><td>-</td><td>-</td></tr>
              <tr><td>real event</td><td>100</td><td>1</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.foreground?.length).toBe(1);
        expect(result?.foreground?.[0].event).toBe('real event');
      });

      it('should handle empty event names', () => {
        const html = `
          <html><body>
            <table summary="Top 10 Foreground Events">
              <tr><th>Event</th><th>Waits</th><th>Total Time</th></tr>
              <tr><td></td><td>100</td><td>1</td></tr>
              <tr><td>valid event</td><td>200</td><td>2</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.foreground?.length).toBe(1);
        expect(result?.foreground?.[0].event).toBe('valid event');
      });

      it('should handle malformed HTML gracefully', () => {
        const html = '<html><body><table><tr><td>Event';

        expect(() => parser.parse(html)).not.toThrow();
      });

      it('should handle missing optional values', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'minimal event', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parse(html);

        expect(result?.foreground?.[0].event).toBe('minimal event');
        expect(result?.foreground?.[0].timeouts).toBeUndefined();
        expect(result?.foreground?.[0].avgWaitMs).toBeUndefined();
      });
    });

    describe('parseWithResult', () => {
      it('should return success result for valid wait events', () => {
        const html = createWaitEventsHtml('foreground', [
          { event: 'test event', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should return failure for missing wait events', () => {
        const html = '<html><body><p>No wait events</p></body></html>';

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.error).toBeDefined();
      });
    });

    describe('validation', () => {
      it('should validate at least one event exists', () => {
        const html = createWaitEventsHtml('foreground', []);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(false);
      });

      it('should pass validation with events in any section', () => {
        const html = createWaitEventsHtml('background', [
          { event: 'bg event', waits: '100', totalWaitTime: '1' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
      });
    });
  });
});

// ==================== Test Helpers ====================

interface WaitEventInput {
  event: string;
  waitClass?: string;
  waits: string;
  timeouts?: string;
  totalWaitTime: string;
  avgWaitMs?: string;
  percentDbTime?: string;
  percentWaitTime?: string;
  waitsPerSecond?: string;
}

type WaitEventSectionType = 'foreground' | 'background' | 'all';

/**
 * Create a single wait events section (table only, no HTML wrapper)
 */
function createWaitEventsSection(
  type: WaitEventSectionType,
  events: WaitEventInput[],
): string {
  const sectionTitles: Record<WaitEventSectionType, string> = {
    foreground: 'Top 10 Foreground Events',
    background: 'Background Wait Events',
    all: 'Wait Events',
  };

  const rows = events
    .map(
      e => `
        <tr>
          <td>${e.event}</td>
          <td>${e.waitClass ?? ''}</td>
          <td>${e.waits}</td>
          <td>${e.timeouts ?? ''}</td>
          <td>${e.totalWaitTime}</td>
          <td>${e.avgWaitMs ?? ''}</td>
          <td>${e.percentDbTime ?? ''}</td>
          <td>${e.percentWaitTime ?? ''}</td>
        </tr>
      `,
    )
    .join('\n');

  return `
    <h3>${sectionTitles[type]}</h3>
    <table summary="${sectionTitles[type]}">
      <tr>
        <th>Event</th>
        <th>Wait Class</th>
        <th>Waits</th>
        <th>Timeouts</th>
        <th>Total Wait Time</th>
        <th>Avg Wait (ms)</th>
        <th>% DB Time</th>
        <th>% Wait Time</th>
      </tr>
      ${rows}
    </table>
  `;
}

/**
 * Create complete wait events HTML
 */
function createWaitEventsHtml(
  type: WaitEventSectionType,
  events: WaitEventInput[],
): string {
  return `
    <html><body>
      ${createWaitEventsSection(type, events)}
    </body></html>
  `;
}
