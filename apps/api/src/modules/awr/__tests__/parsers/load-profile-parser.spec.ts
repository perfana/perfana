/**
 * Unit tests for LoadProfileParser
 *
 * Tests for parsing AWR report Load Profile section:
 * - Per-second metrics (DB Time, CPU, I/O, transactions)
 * - Per-transaction metrics
 * - Metric unit detection
 * - Various table formats
 */

import { LoadProfileParser } from '../../parsers/sections/load-profile-parser';
import type { LoadProfile } from '../../types/awr-data.types';

describe('LoadProfileParser', () => {
  let parser: LoadProfileParser;

  beforeEach(() => {
    parser = new LoadProfileParser();
  });

  describe('getSectionName', () => {
    it('should return "Load Profile"', () => {
      expect(parser.getSectionName()).toBe('Load Profile');
    });
  });

  describe('parse', () => {
    describe('basic functionality', () => {
      it('should return null for empty HTML', () => {
        const result = parser.parse('');
        expect(result).toBeNull();
      });

      it('should return null for HTML without Load Profile content', () => {
        const html = '<html><body><p>No load profile here</p></body></html>';
        const result = parser.parse(html);
        expect(result).toBeNull();
      });

      it('should return null for table with insufficient rows', () => {
        const html = `
          <html><body>
            <table summary="Load Profile">
              <tr><th>Statistic</th><th>Per Second</th><th>Per Transaction</th></tr>
            </table>
          </body></html>
        `;
        const result = parser.parse(html);
        expect(result).toBeNull();
      });
    });

    describe('standard Load Profile parsing', () => {
      it('should parse standard Load Profile table', () => {
        const html = createLoadProfileHtml([
          { name: 'DB Time(s)', perSecond: '2.5', perTransaction: '0.05' },
          { name: 'DB CPU(s)', perSecond: '1.2', perTransaction: '0.024' },
          { name: 'Redo size', perSecond: '125,000', perTransaction: '2,500' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.metrics).toBeDefined();
        expect(result?.metrics?.length).toBe(3);
      });

      it('should extract transactions per second', () => {
        const html = createLoadProfileHtml([
          { name: 'Transactions', perSecond: '50', perTransaction: '1' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.transactionsPerSecond).toBe(50);
      });

      it('should extract DB Time per second', () => {
        const html = createLoadProfileHtml([
          { name: 'DB Time(s)', perSecond: '3.75', perTransaction: '0.1' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.dbTimePerSecond).toBeCloseTo(3.75, 2);
      });

      it('should extract DB CPU per second', () => {
        const html = createLoadProfileHtml([
          { name: 'DB CPU(s)', perSecond: '1.5', perTransaction: '0.03' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.dbCpuPerSecond).toBeCloseTo(1.5, 2);
      });

      it('should extract logical reads per second', () => {
        const html = createLoadProfileHtml([
          { name: 'Logical reads', perSecond: '50000', perTransaction: '1000' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.logicalReadsPerSecond).toBe(50000);
      });

      it('should extract physical reads per second', () => {
        const html = createLoadProfileHtml([
          { name: 'Physical reads', perSecond: '500', perTransaction: '10' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.physicalReadsPerSecond).toBe(500);
      });

      it('should extract physical writes per second', () => {
        const html = createLoadProfileHtml([
          { name: 'Physical writes', perSecond: '100', perTransaction: '2' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.physicalWritesPerSecond).toBe(100);
      });

      it('should extract user calls per second', () => {
        const html = createLoadProfileHtml([
          { name: 'User calls', perSecond: '200', perTransaction: '4' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.userCallsPerSecond).toBe(200);
      });

      it('should extract parses per second', () => {
        const html = createLoadProfileHtml([
          { name: 'Parses', perSecond: '75', perTransaction: '1.5' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.parsesPerSecond).toBe(75);
      });

      it('should extract hard parses per second', () => {
        const html = createLoadProfileHtml([
          { name: 'Hard parses', perSecond: '5', perTransaction: '0.1' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.hardParsesPerSecond).toBe(5);
      });
    });

    describe('metric collection', () => {
      it('should collect all metrics in array', () => {
        const html = createLoadProfileHtml([
          { name: 'DB Time(s)', perSecond: '2', perTransaction: '0.04' },
          { name: 'DB CPU(s)', perSecond: '1', perTransaction: '0.02' },
          { name: 'Transactions', perSecond: '50', perTransaction: '1' },
          { name: 'Redo size', perSecond: '100000', perTransaction: '2000' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.metrics).toHaveLength(4);
        expect(result?.metrics?.[0].name).toBe('DB Time(s)');
        expect(result?.metrics?.[0].perSecond).toBe(2);
        expect(result?.metrics?.[0].perTransaction).toBe(0.04);
      });

      it('should detect units for metrics', () => {
        const html = createLoadProfileHtml([
          { name: 'DB Time(s)', perSecond: '2', perTransaction: '0.04' },
          { name: 'Redo size (bytes)', perSecond: '100000', perTransaction: '2000' },
          { name: 'Logical read (blocks)', perSecond: '5000', perTransaction: '100' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.metrics?.[0].unit).toBe('seconds');
        expect(result?.metrics?.[1].unit).toBe('bytes');
        expect(result?.metrics?.[2].unit).toBe('blocks');
      });
    });

    describe('number parsing', () => {
      it('should parse numbers with comma separators', () => {
        const html = createLoadProfileHtml([
          { name: 'Redo size', perSecond: '1,234,567', perTransaction: '24,691' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.redoSizePerSecond).toBe(1234567);
      });

      it('should parse decimal values', () => {
        const html = createLoadProfileHtml([
          { name: 'DB Time(s)', perSecond: '1.234', perTransaction: '0.025' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.dbTimePerSecond).toBeCloseTo(1.234, 2);
      });

      it('should handle zero values', () => {
        const html = createLoadProfileHtml([
          { name: 'Rollbacks', perSecond: '0', perTransaction: '0' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.rollbacksPerSecond).toBe(0);
      });

      it('should treat N/A values as zero and include in metrics', () => {
        const html = createLoadProfileHtml([
          { name: 'Valid metric', perSecond: '100', perTransaction: '2' },
          { name: 'N/A metric', perSecond: 'N/A', perTransaction: 'N/A' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        // N/A values are treated as 0, so both metrics are included
        expect(result?.metrics?.length).toBe(2);
        // The N/A metric should have 0 values
        const naMetric = result?.metrics?.find(m => m.name === 'N/A metric');
        expect(naMetric?.perSecond).toBe(0);
        expect(naMetric?.perTransaction).toBe(0);
      });
    });

    describe('alternate column layouts', () => {
      it('should detect columns by header text', () => {
        const html = `
          <html><body>
            <table summary="Load Profile">
              <tr>
                <th>Metric</th>
                <th>Rate Per Second</th>
                <th>Rate Per Trans</th>
              </tr>
              <tr>
                <td>Transactions</td>
                <td>50</td>
                <td>1</td>
              </tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
      });

      it('should handle /second and /trans column names', () => {
        const html = `
          <html><body>
            <table summary="Load Profile">
              <tr>
                <th>Statistic</th>
                <th>/second</th>
                <th>/trans</th>
              </tr>
              <tr>
                <td>DB Time(s)</td>
                <td>2.5</td>
                <td>0.05</td>
              </tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.dbTimePerSecond).toBeCloseTo(2.5, 2);
      });
    });

    describe('table identification', () => {
      it('should find table by summary attribute', () => {
        const html = `
          <html><body>
            <table summary="Some other table">
              <tr><td>Ignore</td></tr>
            </table>
            <table summary="Load Profile">
              <tr><th>Statistic</th><th>Per Second</th><th>Per Transaction</th></tr>
              <tr><td>Transactions</td><td>50</td><td>1</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.transactionsPerSecond).toBe(50);
      });

      it('should find table after section heading', () => {
        const html = `
          <html><body>
            <h2>Load Profile</h2>
            <table>
              <tr><th>Statistic</th><th>Per Second</th><th>Per Transaction</th></tr>
              <tr><td>DB Time(s)</td><td>3</td><td>0.06</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
      });

      it('should identify table by content when no explicit identifier', () => {
        const html = `
          <html><body>
            <table>
              <tr><th></th><th>Per Second</th><th>Per Transaction</th></tr>
              <tr><td>Redo size</td><td>50000</td><td>1000</td></tr>
              <tr><td>User calls</td><td>100</td><td>2</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
      });
    });

    describe('metric name matching', () => {
      it('should match various DB Time formats', () => {
        const variations = [
          'DB Time(s)',
          'DB Time (s)',
          'DB Time',
        ];

        for (const name of variations) {
          const html = createLoadProfileHtml([
            { name, perSecond: '2', perTransaction: '0.04' },
          ]);

          const result = parser.parse(html);
          expect(result?.dbTimePerSecond).toBe(2);
        }
      });

      it('should match various DB CPU formats', () => {
        const variations = [
          'DB CPU(s)',
          'DB CPU (s)',
          'DB CPU',
        ];

        for (const name of variations) {
          const html = createLoadProfileHtml([
            { name, perSecond: '1.5', perTransaction: '0.03' },
          ]);

          const result = parser.parse(html);
          expect(result?.dbCpuPerSecond).toBeCloseTo(1.5, 2);
        }
      });
    });

    describe('edge cases', () => {
      it('should handle empty metric names', () => {
        const html = `
          <html><body>
            <table summary="Load Profile">
              <tr><th>Statistic</th><th>Per Second</th><th>Per Transaction</th></tr>
              <tr><td></td><td>100</td><td>2</td></tr>
              <tr><td>Transactions</td><td>50</td><td>1</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        // Empty name rows should be skipped
        expect(result?.metrics?.every(m => m.name.length > 0)).toBe(true);
      });

      it('should skip header rows in data section', () => {
        const html = `
          <html><body>
            <table summary="Load Profile">
              <tr><th>Statistic</th><th>Per Second</th><th>Per Transaction</th></tr>
              <tr><td>Per Second</td><td></td><td></td></tr>
              <tr><td>Transactions</td><td>50</td><td>1</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.metrics?.find(m => m.name === 'Per Second')).toBeUndefined();
      });

      it('should handle malformed HTML', () => {
        const html = '<html><body><table><tr><td>Load Profile';

        expect(() => parser.parse(html)).not.toThrow();
      });
    });

    describe('parseWithResult', () => {
      it('should return success result for valid Load Profile', () => {
        const html = createLoadProfileHtml([
          { name: 'Transactions', perSecond: '50', perTransaction: '1' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should return failure for missing Load Profile', () => {
        const html = '<html><body><p>No data</p></body></html>';

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.error).toBeDefined();
      });
    });

    describe('validation', () => {
      it('should validate presence of metrics array', () => {
        const html = createLoadProfileHtml([
          { name: 'Transactions', perSecond: '50', perTransaction: '1' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
      });

      it('should consider valid if transactions metric present', () => {
        const html = createLoadProfileHtml([
          { name: 'Transactions', perSecond: '100', perTransaction: '1' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
        expect(result.data?.transactionsPerSecond).toBe(100);
      });
    });
  });
});

// ==================== Test Helpers ====================

interface LoadProfileMetricInput {
  name: string;
  perSecond: string;
  perTransaction: string;
}

/**
 * Create Load Profile HTML table with specified metrics
 */
function createLoadProfileHtml(metrics: LoadProfileMetricInput[]): string {
  const rows = metrics
    .map(
      m => `<tr><td>${m.name}</td><td>${m.perSecond}</td><td>${m.perTransaction}</td></tr>`,
    )
    .join('\n');

  return `
    <html><body>
      <h2>Load Profile</h2>
      <table summary="Load Profile">
        <tr>
          <th>Statistic</th>
          <th>Per Second</th>
          <th>Per Transaction</th>
        </tr>
        ${rows}
      </table>
    </body></html>
  `;
}
