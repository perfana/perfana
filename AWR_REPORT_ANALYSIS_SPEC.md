# AWR Report Analysis Feature - Maintainable Implementation Specification

**Version:** 1.0
**Date:** 2026-01-20
**Status:** Ready for Implementation

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Core Maintainability Principles](#core-maintainability-principles)
3. [Architecture](#architecture)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Testing Strategy](#testing-strategy)
7. [Configuration Management](#configuration-management)
8. [Implementation Phases](#implementation-phases)
9. [Success Criteria](#success-criteria)

---

## Overview

### Purpose

Add Oracle Automatic Workload Repository (AWR) report analysis capability to Perfana, enabling users to upload, store, analyze, and compare AWR reports across test runs to identify database performance regressions and improvements.

### Key Features

1. **Upload & Parse** - Upload AWR reports (HTML/text) with automatic parsing
2. **Single Report Analysis** - Extract insights from individual AWR reports
3. **Baseline Comparison** - Compare AWR reports between test runs
4. **Actionable Insights** - Generate specific, actionable recommendations
5. **Root Cause Integration** - Display AWR analysis in test run details view

### Sample AWR Reports Analyzed

- `awr_report_25982_25983-1.html` (319 KB, ~3,300 lines)
- `awr_report_26079_26081.html` (1.2 MB, ~9,760 lines)

**Key Sections Identified:**
- Report Header (DB info, host info, snapshot metadata)
- Load Profile (per second/transaction metrics)
- Time Model Statistics
- Wait Events (foreground/background)
- SQL Statistics (ordered by elapsed time, CPU, I/O, gets, reads, executions)
- ADDM Findings
- Top SQL with Top Events

---

## Core Maintainability Principles

### 1. Clear Separation of Concerns

Each module has a single, well-defined responsibility:
- **Parsers** - Extract data from HTML/text reports
- **Analyzers** - Generate insights from parsed data
- **Services** - Orchestrate business logic
- **Controllers** - Handle HTTP requests
- **DTOs** - Validate and shape data

### 2. Consistent Patterns

- **Strategy Pattern** for parsers and analyzers
- **Custom Hooks** for React data fetching
- **Service Layer** pattern for business logic
- **Repository Pattern** for data access

### 3. Comprehensive Testing

- **Unit Tests** (80%): All parsers, analyzers, utilities
- **Integration Tests** (15%): API endpoints, database operations
- **E2E Tests** (5%): Critical user flows

### 4. Simple Abstractions

- Favor clarity over cleverness
- No premature optimization
- Each function does one thing well
- Maximum 50 lines per function

### 5. Self-Documenting Code

- Clear naming conventions
- JSDoc comments for public APIs
- Type definitions document data structures
- README files for each module

### 6. Incremental Complexity

- Build simple first, add features progressively
- Start with HTML parser, add text parser later
- Begin with basic analysis, enhance rules over time
- MVP first, then iterate

---

## Architecture

### Backend Module Organization

```
apps/api/src/awr/
├── awr.module.ts                    # Module definition
├── entities/
│   ├── awr-report.entity.ts         # Database entity
│   └── awr-analysis.entity.ts       # Analysis results entity
├── dto/
│   ├── upload-awr-report.dto.ts     # Request validation
│   ├── awr-report-response.dto.ts   # Response formatting
│   └── compare-reports.dto.ts       # Comparison request
├── controllers/
│   └── awr-reports.controller.ts    # HTTP endpoints (thin)
├── services/
│   ├── awr-reports.service.ts       # CRUD operations
│   ├── awr-parser.service.ts        # Parsing orchestration
│   ├── awr-analysis.service.ts      # Analysis orchestration
│   └── awr-comparison.service.ts    # Comparison logic
├── parsers/                          # Parser implementations
│   ├── base-parser.ts               # Abstract base class
│   ├── html-parser.ts               # HTML AWR parsing
│   ├── text-parser.ts               # Text AWR (future)
│   └── sections/                     # Section parsers
│       ├── header-parser.ts
│       ├── load-profile-parser.ts
│       ├── sql-parser.ts
│       ├── wait-events-parser.ts
│       └── index.ts
├── analyzers/                        # Analysis rules
│   ├── base-analyzer.ts             # Analyzer interface
│   ├── sql-analyzer.ts              # SQL performance
│   ├── wait-events-analyzer.ts      # Wait events
│   ├── resource-analyzer.ts         # Resource utilization
│   └── comparison-analyzer.ts       # Baseline comparison
├── utils/
│   ├── html-utils.ts                # HTML parsing helpers
│   ├── number-utils.ts              # Number parsing
│   └── time-utils.ts                # Time value parsing
├── types/
│   ├── awr-data.types.ts            # Parsed data interfaces
│   ├── analysis.types.ts            # Analysis results
│   └── insights.types.ts            # Insight interfaces
├── config/
│   └── awr-analysis.config.ts       # Configuration
└── __tests__/                        # Unit tests
    ├── services/
    ├── parsers/
    └── analyzers/
```

### Frontend Component Organization

```
apps/web/components/test-runs/awr/
├── AwrReportCard.tsx              # Main card (orchestrator)
├── AwrUploadZone.tsx              # File upload UI
├── AwrParsingStatus.tsx           # Parsing status
├── tabs/
│   ├── OverviewTab.tsx            # Overview tab
│   ├── TopSqlTab.tsx              # Top SQL tab
│   ├── WaitEventsTab.tsx          # Wait events tab
│   ├── InsightsTab.tsx            # Insights tab
│   └── CompareTab.tsx             # Comparison tab
├── insights/
│   ├── InsightCard.tsx            # Single insight
│   ├── InsightsList.tsx           # Insights list
│   └── SeverityBadge.tsx          # Severity indicator
├── sql/
│   ├── SqlStatementCard.tsx       # SQL display
│   ├── SqlMetricsTable.tsx        # Metrics table
│   └── SqlTextViewer.tsx          # SQL text viewer
├── charts/
│   ├── LoadProfileChart.tsx       # Load profile viz
│   ├── WaitEventsChart.tsx        # Wait events chart
│   └── TimeModelChart.tsx         # Time model chart
├── hooks/
│   ├── useAwrReports.ts           # Fetch reports
│   ├── useAwrAnalysis.ts          # Fetch analysis
│   ├── useUploadAwrReport.ts      # Upload mutation
│   └── useAwrComparison.ts        # Comparison logic
├── utils/
│   ├── formatters.ts              # Formatters
│   └── severity-helpers.ts        # Severity utils
└── __tests__/
    ├── AwrReportCard.test.tsx
    ├── tabs/
    └── hooks/
```

---

## Backend Implementation

### Database Schema

#### AWR Reports Table

```typescript
interface AwrReport {
  id: string; // UUID
  test_run_id: string; // FK to test_runs
  file_name: string;
  file_size: number;
  file_type: 'html' | 'text';

  // Storage
  raw_content_url?: string; // S3 URL for large files
  raw_content?: string; // For smaller files

  // Metadata (extracted from header)
  db_name: string;
  db_id: string;
  instance_name: string;
  db_edition: string; // EE, SE
  db_release: string; // 19.27.0.0.0
  is_rac: boolean;
  is_cdb: boolean;

  // Host info
  host_name: string;
  platform: string;
  cpus: number;
  cores: number;
  sockets: number;
  memory_gb: number;

  // Snapshot info
  snap_id_begin: number;
  snap_id_end: number;
  begin_time: Date;
  end_time: Date;
  elapsed_minutes: number;
  db_time_minutes: number;
  sessions_begin: number;
  sessions_end: number;

  // PDB info (JSON array)
  pdbs: Array<{
    container_db_id: string;
    container_name: string;
    open_time: string;
  }>;

  // Parsed data (JSONB for PostgreSQL)
  parsed_data: {
    load_profile: LoadProfile;
    time_model: TimeModel[];
    wait_events: WaitEvent[];
    top_sql: TopSqlStatement[];
    addm_findings?: AddmFinding[];
  };

  // Metadata
  uploaded_at: Date;
  uploaded_by: string;
  parsed_at?: Date;
  parse_status: 'pending' | 'parsing' | 'completed' | 'failed';
  parse_error?: string;
}
```

#### AWR Analysis Table

```typescript
interface AwrAnalysis {
  id: string;
  awr_report_id: string; // FK
  analysis_type: 'single' | 'comparison';
  baseline_report_id?: string; // For comparison

  insights: AwrInsight[];

  severity_summary: {
    critical: number;
    warning: number;
    info: number;
  };

  analyzed_at: Date;
  analysis_version: string; // Track algorithm version
}
```

#### AWR Insight

```typescript
interface AwrInsight {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'sql' | 'wait_event' | 'resource' | 'regression' | 'improvement';
  title: string;
  description: string;
  recommendation: string;

  // References
  sql_id?: string;
  event_name?: string;

  // Metrics
  metric_value?: number;
  metric_unit?: string;
  baseline_value?: number; // For comparisons
  delta_pct?: number; // For comparisons

  // Context
  impact_score?: number; // 1-100 scale
  evidence?: any; // JSONB with supporting data
}
```

### API Endpoints

```typescript
// Upload & Management
POST   /test-runs/:testRunId/awr-reports
GET    /test-runs/:testRunId/awr-reports
GET    /awr-reports/:reportId
DELETE /awr-reports/:reportId
GET    /awr-reports/:reportId/raw

// Analysis
GET    /awr-reports/:reportId/analysis
POST   /awr-reports/compare
GET    /awr-reports/:reportId/summary
```

### Pattern 1: Strategy Pattern for Parsers

**Base Parser Abstract Class:**

```typescript
// parsers/base-parser.ts
export abstract class BaseSectionParser<T> {
  /**
   * Parse a specific section of the AWR report
   * @param html - The HTML content to parse
   * @returns Parsed data or null if section not found
   */
  abstract parse(html: string): T | null;

  /**
   * Validate the parsed data
   * @param data - The parsed data to validate
   * @returns true if valid, false otherwise
   */
  protected validate(data: T): boolean {
    return data !== null && data !== undefined;
  }
}
```

**Section Parser Example:**

```typescript
// parsers/sections/load-profile-parser.ts
export class LoadProfileParser extends BaseSectionParser<LoadProfile> {
  parse(html: string): LoadProfile | null {
    try {
      const table = this.findLoadProfileTable(html);
      if (!table) return null;

      return {
        per_second: this.parseColumn(table, 'Per Second'),
        per_transaction: this.parseColumn(table, 'Per Transaction'),
        per_exec: this.parseColumn(table, 'Per Exec'),
        per_call: this.parseColumn(table, 'Per Call'),
      };
    } catch (error) {
      this.logger.error('Failed to parse load profile', error);
      return null;
    }
  }

  private findLoadProfileTable(html: string): CheerioElement | null {
    // Implementation...
  }

  private parseColumn(table: CheerioElement, columnName: string): any {
    // Implementation...
  }
}
```

**Parser Orchestration:**

```typescript
// parsers/html-parser.ts
export class HtmlAwrParser {
  constructor(
    private readonly headerParser: HeaderParser,
    private readonly loadProfileParser: LoadProfileParser,
    private readonly sqlParser: SqlParser,
    private readonly waitEventsParser: WaitEventsParser,
  ) {}

  async parse(html: string): Promise<ParsedAwrData> {
    return {
      header: this.headerParser.parse(html),
      loadProfile: this.loadProfileParser.parse(html),
      topSql: this.sqlParser.parse(html),
      waitEvents: this.waitEventsParser.parse(html),
      // Graceful degradation - if one section fails, others still work
    };
  }
}
```

**Benefits:**
- ✅ Each parser is ~50-100 lines (easy to understand)
- ✅ Easy to test individual parsers
- ✅ Add new sections without touching existing code
- ✅ Graceful degradation if one section fails

### Pattern 2: Strategy Pattern for Analyzers

**Analyzer Interface:**

```typescript
// analyzers/base-analyzer.ts
export interface AwrAnalyzer {
  /**
   * Analyze AWR data and generate insights
   * @param data - The parsed AWR data
   * @returns Array of insights or empty array
   */
  analyze(data: ParsedAwrData): AwrInsight[];

  /**
   * Get the analyzer name for logging/debugging
   */
  getName(): string;
}
```

**SQL Performance Analyzer:**

```typescript
// analyzers/sql-analyzer.ts
export class SqlPerformanceAnalyzer implements AwrAnalyzer {
  // Configuration thresholds (easy to adjust)
  private readonly HIGH_DB_TIME_THRESHOLD = 5; // % of DB time
  private readonly CPU_BOUND_THRESHOLD = 80; // % CPU
  private readonly IO_BOUND_THRESHOLD = 60; // % I/O

  constructor(
    private readonly logger: Logger,
    private readonly config?: Partial<SqlAnalyzerConfig>,
  ) {
    // Allow threshold overrides for testing
    if (config?.highDbTimeThreshold) {
      this.HIGH_DB_TIME_THRESHOLD = config.highDbTimeThreshold;
    }
  }

  getName(): string {
    return 'SqlPerformanceAnalyzer';
  }

  analyze(data: ParsedAwrData): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Rule 1: High DB time queries
    insights.push(...this.findHighDbTimeQueries(data.topSql));

    // Rule 2: CPU-bound queries
    insights.push(...this.findCpuBoundQueries(data.topSql));

    // Rule 3: I/O-bound queries
    insights.push(...this.findIoBoundQueries(data.topSql));

    return insights;
  }

  private findHighDbTimeQueries(topSql: TopSqlStatement[]): AwrInsight[] {
    return topSql
      .filter(sql => sql.pct_total_db_time > this.HIGH_DB_TIME_THRESHOLD)
      .slice(0, 5) // Top 5
      .map(sql => this.createHighDbTimeInsight(sql));
  }

  private createHighDbTimeInsight(sql: TopSqlStatement): AwrInsight {
    return {
      id: uuidv4(),
      severity: sql.pct_total_db_time > 20 ? 'critical' : 'warning',
      category: 'sql',
      title: `High DB Time: SQL ${sql.sql_id}`,
      description: this.formatHighDbTimeDescription(sql),
      recommendation: this.generateSqlRecommendation(sql),
      sql_id: sql.sql_id,
      metric_value: sql.pct_total_db_time,
      metric_unit: '% of DB time',
      impact_score: this.calculateImpactScore(sql),
      evidence: {
        elapsed_per_exec: sql.elapsed_time_per_exec_seconds,
        cpu_pct: sql.pct_cpu,
        io_pct: sql.pct_io,
        sql_text: sql.sql_text,
      },
    };
  }

  private formatHighDbTimeDescription(sql: TopSqlStatement): string {
    return `This query consumed ${sql.pct_total_db_time.toFixed(2)}% of total DB time ` +
           `(${sql.elapsed_time_seconds.toFixed(2)}s across ${sql.executions.toLocaleString()} executions)`;
  }

  private generateSqlRecommendation(sql: TopSqlStatement): string {
    if (sql.pct_cpu > 80) {
      return 'This is a CPU-intensive query. Review execution plan for full table scans and consider adding indexes.';
    }
    if (sql.pct_io > 60) {
      return 'This query is I/O-bound. Check for missing indexes or consider query rewrite to reduce data access.';
    }
    return 'Review execution plan and consider optimization opportunities.';
  }

  private calculateImpactScore(sql: TopSqlStatement): number {
    return Math.min(100, sql.pct_total_db_time * 4);
  }
}
```

**Analysis Service Orchestration:**

```typescript
// services/awr-analysis.service.ts
@Injectable()
export class AwrAnalysisService {
  private readonly analyzers: AwrAnalyzer[];

  constructor(
    private readonly logger: Logger,
    private readonly awrReportsService: AwrReportsService,
  ) {
    // Register all analyzers (easy to add/remove)
    this.analyzers = [
      new SqlPerformanceAnalyzer(logger),
      new WaitEventsAnalyzer(logger),
      new ResourceUtilizationAnalyzer(logger),
    ];
  }

  async analyzeSingleReport(reportId: string): Promise<AwrAnalysis> {
    const report = await this.awrReportsService.findOne(reportId);

    if (!report.parsed_data) {
      throw new Error('Report not yet parsed');
    }

    // Run all analyzers
    const allInsights: AwrInsight[] = [];

    for (const analyzer of this.analyzers) {
      try {
        const insights = analyzer.analyze(report.parsed_data);
        allInsights.push(...insights);

        this.logger.debug(
          `${analyzer.getName()} generated ${insights.length} insights`
        );
      } catch (error) {
        this.logger.error(
          `${analyzer.getName()} failed: ${error.message}`,
          error
        );
        // Continue with other analyzers
      }
    }

    // Sort by impact score (highest first)
    allInsights.sort((a, b) => (b.impact_score || 0) - (a.impact_score || 0));

    return {
      id: uuidv4(),
      awr_report_id: reportId,
      analysis_type: 'single',
      insights: allInsights,
      severity_summary: this.calculateSeveritySummary(allInsights),
      analyzed_at: new Date(),
      analysis_version: '1.0.0',
    };
  }

  private calculateSeveritySummary(insights: AwrInsight[]): SeveritySummary {
    return {
      critical: insights.filter(i => i.severity === 'critical').length,
      warning: insights.filter(i => i.severity === 'warning').length,
      info: insights.filter(i => i.severity === 'info').length,
    };
  }
}
```

**Benefits:**
- ✅ Each analyzer is independent and testable
- ✅ Easy to add new analysis rules
- ✅ Easy to disable/enable analyzers
- ✅ Clear separation of concerns
- ✅ Configurable thresholds

### Analysis Rules

#### Single Report Analysis

**Rule 1: High DB Time Queries**
- Threshold: > 5% of total DB time
- Severity: Critical if > 20%, Warning otherwise
- Recommendation: Review execution plan, consider optimization

**Rule 2: CPU-Bound Queries**
- Threshold: > 80% CPU time
- Severity: Warning
- Recommendation: Check for full table scans, add indexes, optimize logic

**Rule 3: I/O-Bound Queries**
- Threshold: > 60% I/O wait time
- Severity: Warning
- Recommendation: Add indexes, reduce data access, optimize query

**Rule 4: Frequently Executed Queries**
- Threshold: > 10,000 executions with > 0.01s per execution
- Severity: Info
- Recommendation: Consider caching, batching, or optimization

**Rule 5: High I/O Wait Events**
- Threshold: > 30% of DB time
- Severity: Critical
- Recommendation: Review top SQL by I/O, add indexes, increase buffer cache

**Rule 6: Lock Contention**
- Threshold: > 10% of DB time in lock waits
- Severity: Warning
- Recommendation: Review transaction design, reduce lock hold times

**Rule 7: Commit Wait Time**
- Threshold: log file sync > 5% of DB time
- Severity: Warning
- Recommendation: Batch commits, review transaction boundaries

#### Comparison Analysis

**Rule 1: SQL Regression**
- Threshold: > 20% slower per execution
- Severity: Critical if > 50%, Warning otherwise
- Recommendation: Compare execution plans, check for missing indexes or stale statistics

**Rule 2: SQL Improvement**
- Threshold: > 20% faster per execution
- Severity: Info
- Recommendation: Document what changed to preserve improvement

**Rule 3: Execution Count Spike**
- Threshold: > 50% increase in executions and > 1000 total
- Severity: Warning
- Recommendation: Investigate application logic changes or increased load

**Rule 4: New Expensive Query**
- Threshold: Not in baseline and > 10% of DB time
- Severity: Warning
- Recommendation: Review why this query is executing and optimize

**Rule 5: Removed Query**
- Threshold: In baseline (> 5% DB time) but not in current
- Severity: Info
- Recommendation: Verify this is expected

**Rule 6: Wait Event Changes**
- Threshold: > 30% increase in wait time
- Severity: Warning
- Recommendation: Investigate cause of increased waits

### Utility Functions

```typescript
// utils/number-utils.ts

/**
 * Parse a numeric value from AWR report
 * Examples: "1,234.56", "12.3", ".98"
 */
export function parseAwrNumber(value: string): number {
  if (!value || value === '&#160;' || value.trim() === '') {
    return 0;
  }
  const cleaned = value.replace(/,/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse time value with unit (ms, us, ns, s)
 * Examples: "5.72ms", "117.80us", "843.66ns", "4.0s"
 */
export function parseAwrTime(value: string): number {
  if (!value) return 0;

  const match = value.match(/^([\d.]+)(ms|us|ns|s)$/);
  if (!match) return 0;

  const [, numStr, unit] = match;
  const num = parseFloat(numStr);

  // Convert to milliseconds
  switch (unit) {
    case 's': return num * 1000;
    case 'ms': return num;
    case 'us': return num / 1000;
    case 'ns': return num / 1000000;
    default: return 0;
  }
}

/**
 * Format percentage for display
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format large number with thousand separators
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}
```

```typescript
// utils/html-utils.ts

/**
 * Extract table data from HTML table element
 * Returns 2D array of cell values
 */
export function extractTableData(
  $: CheerioAPI,
  table: CheerioElement
): string[][] {
  const rows: string[][] = [];

  $(table).find('tr').each((_, row) => {
    const cells: string[] = [];

    $(row).find('td, th').each((_, cell) => {
      cells.push($(cell).text().trim());
    });

    if (cells.length > 0) {
      rows.push(cells);
    }
  });

  return rows;
}

/**
 * Find a table by its preceding header text
 */
export function findTableByHeader(
  $: CheerioAPI,
  html: string,
  headerText: string
): CheerioElement | null {
  const headers = $('h3.awr');

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if ($(header).text().includes(headerText)) {
      const table = $(header).next('table');
      if (table.length > 0) {
        return table[0];
      }
    }
  }

  return null;
}
```

### Async Processing with BullMQ

```typescript
// Parser Queue
@Processor('awr-parser')
class AwrParserProcessor {
  @Process('parse-report')
  async handleParseJob(job: Job<{ reportId: string }>) {
    const { reportId } = job.data;

    try {
      await this.awrParserService.parseAwrReport(reportId);
      await this.awrAnalysisService.analyzeSingleReport(reportId);

      return { success: true };
    } catch (error) {
      await this.awrReportsService.updateParseStatus(
        reportId,
        'failed',
        error.message
      );
      throw error;
    }
  }
}

// Usage in controller
@Post(':testRunId/awr-reports')
async uploadAwrReport(
  @Param('testRunId') testRunId: string,
  @UploadedFile() file: Express.Multer.File,
  @Req() request: Request
) {
  // 1. Create AWR report record
  const report = await this.awrReportsService.create({
    test_run_id: testRunId,
    file_name: file.originalname,
    file_size: file.size,
    raw_content: file.buffer.toString('utf-8'),
    parse_status: 'pending',
    uploaded_by: request.user.username,
  });

  // 2. Queue parsing job (async)
  await this.awrParserQueue.add('parse-report', {
    reportId: report.id
  });

  // 3. Return immediately
  return report;
}
```

---

## Frontend Implementation

### Main Component Structure

```typescript
// components/test-runs/awr/AwrReportCard.tsx

'use client';

import { useState } from 'react';
import { Card, Tabs, Tab, Button } from '@mui/material';
import { Assessment } from '@mui/icons-material';
import { AwrUploadZone } from './AwrUploadZone';
import { OverviewTab } from './tabs/OverviewTab';
import { TopSqlTab } from './tabs/TopSqlTab';
import { WaitEventsTab } from './tabs/WaitEventsTab';
import { InsightsTab } from './tabs/InsightsTab';
import { CompareTab } from './tabs/CompareTab';
import { useAwrReports } from './hooks/useAwrReports';
import { useAwrAnalysis } from './hooks/useAwrAnalysis';

interface AwrReportCardProps {
  testRunId: string;
  expanded: boolean;
  onExpand: () => void;
}

type TabValue = 'overview' | 'sql' | 'waits' | 'insights' | 'compare';

/**
 * AWR Report Analysis Card Component
 *
 * Displays AWR report upload, parsing status, and analysis results.
 * Supports single report analysis and baseline comparison.
 */
export function AwrReportCard({
  testRunId,
  expanded,
  onExpand
}: AwrReportCardProps) {
  const [selectedTab, setSelectedTab] = useState<TabValue>('overview');
  const [baselineTestRunId, setBaselineTestRunId] = useState<string | null>(null);

  const { data: reports, isLoading } = useAwrReports(testRunId);
  const { data: analysis } = useAwrAnalysis(
    reports?.[0]?.id,
    baselineTestRunId
  );

  const currentReport = reports?.[0];

  if (expanded) {
    return (
      <Card className="awr-report-card-expanded" data-testid="awr-card-expanded">
        <AwrCardHeader onCollapse={onExpand} />

        {currentReport && (
          <>
            <AwrReportMetadata report={currentReport} />

            <Tabs
              value={selectedTab}
              onChange={(_, value) => setSelectedTab(value)}
            >
              <Tab label="Overview" value="overview" />
              <Tab label="Top SQL" value="sql" />
              <Tab label="Wait Events" value="waits" />
              <Tab label="Insights" value="insights" />
              <Tab label="Compare" value="compare" />
            </Tabs>

            <div className="tab-content">
              {selectedTab === 'overview' && <OverviewTab report={currentReport} />}
              {selectedTab === 'sql' && <TopSqlTab report={currentReport} />}
              {selectedTab === 'waits' && <WaitEventsTab report={currentReport} />}
              {selectedTab === 'insights' && <InsightsTab analysis={analysis} />}
              {selectedTab === 'compare' && (
                <CompareTab
                  currentReport={currentReport}
                  baselineTestRunId={baselineTestRunId}
                  onBaselineChange={setBaselineTestRunId}
                  analysis={analysis}
                />
              )}
            </div>
          </>
        )}

        {!currentReport && !isLoading && (
          <AwrUploadZone testRunId={testRunId} />
        )}
      </Card>
    );
  }

  // Collapsed state
  return (
    <Card
      className="awr-report-card-collapsed"
      onClick={onExpand}
      data-testid="awr-card-collapsed"
    >
      <AwrCardHeader />

      {!currentReport && <AwrUploadZone testRunId={testRunId} compact />}
      {currentReport && <AwrSummary report={currentReport} analysis={analysis} />}
    </Card>
  );
}
```

### Custom Hooks Pattern

```typescript
// hooks/useAwrReports.ts

import { useQuery } from '@tanstack/react-query';
import { fetchAwrReports } from '@/lib/api/awr-reports';

/**
 * Fetch AWR reports for a test run
 */
export function useAwrReports(testRunId: string) {
  return useQuery({
    queryKey: ['awr-reports', testRunId],
    queryFn: () => fetchAwrReports(testRunId),
    staleTime: 30000, // 30 seconds
    enabled: !!testRunId,
  });
}

// hooks/useUploadAwrReport.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadAwrReport } from '@/lib/api/awr-reports';
import { toast } from 'react-hot-toast';

/**
 * Upload an AWR report file
 */
export function useUploadAwrReport(testRunId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => uploadAwrReport(testRunId, file),
    onSuccess: () => {
      queryClient.invalidateQueries(['awr-reports', testRunId]);
      toast.success('AWR report uploaded successfully');
    },
    onError: (error: Error) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });
}
```

### Upload Component

```typescript
// AwrUploadZone.tsx

function AwrUploadZone({ testRunId, compact = false }: AwrUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const uploadMutation = useUploadAwrReport(testRunId);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.html') || file.name.endsWith('.txt'))) {
      uploadMutation.mutate(file);
    } else {
      toast.error('Please upload an AWR report (.html or .txt)');
    }
  };

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <UploadFile fontSize="large" />
      <p>Drag & drop AWR report here or click to browse</p>
      <input
        type="file"
        accept=".html,.txt"
        onChange={(e) => e.target.files && uploadMutation.mutate(e.target.files[0])}
        style={{ display: 'none' }}
        id="awr-upload"
      />
      <label htmlFor="awr-upload">
        <Button component="span" variant="outlined">
          Choose File
        </Button>
      </label>
    </div>
  );
}
```

### UI Design

**Collapsed State:**
```
┌─────────────────────────────────────────────────────┐
│ 📊 AWR Report Analysis                     [Expand] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  📄 awr_report_25982_25983.html                    │
│     Uploaded: Nov 21, 2025 | Parsed ✓              │
│                                                     │
│  ⏱ DB Time: 236.65 min | 💻 CPU: 34% | 💾 I/O: 3%  │
│  ⚠ 3 Critical | ⚠ 12 Warnings | ℹ 8 Info          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Expanded State - Overview Tab:**
```
┌────────────────────────────────────────────────────┐
│ 📊 AWR Report Analysis                  [Collapse] │
├────────────────────────────────────────────────────┤
│ 📄 awr_report_25982_25983.html | DB: BSC_PAT_     │
│ Snapshot: 25982-25983 | Nov 21, 2025 14:00-15:00  │
├────────────────────────────────────────────────────┤
│ [Overview] [Top SQL] [Wait Events] [Insights]     │
├────────────────────────────────────────────────────┤
│                                                    │
│ Load Profile                                       │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ DB Time/sec:     4.0s                              │
│ DB CPU/sec:      1.4s  (34% of DB time)           │
│ Logical Reads:   50,758 blocks/sec                 │
│ Physical Reads:  0.9 blocks/sec                    │
│                                                    │
│ Time Model Statistics                              │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ sql execute elapsed time   13,721s  (96.6%)       │
│ DB CPU                      4,859s  (34.2%)       │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Expanded State - Insights Tab:**
```
┌────────────────────────────────────────────────────┐
│ 🔴 CRITICAL (3)                                    │
├────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────┐ │
│ │ High DB Time: SQL 1mkvp4m5tz0yt                │ │
│ │ This query consumed 20.98% of total DB time    │ │
│ │ Recommendation: Review execution plan...       │ │
│ │ [View SQL Details]                             │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ ⚠ WARNING (12)                                    │
├────────────────────────────────────────────────────┤
│ ...                                                │
└────────────────────────────────────────────────────┘
```

**Comparison View:**
```
┌─────────────────────────────────────────────────────┐
│ Baseline: [Select Test Run ▼]                      │
├─────────────────────────────────────────────────────┤
│ ┌─── Baseline ──────┐  ┌─── Current ──────┐        │
│ │ DB Time: 236 min  │  │ DB Time: 724 min │ +206%🔴│
│ │ CPU: 34%          │  │ CPU: 83%         │ +49%⚠ │
│ └───────────────────┘  └──────────────────┘        │
│                                                     │
│ SQL Regressions (4)                                 │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 🔴 SQL 1mkvp4m5tz0yt                               │
│    Elapsed/exec: 0.58s → 0.89s  (+53% regression)  │
│    Recommendation: Compare execution plans...      │
└─────────────────────────────────────────────────────┘
```

---

## Testing Strategy

### Test Pyramid

```
         /\
        /  \  E2E Tests (5%)
       /────\  - Upload → parse → analyze flow
      /      \
     /────────\ Integration Tests (15%)
    /          \ - Parser + Database
   /────────────\ - API endpoints
  /              \
 /────────────────\ Unit Tests (80%)
/                  \ - Parsers, analyzers, utils
────────────────────
```

### Unit Tests

```typescript
// parsers/sections/__tests__/load-profile-parser.spec.ts

describe('LoadProfileParser', () => {
  let parser: LoadProfileParser;

  beforeEach(() => {
    parser = new LoadProfileParser();
  });

  it('should parse load profile from valid HTML', () => {
    const html = `
      <table border="0" class="tdiff">
        <tr><th>Metric</th><th>Per Second</th></tr>
        <tr><td>DB Time(s):</td><td>4.0</td></tr>
      </table>
    `;

    const result = parser.parse(html);

    expect(result).toBeDefined();
    expect(result?.perSecond.dbTime).toBe(4.0);
  });

  it('should return null for invalid HTML', () => {
    const result = parser.parse('<div>No table</div>');
    expect(result).toBeNull();
  });
});
```

```typescript
// analyzers/__tests__/sql-analyzer.spec.ts

describe('SqlPerformanceAnalyzer', () => {
  let analyzer: SqlPerformanceAnalyzer;

  beforeEach(() => {
    analyzer = new SqlPerformanceAnalyzer(new Logger());
  });

  it('should identify queries with >5% DB time', () => {
    const topSql: TopSqlStatement[] = [
      {
        sqlId: 'abc123',
        pctTotalDbTime: 25, // High!
        pctCpu: 50,
        pctIo: 30,
        // ... other fields
      }
    ];

    const insights = analyzer.analyze({ topSql } as ParsedAwrData);

    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0].severity).toBe('critical');
    expect(insights[0].sql_id).toBe('abc123');
  });
});
```

### Integration Tests

```typescript
// awr-reports.controller.spec.ts

describe('AwrReportsController (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AwrModule, DatabaseModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('should upload and parse AWR report', async () => {
    const fileBuffer = readFileSync('./test-data/sample-awr.html');

    const response = await request(app.getHttpServer())
      .post('/test-runs/test-123/awr-reports')
      .attach('file', fileBuffer, 'sample-awr.html')
      .expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.parse_status).toBe('pending');
  });
});
```

---

## Configuration Management

```typescript
// config/awr-analysis.config.ts

export interface AwrAnalysisConfig {
  sql: {
    highDbTimeThreshold: number;
    cpuBoundThreshold: number;
    ioBoundThreshold: number;
    maxSqlToAnalyze: number;
  };

  waitEvents: {
    ioWaitThreshold: number;
    lockWaitThreshold: number;
  };

  comparison: {
    regressionThreshold: number;
    improvementThreshold: number;
  };

  parsing: {
    maxFileSizeMb: number;
    parseTimeoutSeconds: number;
  };
}

export const DEFAULT_AWR_ANALYSIS_CONFIG: AwrAnalysisConfig = {
  sql: {
    highDbTimeThreshold: 5,
    cpuBoundThreshold: 80,
    ioBoundThreshold: 60,
    maxSqlToAnalyze: 50,
  },
  waitEvents: {
    ioWaitThreshold: 30,
    lockWaitThreshold: 10,
  },
  comparison: {
    regressionThreshold: 20,
    improvementThreshold: 20,
  },
  parsing: {
    maxFileSizeMb: 100,
    parseTimeoutSeconds: 120,
  },
};
```

---

## Implementation Phases

### Phase 1: Backend Core (Week 1-2)

**Tasks:**
1. Database schema and migrations
2. Base parser infrastructure
3. Section parsers (header, load profile, SQL, wait events)
4. Basic CRUD endpoints
5. BullMQ queue setup
6. Unit tests for parsers

**Deliverables:**
- Upload AWR report via API
- Parse and store report metadata
- Extract top SQL and wait events

### Phase 2: Analysis Engine (Week 2-3)

**Tasks:**
1. Analyzer interface and base classes
2. SQL performance analyzer
3. Wait events analyzer
4. Resource utilization analyzer
5. Analysis orchestration service
6. Unit tests for analyzers

**Deliverables:**
- Generate insights from single report
- Severity scoring
- Impact calculation

### Phase 3: Comparison Logic (Week 3-4)

**Tasks:**
1. Comparison analyzer
2. Regression detection
3. Improvement detection
4. Delta calculation
5. Comparison endpoint
6. Unit tests for comparison

**Deliverables:**
- Compare two AWR reports
- Identify SQL regressions/improvements
- Wait event changes

### Phase 4: Frontend UI (Week 4-5)

**Tasks:**
1. AWR Report Card component
2. Upload zone with drag & drop
3. Tabs (Overview, SQL, Waits, Insights)
4. Insights display
5. Compare tab with baseline selector
6. Custom hooks for data fetching

**Deliverables:**
- Upload AWR reports from UI
- View parsed data and analysis
- Compare with baseline

### Phase 5: Polish & Testing (Week 5-6)

**Tasks:**
1. Integration tests
2. E2E tests for critical flows
3. Error handling improvements
4. Performance optimization
5. Documentation
6. Code review and refinement

**Deliverables:**
- Comprehensive test coverage
- Production-ready feature
- User documentation

---

## Success Criteria

### Functional Requirements

- ✅ User can upload AWR report (HTML format)
- ✅ Parser extracts 90%+ of key metrics
- ✅ Analysis generates actionable insights
- ✅ Comparison identifies SQL regressions (>20% slower)
- ✅ UI displays results within 30 seconds of upload
- ✅ Baseline selection works like config comparison

### Non-Functional Requirements

- ✅ Parse 5MB AWR report in < 15 seconds
- ✅ Support files up to 100MB
- ✅ 80% unit test coverage
- ✅ No performance degradation on test run details page
- ✅ Mobile-responsive UI

### Quality Requirements

- ✅ Code follows Perfana coding standards
- ✅ All public APIs have JSDoc comments
- ✅ Error messages are clear and actionable
- ✅ Logging at appropriate levels
- ✅ Graceful degradation for parsing failures

---

## Technical Considerations

### Performance

- **Large files**: Use streaming parser for 50MB+ files
- **Storage**: Store raw files in S3, not database
- **Caching**: Cache parsed results in PostgreSQL JSONB
- **Async processing**: BullMQ prevents blocking UI

### Scalability

- **Concurrent parsing**: BullMQ handles multiple jobs
- **Database indexing**: Index frequently queried fields
- **Pagination**: Paginate SQL statements (100+ per report)

### Error Handling

- **Validation**: File type, size limits
- **Graceful degradation**: Partial parsing if sections fail
- **Clear errors**: User-friendly error messages
- **Retry logic**: For transient failures

### Security

- **Authentication**: All endpoints require KeycloakEnhancedAuthGuard
- **Sanitization**: Clean HTML before storing/displaying
- **File validation**: Prevent malicious uploads
- **SQL injection**: Use parameterized queries

---

## Maintainability Checklist

### ✅ Code Organization
- [x] Clear module structure with single responsibilities
- [x] Separation of concerns (parsers, analyzers, services)
- [x] Consistent file naming and organization
- [x] Minimal dependencies between modules

### ✅ Code Quality
- [x] TypeScript with strict mode
- [x] Comprehensive type definitions
- [x] No `any` types without justification
- [x] ESLint and Prettier configured

### ✅ Patterns
- [x] Strategy pattern for parsers and analyzers
- [x] Small, focused functions (<50 lines)
- [x] DRY principle - reusable utilities
- [x] Consistent error handling

### ✅ Testing
- [x] Unit tests for all business logic (80% coverage)
- [x] Integration tests for critical paths
- [x] Test data fixtures
- [x] Clear test descriptions

### ✅ Documentation
- [x] JSDoc comments for public APIs
- [x] README files for each module
- [x] Architecture decision records
- [x] Inline comments for complex logic

### ✅ Configuration
- [x] Centralized configuration
- [x] Environment-specific settings
- [x] Easy to adjust thresholds
- [x] Feature flags for gradual rollout

### ✅ Error Handling
- [x] Graceful degradation
- [x] Clear error messages
- [x] Logging at appropriate levels
- [x] User-friendly error UI

---

## Appendix

### Sample AWR Report Sections

**Report Header:**
- DB Name, DB ID, Instance Name
- Oracle Edition, Release, RAC, CDB
- Host info (CPUs, cores, memory)
- Snapshot IDs and timestamps
- Elapsed time, DB time, sessions

**Load Profile:**
- Per second: DB time, CPU, redo size, logical reads, physical reads
- Per transaction: same metrics
- Per execution: same metrics
- Per call: same metrics

**Time Model Statistics:**
- sql execute elapsed time
- DB CPU
- parse time elapsed
- connection management call elapsed time

**Wait Events:**
- Event name
- Waits count
- Total wait time
- Average wait time
- % of DB time

**Top SQL:**
- SQL ID
- Executions
- Elapsed time (total and per execution)
- % of total DB time
- % CPU, % I/O
- SQL text (truncated)

**ADDM Findings:**
- Finding name
- Avg active sessions
- % active sessions
- Task name
- Snap times

### References

- Oracle AWR Report Documentation
- Perfana Coding Rules: `apps/api/CODING_RULES.md`
- Perfana Frontend Standards: `apps/web/CODING_RULES.md`
- Existing patterns: `ConfigurationComparisonCard.tsx`

---

**End of Specification**
