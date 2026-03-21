/**
 * Unit tests for SqlPerformanceAnalyzer
 *
 * Tests for analyzing SQL performance issues from AWR reports:
 * - High DB time queries
 * - CPU-bound queries
 * - I/O-bound queries
 * - High buffer gets queries
 * - Inefficient queries
 * - High parse calls queries
 */

import { SqlPerformanceAnalyzer } from '../../analyzers/sql-analyzer';
import { DEFAULT_AWR_ANALYSIS_CONFIG, createAwrAnalysisConfig } from '../../config/awr-analysis.config';
import type { ParsedAwrData, TopSql, SqlStatement } from '../../types/awr-data.types';
import type { AwrInsight } from '../../types/insights.types';

describe('SqlPerformanceAnalyzer', () => {
  let analyzer: SqlPerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new SqlPerformanceAnalyzer(DEFAULT_AWR_ANALYSIS_CONFIG);
  });

  describe('getName', () => {
    it('should return "SqlPerformanceAnalyzer"', () => {
      expect(analyzer.getName()).toBe('SqlPerformanceAnalyzer');
    });
  });

  describe('getCategory', () => {
    it('should return "sql_performance"', () => {
      expect(analyzer.getCategory()).toBe('sql_performance');
    });
  });

  describe('analyze', () => {
    describe('no data scenarios', () => {
      it('should return empty array for empty data', () => {
        const data: ParsedAwrData = {};
        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });

      it('should return empty array when topSql is undefined', () => {
        const data: ParsedAwrData = { topSql: undefined };
        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });

      it('should return empty array when topSql has no byElapsedTime', () => {
        const data: ParsedAwrData = { topSql: {} };
        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });
    });

    describe('high DB time queries', () => {
      it('should generate insight for query above minDbTimePercent threshold', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'highdb001',
            percentDbTime: 10, // Above default threshold of 5%
            elapsedTime: 100,
          }),
        ]);

        const insights = analyzer.analyze(data);

        expect(insights.length).toBeGreaterThan(0);
        const insight = insights.find(i => i.sqlId === 'highdb001');
        expect(insight).toBeDefined();
        expect(insight?.title).toContain('highdb001');
        expect(insight?.category).toBe('sql_performance');
        expect(insight?.tags).toContain('high-db-time');
      });

      it('should generate critical severity for very high DB time', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'critical001',
            percentDbTime: 25, // Above criticalDbTimePercent of 20%
            elapsedTime: 500,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'critical001');
        expect(insight?.severity).toBe('critical');
      });

      it('should generate warning severity for moderate DB time', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'warning001',
            percentDbTime: 12, // Above minDbTimePercent*2 (10%)
            elapsedTime: 200,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'warning001');
        expect(insight?.severity).toBe('warning');
      });

      it('should generate info severity for low DB time', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'info001',
            percentDbTime: 6, // Just above threshold
            elapsedTime: 50,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'info001');
        expect(insight?.severity).toBe('info');
      });

      it('should not generate insight below threshold', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'below001',
            percentDbTime: 2, // Below threshold
            elapsedTime: 10,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'below001' && i.tags?.includes('high-db-time'));
        expect(insight).toBeUndefined();
      });
    });

    describe('CPU-bound queries', () => {
      it('should identify CPU-bound queries', () => {
        const data = createParsedAwrDataWithCategory('byCpuTime', [
          createSqlStatement({
            sqlId: 'cpu001',
            percentDbTime: 8,
            elapsedTime: 100,
            cpuTime: 85, // 85% of elapsed time
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('cpu-bound'));
        expect(insight).toBeDefined();
        expect(insight?.sqlId).toBe('cpu001');
      });

      it('should not flag query as CPU-bound when CPU percent is low', () => {
        const data = createParsedAwrDataWithCategory('byCpuTime', [
          createSqlStatement({
            sqlId: 'lowcpu001',
            percentDbTime: 5,
            elapsedTime: 100,
            cpuTime: 30, // Only 30% CPU
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'lowcpu001' && i.tags?.includes('cpu-bound'));
        expect(insight).toBeUndefined();
      });
    });

    describe('I/O-bound queries', () => {
      it('should identify I/O-bound queries with high disk reads', () => {
        const data = createParsedAwrDataWithCategory('byDiskReads', [
          createSqlStatement({
            sqlId: 'io001',
            percentDbTime: 5,
            diskReads: 10000,
            executions: 10, // 1000 reads per exec
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('io-bound'));
        expect(insight).toBeDefined();
        expect(insight?.sqlId).toBe('io001');
      });

      it('should use diskReadsPerExec if provided', () => {
        const data = createParsedAwrDataWithCategory('byDiskReads', [
          createSqlStatement({
            sqlId: 'io002',
            percentDbTime: 5,
            diskReadsPerExec: 500, // Above threshold
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('io-bound'));
        expect(insight).toBeDefined();
      });
    });

    describe('high buffer gets queries', () => {
      it('should identify queries with high buffer gets per execution', () => {
        const data = createParsedAwrDataWithCategory('byBufferGets', [
          createSqlStatement({
            sqlId: 'buffer001',
            percentDbTime: 5,
            bufferGets: 1000000,
            executions: 10, // 100000 gets per exec
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-buffer-gets'));
        expect(insight).toBeDefined();
        expect(insight?.sqlId).toBe('buffer001');
      });

      it('should use bufferGetsPerExec if provided', () => {
        const data = createParsedAwrDataWithCategory('byBufferGets', [
          createSqlStatement({
            sqlId: 'buffer002',
            percentDbTime: 5,
            bufferGetsPerExec: 50000, // Above threshold
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-buffer-gets'));
        expect(insight).toBeDefined();
      });
    });

    describe('inefficient queries', () => {
      it('should identify inefficient queries with high buffer gets per row', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'inefficient001',
            percentDbTime: 5,
            bufferGets: 100000,
            executions: 100,
            rowsProcessed: 100, // 1 row per exec with 1000 buffer gets per exec
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('inefficient'));
        expect(insight).toBeDefined();
        expect(insight?.sqlId).toBe('inefficient001');
        expect(insight?.severity).toBe('warning');
      });

      it('should not flag efficient queries', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'efficient001',
            percentDbTime: 5,
            bufferGets: 10000,
            executions: 100,
            rowsProcessed: 100000, // Many rows per exec, low buffer gets per row
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'efficient001' && i.tags?.includes('inefficient'));
        expect(insight).toBeUndefined();
      });
    });

    describe('high parse calls', () => {
      it('should identify queries with excessive parse calls', () => {
        const data = createParsedAwrDataWithCategory('byParseCalls', [
          createSqlStatement({
            sqlId: 'parse001',
            executions: 5000, // Used as parse calls in byParseCalls
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.tags?.includes('high-parse'));
        expect(insight).toBeDefined();
        expect(insight?.sqlId).toBe('parse001');
      });

      it('should not flag queries with low parse calls', () => {
        const data = createParsedAwrDataWithCategory('byParseCalls', [
          createSqlStatement({
            sqlId: 'lowparse001',
            executions: 100, // Below threshold
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'lowparse001' && i.tags?.includes('high-parse'));
        expect(insight).toBeUndefined();
      });
    });

    describe('insight content', () => {
      it('should include SQL text in description', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'text001',
            percentDbTime: 15,
            sqlText: 'SELECT * FROM large_table WHERE status = :1',
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'text001');
        expect(insight?.description).toContain('SELECT * FROM large_table');
      });

      it('should truncate long SQL text', () => {
        const longSql = 'SELECT ' + 'a'.repeat(300) + ' FROM table';
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'long001',
            percentDbTime: 15,
            sqlText: longSql,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'long001');
        expect(insight?.description?.length).toBeLessThan(longSql.length + 100);
        expect(insight?.description).toContain('...');
      });

      it('should include impact score', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'impact001',
            percentDbTime: 25,
            elapsedTime: 100,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'impact001');
        expect(insight?.impactScore).toBeDefined();
        expect(insight?.impactScore).toBeGreaterThan(0);
      });

      it('should include recommendation', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'rec001',
            percentDbTime: 25,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'rec001');
        expect(insight?.recommendation).toBeDefined();
        expect(insight?.recommendation?.length).toBeGreaterThan(0);
      });

      it('should include metadata with raw values', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'meta001',
            percentDbTime: 15,
            elapsedTime: 100,
            cpuTime: 80,
            bufferGets: 50000,
            diskReads: 1000,
          }),
        ]);

        const insights = analyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'meta001');
        expect(insight?.metadata?.rawValues).toBeDefined();
      });
    });

    describe('sorting and limiting', () => {
      it('should sort insights by impact score descending', () => {
        const data = createParsedAwrData([
          createSqlStatement({ sqlId: 'low001', percentDbTime: 6 }),
          createSqlStatement({ sqlId: 'high001', percentDbTime: 25 }),
          createSqlStatement({ sqlId: 'med001', percentDbTime: 12 }),
        ]);

        const insights = analyzer.analyze(data);
        const dbTimeInsights = insights.filter(i => i.tags?.includes('high-db-time'));

        expect(dbTimeInsights.length).toBeGreaterThanOrEqual(2);
        // Higher impact should come first
        if (dbTimeInsights.length >= 2) {
          const firstScore = dbTimeInsights[0]?.impactScore ?? 0;
          const secondScore = dbTimeInsights[1]?.impactScore ?? 0;
          expect(firstScore).toBeGreaterThanOrEqual(secondScore);
        }
      });

      it('should respect maxStatementsToAnalyze limit', () => {
        const statements = Array.from({ length: 100 }, (_, i) =>
          createSqlStatement({
            sqlId: `sql${i.toString().padStart(3, '0')}`,
            percentDbTime: 10,
            elapsedTime: 100 - i,
          })
        );
        const data = createParsedAwrData(statements);

        const insights = analyzer.analyze(data);

        // Should analyze up to maxStatementsToAnalyze (default 50)
        const dbTimeInsights = insights.filter(i => i.tags?.includes('high-db-time'));
        expect(dbTimeInsights.length).toBeLessThanOrEqual(50);
      });
    });

    describe('custom configuration', () => {
      it('should respect custom thresholds', () => {
        const customConfig = createAwrAnalysisConfig({
          thresholds: {
            sql: { minDbTimePercent: 1 }, // Very low threshold
          },
        });
        const customAnalyzer = new SqlPerformanceAnalyzer(customConfig);

        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'custom001',
            percentDbTime: 2, // Would be below default threshold
          }),
        ]);

        const insights = customAnalyzer.analyze(data);

        const insight = insights.find(i => i.sqlId === 'custom001');
        expect(insight).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should handle statements with undefined percentDbTime', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'undef001',
            elapsedTime: 100,
          }),
        ]);

        expect(() => analyzer.analyze(data)).not.toThrow();
      });

      it('should handle statements with zero executions', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'zero001',
            percentDbTime: 10,
            executions: 0,
            bufferGets: 10000,
          }),
        ]);

        expect(() => analyzer.analyze(data)).not.toThrow();
      });

      it('should handle statements with zero elapsed time', () => {
        const data = createParsedAwrData([
          createSqlStatement({
            sqlId: 'zeroel001',
            percentDbTime: 10,
            elapsedTime: 0,
            cpuTime: 0,
          }),
        ]);

        expect(() => analyzer.analyze(data)).not.toThrow();
      });

      it('should handle empty byElapsedTime array', () => {
        const data: ParsedAwrData = {
          topSql: { byElapsedTime: [] },
        };

        const insights = analyzer.analyze(data);
        expect(insights).toEqual([]);
      });
    });
  });
});

