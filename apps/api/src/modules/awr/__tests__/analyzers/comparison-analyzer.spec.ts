/**
 * Unit tests for ComparisonAnalyzer
 *
 * Tests for comparing two AWR reports to detect regressions and improvements:
 * - SQL statement regressions and improvements
 * - New and removed SQL statements
 * - Wait event changes
 * - Load profile metric changes
 */

import { ComparisonAnalyzer } from '../../analyzers/comparison-analyzer';
import { DEFAULT_AWR_ANALYSIS_CONFIG, createAwrAnalysisConfig } from '../../config/awr-analysis.config';
import type {
  ParsedAwrData,
  TopSql,
  SqlStatement,
  WaitEvents,
  WaitEvent,
  LoadProfile,
} from '../../types/awr-data.types';
import type { AwrInsight } from '../../types/insights.types';

describe('ComparisonAnalyzer', () => {
  let analyzer: ComparisonAnalyzer;

  beforeEach(() => {
    analyzer = new ComparisonAnalyzer(DEFAULT_AWR_ANALYSIS_CONFIG);
  });

  describe('getName', () => {
    it('should return "ComparisonAnalyzer"', () => {
      expect(analyzer.getName()).toBe('ComparisonAnalyzer');
    });
  });

  describe('getCategory', () => {
    it('should return "regression"', () => {
      expect(analyzer.getCategory()).toBe('regression');
    });
  });

  describe('analyze (standard method)', () => {
    it('should return empty array - use compareReports instead', () => {
      const data: ParsedAwrData = {};
      const insights = analyzer.analyze(data);
      expect(insights).toEqual([]);
    });
  });

  describe('compareReports', () => {
    describe('no data scenarios', () => {
      it('should return empty array for empty data', () => {
        const current: ParsedAwrData = {};
        const baseline: ParsedAwrData = {};
        const insights = analyzer.compareReports(current, baseline);
        expect(insights).toEqual([]);
      });

      it('should return empty array when both topSql are undefined', () => {
        const current: ParsedAwrData = { topSql: undefined };
        const baseline: ParsedAwrData = { topSql: undefined };
        const insights = analyzer.compareReports(current, baseline);
        expect(insights).toEqual([]);
      });
    });

    describe('SQL regressions', () => {
      it('should detect significant elapsed time regression', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'regress001',
            elapsedTime: 150, // 50% increase
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'regress001',
            elapsedTime: 100,
            percentDbTime: 3,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'regress001' && i.tags?.includes('sql-regression')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('regression');
        expect(insight?.isComparison).toBe(true);
      });

      it('should generate critical severity for major regression', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'critical001',
            elapsedTime: 200, // 100% increase
            percentDbTime: 10,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'critical001',
            elapsedTime: 100,
            percentDbTime: 5,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(i => i.sqlId === 'critical001');
        expect(insight?.severity).toBe('critical');
      });

      it('should generate warning severity for moderate regression', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'warning001',
            elapsedTime: 130, // 30% increase
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'warning001',
            elapsedTime: 100,
            percentDbTime: 4,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(i => i.sqlId === 'warning001');
        expect(insight?.severity).toBe('warning');
      });

      it('should not flag minor changes as regression', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'minor001',
            elapsedTime: 105, // Only 5% increase
            percentDbTime: 3,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'minor001',
            elapsedTime: 100,
            percentDbTime: 3,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'minor001' && i.tags?.includes('sql-regression')
        );
        expect(insight).toBeUndefined();
      });

      it('should include change percentage in insight', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'pct001',
            elapsedTime: 150,
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'pct001',
            elapsedTime: 100,
            percentDbTime: 3,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(i => i.sqlId === 'pct001');
        expect(insight?.changePercent).toBeCloseTo(50, 2);
      });

      it('should include baseline value in insight', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'baseline001',
            elapsedTime: 150,
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'baseline001',
            elapsedTime: 100,
            percentDbTime: 3,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(i => i.sqlId === 'baseline001');
        expect(insight?.baselineValue).toBe(100);
      });
    });

    describe('SQL improvements', () => {
      it('should detect significant elapsed time improvement', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'improve001',
            elapsedTime: 50, // 50% decrease
            percentDbTime: 2,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'improve001',
            elapsedTime: 100,
            percentDbTime: 5, // Was significant in baseline
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'improve001' && i.tags?.includes('sql-improvement')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('improvement');
        expect(insight?.severity).toBe('info');
      });

      it('should not flag minor improvements', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'minorimp001',
            elapsedTime: 95, // Only 5% decrease
            percentDbTime: 3,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'minorimp001',
            elapsedTime: 100,
            percentDbTime: 3,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'minorimp001' && i.tags?.includes('sql-improvement')
        );
        expect(insight).toBeUndefined();
      });

      it('should not flag improvements for insignificant baseline queries', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'insignif001',
            elapsedTime: 10, // 50% decrease
            percentDbTime: 0.1,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'insignif001',
            elapsedTime: 20,
            percentDbTime: 0.2, // Was insignificant
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'insignif001' && i.tags?.includes('sql-improvement')
        );
        expect(insight).toBeUndefined();
      });
    });

    describe('new SQL statements', () => {
      it('should detect significant new SQL statements', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'new001',
            elapsedTime: 100,
            percentDbTime: 10, // Significant new query
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'new001' && i.tags?.includes('sql-new')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('regression');
      });

      it('should not flag insignificant new SQL statements', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'newsml001',
            elapsedTime: 1,
            percentDbTime: 0.1, // Insignificant
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'newsml001' && i.tags?.includes('sql-new')
        );
        expect(insight).toBeUndefined();
      });
    });

    describe('removed SQL statements', () => {
      it('should detect significant removed SQL statements', () => {
        const current = createParsedAwrDataWithSql([]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'removed001',
            elapsedTime: 100,
            percentDbTime: 5, // Was significant
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'removed001' && i.tags?.includes('sql-removed')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('improvement');
      });

      it('should not flag insignificant removed SQL statements', () => {
        const current = createParsedAwrDataWithSql([]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'removedsml001',
            elapsedTime: 1,
            percentDbTime: 0.1, // Was insignificant
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'removedsml001' && i.tags?.includes('sql-removed')
        );
        expect(insight).toBeUndefined();
      });
    });

    describe('wait event changes', () => {
      it('should detect significant wait event increase', () => {
        const current = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'db file sequential read',
            totalWaitTime: 150, // 50% increase
            waits: 5000,
          }),
        ]);
        const baseline = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'db file sequential read',
            totalWaitTime: 100,
            waits: 3000,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.waitEvent === 'db file sequential read' && i.tags?.includes('wait-increase')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('regression');
      });

      it('should detect significant wait event decrease', () => {
        const current = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'log file sync',
            totalWaitTime: 50, // 50% decrease
            waits: 2000,
          }),
        ]);
        const baseline = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'log file sync',
            totalWaitTime: 100,
            waits: 4000,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.waitEvent === 'log file sync' && i.tags?.includes('wait-decrease')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('improvement');
        expect(insight?.severity).toBe('info');
      });

      it('should not flag minor wait event changes', () => {
        // Use very small absolute values to ensure both percentage and absolute thresholds are not met
        const current = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'minor wait',
            totalWaitTime: 1.05, // Only 5% change, ~50ms absolute increase
            waits: 1000,
          }),
        ]);
        const baseline = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'minor wait',
            totalWaitTime: 1,
            waits: 1000,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.waitEvent === 'minor wait' &&
            (i.tags?.includes('wait-increase') || i.tags?.includes('wait-decrease'))
        );
        expect(insight).toBeUndefined();
      });

      it('should include wait class in insight', () => {
        const current = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'db file sequential read',
            waitClass: 'User I/O',
            totalWaitTime: 200,
            waits: 5000,
          }),
        ]);
        const baseline = createParsedAwrDataWithWaitEvents([
          createWaitEvent({
            event: 'db file sequential read',
            waitClass: 'User I/O',
            totalWaitTime: 100,
            waits: 3000,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(i => i.waitEvent === 'db file sequential read');
        expect(insight?.waitClass).toBe('User I/O');
      });
    });

    describe('load profile changes', () => {
      it('should detect significant DB time increase', () => {
        const current = createParsedAwrDataWithLoadProfile({
          dbTimePerSecond: 15, // 50% increase
          dbCpuPerSecond: 10,
        });
        const baseline = createParsedAwrDataWithLoadProfile({
          dbTimePerSecond: 10,
          dbCpuPerSecond: 7,
        });

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.title?.includes('DB Time') && i.tags?.includes('metric-increase')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('regression');
      });

      it('should detect significant physical reads increase', () => {
        const current = createParsedAwrDataWithLoadProfile({
          physicalReadsPerSecond: 3000, // 50% increase
        });
        const baseline = createParsedAwrDataWithLoadProfile({
          physicalReadsPerSecond: 2000,
        });

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.title?.includes('Physical Reads') && i.tags?.includes('metric-increase')
        );
        expect(insight).toBeDefined();
      });

      it('should detect significant metric decrease as improvement', () => {
        const current = createParsedAwrDataWithLoadProfile({
          hardParsesPerSecond: 50, // 50% decrease
        });
        const baseline = createParsedAwrDataWithLoadProfile({
          hardParsesPerSecond: 100,
        });

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.title?.includes('Hard Parses') && i.tags?.includes('metric-decrease')
        );
        expect(insight).toBeDefined();
        expect(insight?.category).toBe('improvement');
      });

      it('should not flag minor load profile changes', () => {
        const current = createParsedAwrDataWithLoadProfile({
          dbTimePerSecond: 10.5, // Only 5% increase
        });
        const baseline = createParsedAwrDataWithLoadProfile({
          dbTimePerSecond: 10,
        });

        const insights = analyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.title?.includes('DB Time') &&
            (i.tags?.includes('metric-increase') || i.tags?.includes('metric-decrease'))
        );
        expect(insight).toBeUndefined();
      });

      it('should handle missing load profile in current', () => {
        const current: ParsedAwrData = {};
        const baseline = createParsedAwrDataWithLoadProfile({
          dbTimePerSecond: 10,
        });

        expect(() => analyzer.compareReports(current, baseline)).not.toThrow();
      });

      it('should handle missing load profile in baseline', () => {
        const current = createParsedAwrDataWithLoadProfile({
          dbTimePerSecond: 10,
        });
        const baseline: ParsedAwrData = {};

        expect(() => analyzer.compareReports(current, baseline)).not.toThrow();
      });
    });

    describe('compareFromInput', () => {
      it('should work with ComparisonAnalysisInput structure', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'input001',
            elapsedTime: 150,
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'input001',
            elapsedTime: 100,
            percentDbTime: 3,
          }),
        ]);

        const insights = analyzer.compareFromInput({
          currentReportId: 'current-report-001',
          currentData: current,
          baselineReportId: 'baseline-report-001',
          baselineData: baseline,
        });

        expect(insights.length).toBeGreaterThan(0);
      });
    });

    describe('sorting', () => {
      it('should sort insights by impact score descending', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'low001',
            elapsedTime: 130,
            percentDbTime: 3,
          }),
          createSqlStatement({
            sqlId: 'high001',
            elapsedTime: 250,
            percentDbTime: 15,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'low001',
            elapsedTime: 100,
            percentDbTime: 2,
          }),
          createSqlStatement({
            sqlId: 'high001',
            elapsedTime: 100,
            percentDbTime: 10,
          }),
        ]);

        const insights = analyzer.compareReports(current, baseline);

        if (insights.length >= 2) {
          const firstScore = insights[0]?.impactScore ?? 0;
          const secondScore = insights[1]?.impactScore ?? 0;
          expect(firstScore).toBeGreaterThanOrEqual(secondScore);
        }
      });
    });

    describe('custom configuration', () => {
      it('should respect custom regression threshold', () => {
        const customConfig = createAwrAnalysisConfig({
          thresholds: {
            comparison: { significantRegressionPercent: 10 }, // Lower threshold
          },
        });
        const customAnalyzer = new ComparisonAnalyzer(customConfig);

        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'custom001',
            elapsedTime: 115, // 15% increase
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'custom001',
            elapsedTime: 100,
            percentDbTime: 4,
          }),
        ]);

        const insights = customAnalyzer.compareReports(current, baseline);

        const insight = insights.find(i => i.sqlId === 'custom001');
        expect(insight).toBeDefined();
      });

      it('should respect custom improvement threshold', () => {
        const customConfig = createAwrAnalysisConfig({
          thresholds: {
            comparison: { significantImprovementPercent: 10 }, // Lower threshold
          },
        });
        const customAnalyzer = new ComparisonAnalyzer(customConfig);

        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'customimpr001',
            elapsedTime: 85, // 15% decrease
            percentDbTime: 3,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'customimpr001',
            elapsedTime: 100,
            percentDbTime: 5,
          }),
        ]);

        const insights = customAnalyzer.compareReports(current, baseline);

        const insight = insights.find(
          i => i.sqlId === 'customimpr001' && i.tags?.includes('sql-improvement')
        );
        expect(insight).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should handle zero baseline elapsed time', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'zerob001',
            elapsedTime: 100,
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'zerob001',
            elapsedTime: 0,
            percentDbTime: 0,
          }),
        ]);

        expect(() => analyzer.compareReports(current, baseline)).not.toThrow();
      });

      it('should handle zero current elapsed time', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'zeroc001',
            elapsedTime: 0,
            percentDbTime: 0,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'zeroc001',
            elapsedTime: 100,
            percentDbTime: 5,
          }),
        ]);

        expect(() => analyzer.compareReports(current, baseline)).not.toThrow();
      });

      it('should handle undefined elapsed times', () => {
        const current = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'undef001',
            percentDbTime: 5,
          }),
        ]);
        const baseline = createParsedAwrDataWithSql([
          createSqlStatement({
            sqlId: 'undef001',
            percentDbTime: 3,
          }),
        ]);

        expect(() => analyzer.compareReports(current, baseline)).not.toThrow();
      });

      it('should handle SQL in different categories', () => {
        const current: ParsedAwrData = {
          topSql: {
            byElapsedTime: [
              createSqlStatement({
                sqlId: 'elapsed001',
                elapsedTime: 150,
                percentDbTime: 5,
              }),
            ],
            byCpuTime: [
              createSqlStatement({
                sqlId: 'cpu001',
                elapsedTime: 100,
                percentDbTime: 3,
              }),
            ],
          },
        };
        const baseline: ParsedAwrData = {
          topSql: {
            byElapsedTime: [
              createSqlStatement({
                sqlId: 'elapsed001',
                elapsedTime: 100,
                percentDbTime: 3,
              }),
            ],
            byCpuTime: [
              createSqlStatement({
                sqlId: 'cpu001',
                elapsedTime: 50,
                percentDbTime: 2,
              }),
            ],
          },
        };

        const insights = analyzer.compareReports(current, baseline);

        // Should find both statements
        expect(insights.some(i => i.sqlId === 'elapsed001')).toBe(true);
        expect(insights.some(i => i.sqlId === 'cpu001')).toBe(true);
      });

      it('should handle empty arrays', () => {
        const current: ParsedAwrData = {
          topSql: { byElapsedTime: [] },
          waitEvents: { foreground: [] },
        };
        const baseline: ParsedAwrData = {
          topSql: { byElapsedTime: [] },
          waitEvents: { foreground: [] },
        };

        const insights = analyzer.compareReports(current, baseline);
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
  diskReads?: number;
  executions?: number;
}

interface WaitEventInput {
  event: string;
  waitClass?: string;
  waits: number;
  totalWaitTime: number;
  avgWaitMs?: number;
  percentDbTime?: number;
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
    diskReads: input.diskReads,
    executions: input.executions,
  };
}

