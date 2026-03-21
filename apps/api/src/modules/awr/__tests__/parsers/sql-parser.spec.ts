/**
 * Unit tests for SqlParser
 *
 * Tests for parsing AWR report Top SQL sections:
 * - SQL ordered by Elapsed Time
 * - SQL ordered by CPU Time
 * - SQL ordered by Buffer Gets
 * - SQL ordered by Disk Reads
 * - SQL ordered by Executions
 * - SQL text extraction
 * - Rankings
 */

import { SqlParser } from '../../parsers/sections/sql-parser';
import type { TopSql, SqlStatement } from '../../types/awr-data.types';

describe('SqlParser', () => {
  let parser: SqlParser;

  beforeEach(() => {
    parser = new SqlParser();
  });

  describe('getSectionName', () => {
    it('should return "Top SQL"', () => {
      expect(parser.getSectionName()).toBe('Top SQL');
    });
  });

  describe('parse', () => {
    describe('basic functionality', () => {
      it('should return null for empty HTML', () => {
        const result = parser.parse('');
        expect(result).toBeNull();
      });

      it('should return null for HTML without SQL content', () => {
        const html = '<html><body><p>No SQL data here</p></body></html>';
        const result = parser.parse(html);
        expect(result).toBeNull();
      });

      it('should return null for table without SQL ID column', () => {
        const html = `
          <html><body>
            <table summary="SQL ordered by Elapsed Time">
              <tr><th>Name</th><th>Value</th></tr>
              <tr><td>Test</td><td>123</td></tr>
            </table>
          </body></html>
        `;
        const result = parser.parse(html);
        expect(result).toBeNull();
      });
    });

    describe('SQL by Elapsed Time', () => {
      it('should parse SQL ordered by elapsed time', () => {
        const html = createSqlSectionHtml('elapsed', [
          {
            sqlId: 'abc123def456',
            elapsedTime: '120.5',
            cpuTime: '80.2',
            executions: '1000',
            bufferGets: '50000',
          },
          {
            sqlId: 'xyz789ghi012',
            elapsedTime: '90.3',
            cpuTime: '60.1',
            executions: '500',
            bufferGets: '30000',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byElapsedTime).toBeDefined();
        expect(result?.byElapsedTime?.length).toBe(2);
        expect(result?.byElapsedTime?.[0].sqlId).toBe('abc123def456');
        expect(result?.byElapsedTime?.[0].elapsedTime).toBeCloseTo(120.5, 2);
      });

      it('should extract all statement fields', () => {
        const html = createSqlSectionHtml('elapsed', [
          {
            sqlId: 'testid123',
            elapsedTime: '100',
            cpuTime: '75',
            executions: '200',
            bufferGets: '10000',
            diskReads: '500',
            rowsProcessed: '5000',
            percentDbTime: '25.5',
          },
        ]);

        const result = parser.parse(html);
        const stmt = result?.byElapsedTime?.[0];

        expect(stmt).toBeDefined();
        expect(stmt?.sqlId).toBe('testid123');
        expect(stmt?.elapsedTime).toBe(100);
        expect(stmt?.cpuTime).toBe(75);
        expect(stmt?.executions).toBe(200);
        expect(stmt?.bufferGets).toBe(10000);
        expect(stmt?.diskReads).toBe(500);
        expect(stmt?.rowsProcessed).toBe(5000);
        expect(stmt?.percentDbTime).toBeCloseTo(25.5, 2);
      });
    });

    describe('SQL by CPU Time', () => {
      it('should parse SQL ordered by CPU time', () => {
        const html = createSqlSectionHtml('cpu', [
          {
            sqlId: 'cpusql001',
            cpuTime: '150.5',
            executions: '300',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byCpuTime).toBeDefined();
        expect(result?.byCpuTime?.[0].sqlId).toBe('cpusql001');
        expect(result?.byCpuTime?.[0].cpuTime).toBeCloseTo(150.5, 2);
      });
    });

    describe('SQL by Buffer Gets', () => {
      it('should parse SQL ordered by buffer gets', () => {
        const html = createSqlSectionHtml('gets', [
          {
            sqlId: 'buffsql001',
            bufferGets: '1000000',
            executions: '100',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byBufferGets).toBeDefined();
        expect(result?.byBufferGets?.[0].sqlId).toBe('buffsql001');
        expect(result?.byBufferGets?.[0].bufferGets).toBe(1000000);
      });
    });

    describe('SQL by Disk Reads', () => {
      it('should parse SQL ordered by disk reads', () => {
        const html = createSqlSectionHtml('reads', [
          {
            sqlId: 'readsql001',
            diskReads: '50000',
            executions: '50',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byDiskReads).toBeDefined();
        expect(result?.byDiskReads?.[0].sqlId).toBe('readsql001');
        expect(result?.byDiskReads?.[0].diskReads).toBe(50000);
      });
    });

    describe('SQL by Executions', () => {
      it('should parse SQL ordered by executions', () => {
        const html = createSqlSectionHtml('executions', [
          {
            sqlId: 'execsql001',
            executions: '100000',
          },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byExecutions).toBeDefined();
        expect(result?.byExecutions?.[0].sqlId).toBe('execsql001');
        expect(result?.byExecutions?.[0].executions).toBe(100000);
      });
    });

    describe('SQL text extraction', () => {
      it('should extract SQL text from separate section', () => {
        const html = createSqlWithTextHtml([
          { sqlId: 'sql001', sqlText: 'SELECT * FROM users WHERE id = :1' },
          { sqlId: 'sql002', sqlText: 'UPDATE orders SET status = :1' },
        ]);

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.sqlTextById).toBeDefined();
        expect(result?.sqlTextById?.['sql001']).toBe(
          'SELECT * FROM users WHERE id = :1',
        );
        expect(result?.sqlTextById?.['sql002']).toBe(
          'UPDATE orders SET status = :1',
        );
      });

      it('should enrich SQL statements with full text', () => {
        const html = createFullSqlHtml(
          [{ sqlId: 'enrich001', elapsedTime: '10' }],
          [{ sqlId: 'enrich001', sqlText: 'SELECT COUNT(*) FROM large_table' }],
        );

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byElapsedTime?.[0].fullSqlText).toBe(
          'SELECT COUNT(*) FROM large_table',
        );
      });
    });

    describe('rankings', () => {
      it('should add rank by elapsed time', () => {
        const html = createSqlSectionHtml('elapsed', [
          { sqlId: 'first', elapsedTime: '100' },
          { sqlId: 'second', elapsedTime: '80' },
          { sqlId: 'third', elapsedTime: '60' },
        ]);

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.[0].rankByElapsedTime).toBe(1);
        expect(result?.byElapsedTime?.[1].rankByElapsedTime).toBe(2);
        expect(result?.byElapsedTime?.[2].rankByElapsedTime).toBe(3);
      });

      it('should add rank by CPU time', () => {
        const html = createSqlSectionHtml('cpu', [
          { sqlId: 'cpufirst', cpuTime: '50' },
          { sqlId: 'cpusecond', cpuTime: '40' },
        ]);

        const result = parser.parse(html);

        expect(result?.byCpuTime?.[0].rankByCpuTime).toBe(1);
        expect(result?.byCpuTime?.[1].rankByCpuTime).toBe(2);
      });

      it('should add rank by buffer gets', () => {
        const html = createSqlSectionHtml('gets', [
          { sqlId: 'getsfirst', bufferGets: '100000' },
          { sqlId: 'getssecond', bufferGets: '50000' },
        ]);

        const result = parser.parse(html);

        expect(result?.byBufferGets?.[0].rankByBufferGets).toBe(1);
        expect(result?.byBufferGets?.[1].rankByBufferGets).toBe(2);
      });
    });

    describe('multiple sections', () => {
      it('should parse multiple SQL sections from same HTML', () => {
        const html = createMultiSectionSqlHtml();

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.byElapsedTime).toBeDefined();
        expect(result?.byCpuTime).toBeDefined();
        expect(result?.byBufferGets).toBeDefined();
      });
    });

    describe('number parsing', () => {
      it('should parse numbers with comma separators', () => {
        const html = createSqlSectionHtml('elapsed', [
          {
            sqlId: 'comma001',
            bufferGets: '1,234,567',
            diskReads: '10,000',
          },
        ]);

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.[0].bufferGets).toBe(1234567);
        expect(result?.byElapsedTime?.[0].diskReads).toBe(10000);
      });

      it('should parse percentage values', () => {
        const html = createSqlSectionHtml('elapsed', [
          {
            sqlId: 'pct001',
            percentDbTime: '45.5%',
            percentCpu: '30.2%',
          },
        ]);

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.[0].percentDbTime).toBeCloseTo(45.5, 2);
        expect(result?.byElapsedTime?.[0].percentCpu).toBeCloseTo(30.2, 2);
      });

      it('should handle time values with different formats', () => {
        const html = createSqlSectionHtml('elapsed', [
          { sqlId: 'time001', elapsedTime: '120', cpuTime: '90.5' },
        ]);

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.[0].elapsedTime).toBe(120);
        expect(result?.byElapsedTime?.[0].cpuTime).toBeCloseTo(90.5, 2);
      });
    });

    describe('column detection', () => {
      it('should detect columns from various header names', () => {
        const html = `
          <html><body>
            <table summary="SQL ordered by Elapsed Time">
              <tr>
                <th>SQLID</th>
                <th>Elapsed Time (s)</th>
                <th>CPU Time (s)</th>
                <th>Execs</th>
                <th>Gets</th>
              </tr>
              <tr>
                <td>detect001</td>
                <td>100</td>
                <td>75</td>
                <td>500</td>
                <td>10000</td>
              </tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.[0].sqlId).toBe('detect001');
        expect(result?.byElapsedTime?.[0].elapsedTime).toBe(100);
        expect(result?.byElapsedTime?.[0].cpuTime).toBe(75);
        expect(result?.byElapsedTime?.[0].executions).toBe(500);
        expect(result?.byElapsedTime?.[0].bufferGets).toBe(10000);
      });

      it('should handle SQL ID variations', () => {
        const variations = ['SQL ID', 'SQLID', 'sql id', 'sql_id'];

        for (const header of variations) {
          const html = `
            <html><body>
              <table summary="SQL ordered by Elapsed Time">
                <tr><th>${header}</th><th>Elapsed Time</th></tr>
                <tr><td>test123</td><td>100</td></tr>
              </table>
            </body></html>
          `;

          const result = parser.parse(html);
          expect(result?.byElapsedTime?.[0].sqlId).toBe('test123');
        }
      });
    });

    describe('edge cases', () => {
      it('should skip header-like values in data rows', () => {
        const html = `
          <html><body>
            <table summary="SQL ordered by Elapsed Time">
              <tr><th>SQL ID</th><th>Elapsed Time</th></tr>
              <tr><td>SQL ID</td><td>-</td></tr>
              <tr><td>real123</td><td>100</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.length).toBe(1);
        expect(result?.byElapsedTime?.[0].sqlId).toBe('real123');
      });

      it('should handle empty SQL ID values', () => {
        const html = `
          <html><body>
            <table summary="SQL ordered by Elapsed Time">
              <tr><th>SQL ID</th><th>Elapsed Time</th></tr>
              <tr><td></td><td>100</td></tr>
              <tr><td>valid001</td><td>50</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.length).toBe(1);
        expect(result?.byElapsedTime?.[0].sqlId).toBe('valid001');
      });

      it('should handle malformed HTML gracefully', () => {
        const html = '<html><body><table><tr><td>SQL ID';

        expect(() => parser.parse(html)).not.toThrow();
      });

      it('should handle missing optional values', () => {
        const html = createSqlSectionHtml('elapsed', [
          { sqlId: 'minimal001' },
        ]);

        const result = parser.parse(html);

        expect(result?.byElapsedTime?.[0].sqlId).toBe('minimal001');
        expect(result?.byElapsedTime?.[0].elapsedTime).toBeUndefined();
        expect(result?.byElapsedTime?.[0].cpuTime).toBeUndefined();
      });
    });

    describe('parseWithResult', () => {
      it('should return success result for valid SQL data', () => {
        const html = createSqlSectionHtml('elapsed', [
          { sqlId: 'test001', elapsedTime: '100' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should return failure for missing SQL data', () => {
        const html = '<html><body><p>No SQL data</p></body></html>';

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.error).toBeDefined();
      });
    });

    describe('validation', () => {
      it('should validate at least one SQL statement exists', () => {
        const html = createSqlSectionHtml('elapsed', []);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(false);
      });

      it('should pass validation with statements in any section', () => {
        const html = createSqlSectionHtml('cpu', [
          { sqlId: 'cpuonly001', cpuTime: '50' },
        ]);

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
      });
    });
  });
});

// ==================== Test Helpers ====================

interface SqlStatementInput {
  sqlId: string;
  elapsedTime?: string;
  cpuTime?: string;
  executions?: string;
  bufferGets?: string;
  diskReads?: string;
  rowsProcessed?: string;
  percentDbTime?: string;
  percentCpu?: string;
  module?: string;
  planHashValue?: string;
}

interface SqlTextInput {
  sqlId: string;
  sqlText: string;
}

type SqlSectionType = 'elapsed' | 'cpu' | 'gets' | 'reads' | 'executions' | 'parse' | 'cluster';

/**
 * Create SQL section HTML for a specific ordering type
 */
function createSqlSectionHtml(
  type: SqlSectionType,
  statements: SqlStatementInput[],
): string {
  const sectionTitles: Record<SqlSectionType, string> = {
    elapsed: 'SQL ordered by Elapsed Time',
    cpu: 'SQL ordered by CPU Time',
    gets: 'SQL ordered by Buffer Gets',
    reads: 'SQL ordered by Physical Reads',
    executions: 'SQL ordered by Executions',
    parse: 'SQL ordered by Parse Calls',
    cluster: 'SQL ordered by Cluster Wait Time',
  };

  const rows = statements
    .map(
      s => `
        <tr>
          <td>${s.sqlId}</td>
          <td>${s.elapsedTime ?? ''}</td>
          <td>${s.cpuTime ?? ''}</td>
          <td>${s.executions ?? ''}</td>
          <td>${s.bufferGets ?? ''}</td>
          <td>${s.diskReads ?? ''}</td>
          <td>${s.rowsProcessed ?? ''}</td>
          <td>${s.percentDbTime ?? ''}</td>
          <td>${s.percentCpu ?? ''}</td>
          <td>${s.module ?? ''}</td>
        </tr>
      `,
    )
    .join('\n');

  return `
    <html><body>
      <h3>${sectionTitles[type]}</h3>
      <table summary="${sectionTitles[type]}">
        <tr>
          <th>SQL ID</th>
          <th>Elapsed Time</th>
          <th>CPU Time</th>
          <th>Executions</th>
          <th>Buffer Gets</th>
          <th>Disk Reads</th>
          <th>Rows Processed</th>
          <th>% DB Time</th>
          <th>% CPU</th>
          <th>Module</th>
        </tr>
        ${rows}
      </table>
    </body></html>
  `;
}

/**
 * Create SQL text section HTML
 */
function createSqlWithTextHtml(sqlTexts: SqlTextInput[]): string {
  const rows = sqlTexts
    .map(s => `<tr><td>${s.sqlId}</td><td>${s.sqlText}</td></tr>`)
    .join('\n');

  // Include a stats section so the parser returns non-null (needs at least one statement)
  const firstId = sqlTexts[0]?.sqlId ?? 'dummy001';

  return `
    <html><body>
      <h3>SQL ordered by Elapsed Time</h3>
      <table summary="SQL ordered by Elapsed Time">
        <tr><th>SQL ID</th><th>Elapsed Time</th></tr>
        <tr><td>${firstId}</td><td>100</td></tr>
      </table>

      <h3>Complete List of SQL Text</h3>
      <table summary="SQL Text">
        <tr><th>SQL ID</th><th>SQL Text</th></tr>
        ${rows}
      </table>
    </body></html>
  `;
}

/**
 * Create full SQL HTML with both stats and text sections
 */
function createFullSqlHtml(
  statements: SqlStatementInput[],
  sqlTexts: SqlTextInput[],
): string {
  const statsRows = statements
    .map(
      s => `
        <tr>
          <td>${s.sqlId}</td>
          <td>${s.elapsedTime ?? ''}</td>
          <td>${s.cpuTime ?? ''}</td>
          <td>${s.executions ?? ''}</td>
        </tr>
      `,
    )
    .join('\n');

  const textRows = sqlTexts
    .map(s => `<tr><td>${s.sqlId}</td><td>${s.sqlText}</td></tr>`)
    .join('\n');

  return `
    <html><body>
      <h3>SQL ordered by Elapsed Time</h3>
      <table summary="SQL ordered by Elapsed Time">
        <tr>
          <th>SQL ID</th>
          <th>Elapsed Time</th>
          <th>CPU Time</th>
          <th>Executions</th>
        </tr>
        ${statsRows}
      </table>

      <h3>Complete List of SQL Text</h3>
      <table summary="SQL Text">
        <tr><th>SQL ID</th><th>SQL Text</th></tr>
        ${textRows}
      </table>
    </body></html>
  `;
}

/**
 * Create HTML with multiple SQL sections
 */
function createMultiSectionSqlHtml(): string {
  return `
    <html><body>
      <h3>SQL ordered by Elapsed Time</h3>
      <table summary="SQL ordered by Elapsed Time">
        <tr><th>SQL ID</th><th>Elapsed Time</th></tr>
        <tr><td>elapsed001</td><td>100</td></tr>
      </table>

      <h3>SQL ordered by CPU Time</h3>
      <table summary="SQL ordered by CPU Time">
        <tr><th>SQL ID</th><th>CPU Time</th></tr>
        <tr><td>cpu001</td><td>75</td></tr>
      </table>

      <h3>SQL ordered by Buffer Gets</h3>
      <table summary="SQL ordered by Buffer Gets">
        <tr><th>SQL ID</th><th>Buffer Gets</th></tr>
        <tr><td>gets001</td><td>50000</td></tr>
      </table>
    </body></html>
  `;
}