// ==================== Test Helpers ====================

interface SqlStatementInput {
  sqlId: string;
  sqlText?: string;
  percentDbTime?: number;
  elapsedTime?: number;
  cpuTime?: number;
  bufferGets?: number;
  bufferGetsPerExec?: number;
  diskReads?: number;
  diskReadsPerExec?: number;
  executions?: number;
  rowsProcessed?: number;
  rowsProcessedPerExec?: number;
}

/**
 * Create a SQL statement with defaults
 */
function createSqlStatement(input: SqlStatementInput): SqlStatement {
  return {
    sqlId: input.sqlId,
    sqlText: input.sqlText,
    percentDbTime: input.percentDbTime,
    elapsedTime: input.elapsedTime,
    cpuTime: input.cpuTime,
    bufferGets: input.bufferGets,
    bufferGetsPerExec: input.bufferGetsPerExec,
    diskReads: input.diskReads,
    diskReadsPerExec: input.diskReadsPerExec,
    executions: input.executions,
    rowsProcessed: input.rowsProcessed,
    rowsProcessedPerExec: input.rowsProcessedPerExec,
  };
}

/**
 * Create parsed AWR data with statements in byElapsedTime
 */
function createParsedAwrData(statements: SqlStatement[]): ParsedAwrData {
  return {
    topSql: {
      byElapsedTime: statements,
    },
  };
}

/**
 * Create parsed AWR data with statements in a specific category
 */
function createParsedAwrDataWithCategory(
  category: keyof TopSql,
  statements: SqlStatement[]
): ParsedAwrData {
  const topSql: TopSql = {
    byElapsedTime: statements, // Also put in byElapsedTime for significance check
  };
  // @ts-expect-error - dynamic assignment
  topSql[category] = statements;
  return { topSql };
}