/**
 * Create a wait event with defaults
 */
function createWaitEvent(input: WaitEventInput): WaitEvent {
  return {
    event: input.event,
    waitClass: input.waitClass,
    waits: input.waits,
    totalWaitTime: input.totalWaitTime,
    avgWaitMs: input.avgWaitMs,
    percentDbTime: input.percentDbTime,
  };
}

/**
 * Create parsed AWR data with SQL statements
 */
function createParsedAwrDataWithSql(statements: SqlStatement[]): ParsedAwrData {
  return {
    topSql: {
      byElapsedTime: statements,
    },
  };
}

/**
 * Create parsed AWR data with wait events
 */
function createParsedAwrDataWithWaitEvents(events: WaitEvent[]): ParsedAwrData {
  return {
    waitEvents: {
      foreground: events,
    },
  };
}

/**
 * Create parsed AWR data with load profile
 */
function createParsedAwrDataWithLoadProfile(profile: Partial<LoadProfile>): ParsedAwrData {
  return {
    loadProfile: {
      dbTimePerSecond: profile.dbTimePerSecond,
      dbCpuPerSecond: profile.dbCpuPerSecond,
      logicalReadsPerSecond: profile.logicalReadsPerSecond,
      physicalReadsPerSecond: profile.physicalReadsPerSecond,
      physicalWritesPerSecond: profile.physicalWritesPerSecond,
      hardParsesPerSecond: profile.hardParsesPerSecond,
      transactionsPerSecond: profile.transactionsPerSecond,
      redoSizePerSecond: profile.redoSizePerSecond,
    },
  };
}
