import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { JtlParserService, ParsedScenario } from './jtl-parser.service';
import { TestRunsMutationService } from './test-runs-mutation.service';
import { TestRunsConfigService } from './test-runs-config.service';
import { InitTestHandler } from '../handlers/init-test.handler';

const BATCH_SIZE = 1000;

export interface JtlImportOptions {
  systemUnderTest: string;
  testEnvironment: string;
  workload: string;
  rampUp?: number;
  configs?: Array<{ key: string; value: string }>;
  userId: string;
  roles: string[];
  organizationId: string;
}

export interface JtlImportResult {
  testRunId: string;
  scenarioCount: number;
}

@Injectable()
export class JtlImportService {
  private readonly logger = new Logger(JtlImportService.name);

  constructor(
    private readonly jtlParserService: JtlParserService,
    private readonly mutationService: TestRunsMutationService,
    private readonly configService: TestRunsConfigService,
    private readonly initTestHandler: InitTestHandler,
    private readonly dataSource: DataSource,
  ) {}

  async importJtl(
    zipBuffer: Buffer,
    options: JtlImportOptions,
  ): Promise<JtlImportResult> {
    const scenarios = this.jtlParserService.parseZip(zipBuffer);

    this.logger.log(
      `Importing ${scenarios.length} scenario(s) for ${options.systemUnderTest}/${options.testEnvironment}/${options.workload}`,
    );

    // Compute overall start/end time across all scenarios
    const overallStartTime = new Date(
      Math.min(...scenarios.map((s) => s.startTime.getTime())),
    );
    const overallEndTime = new Date(
      Math.max(...scenarios.map((s) => s.endTime.getTime())),
    );
    const duration = Math.floor(
      (overallEndTime.getTime() - overallStartTime.getTime()) / 1000,
    );

    // 1. Generate a single test_run_id
    const { testRunId } = await this.initTestHandler.execute(
      {
        systemUnderTest: options.systemUnderTest,
        testEnvironment: options.testEnvironment,
        workload: options.workload,
      },
      options.userId,
      options.organizationId,
    );

    this.logger.log(
      `Generated testRunId "${testRunId}" for ${scenarios.length} scenario(s)`,
    );

    // 2. Create test run as NOT completed (so analysis doesn't trigger before data is inserted)
    const scenarioNames = scenarios.map((s) => s.scenarioName);
    const testRun = await this.mutationService.updateRunningTest(
      {
        testRunId,
        systemUnderTest: options.systemUnderTest,
        testEnvironment: options.testEnvironment,
        workload: options.workload,
        start: overallStartTime.toISOString(),
        end: overallEndTime.toISOString(),
        duration,
        rampUp: options.rampUp || 0,
        completed: false,
        tags: [
          'source:jtl-upload',
          ...scenarioNames.map((n) => `scenario:${n}`),
        ],
      },
      options.userId,
      options.roles,
      options.organizationId,
    );

    // 3. Insert data for each scenario into the single test run
    for (const scenario of scenarios) {
      if (scenario.requests.length > 0) {
        await this.insertRequests(
          testRunId,
          options.systemUnderTest,
          options.testEnvironment,
          scenario.scenarioName,
          scenario.requests,
        );
      }

      if (scenario.transactions.length > 0) {
        await this.insertTransactions(
          testRunId,
          options.systemUnderTest,
          options.testEnvironment,
          scenario.scenarioName,
          scenario.transactions,
        );
      }

      // Insert failed requests into requests_error table
      const failedRequests = scenario.requests.filter((r) => !r.success);
      if (failedRequests.length > 0) {
        await this.insertErrors(
          testRunId,
          options.systemUnderTest,
          options.testEnvironment,
          scenario.scenarioName,
          failedRequests,
        );
      }

      if (scenario.virtualUsers.length > 0) {
        await this.insertVirtualUsers(
          testRunId,
          options.systemUnderTest,
          options.testEnvironment,
          scenario.scenarioName,
          scenario.virtualUsers,
        );
      }

      this.logger.log(
        `Inserted scenario "${scenario.scenarioName}": ` +
          `${scenario.requests.length} requests, ${scenario.transactions.length} transactions, ` +
          `${failedRequests.length} errors, ${scenario.virtualUsers.length} VU samples`,
      );
    }

    // 4. Insert URL patterns for all unique URLs across scenarios
    const allRequests = scenarios.flatMap((s) => s.requests);
    const urlsWithData = allRequests
      .filter((r) => r.url)
      .map((r) => ({ url: r.url, time: r.time }));
    if (urlsWithData.length > 0) {
      await this.insertUrlPatterns(
        options.systemUnderTest,
        options.testEnvironment,
        options.organizationId,
        options.userId,
        urlsWithData,
      );
    }

    // 5. Store config key-value pairs
    if (options.configs && options.configs.length > 0) {
      await this.configService.addTestRunConfigsByUuid(
        testRun.id,
        ['jtl-upload'],
        options.configs,
      );
    }

    // 6. Mark test run as completed now that all data is inserted
    //    This triggers handleCompletedTest -> bullmqClientService.analyzeTest
    await this.mutationService.updateRunningTest(
      {
        testRunId,
        systemUnderTest: options.systemUnderTest,
        testEnvironment: options.testEnvironment,
        workload: options.workload,
        start: overallStartTime.toISOString(),
        end: overallEndTime.toISOString(),
        duration,
        rampUp: options.rampUp || 0,
        completed: true,
        tags: [
          'source:jtl-upload',
          ...scenarioNames.map((n) => `scenario:${n}`),
        ],
      },
      options.userId,
      options.roles,
      options.organizationId,
    );

    const totalRequests = scenarios.reduce((sum, s) => sum + s.requests.length, 0);
    const totalTransactions = scenarios.reduce((sum, s) => sum + s.transactions.length, 0);

    this.logger.log(
      `Import complete: testRunId="${testRunId}", ${scenarios.length} scenarios, ` +
        `${totalRequests} requests, ${totalTransactions} transactions, duration=${duration}s`,
    );

    return { testRunId, scenarioCount: scenarios.length };
  }

  private async insertRequests(
    testRunId: string,
    systemUnderTest: string,
    testEnvironment: string,
    scenarioName: string,
    requests: ParsedScenario['requests'],
  ): Promise<void> {
    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      const batch = requests.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: (string | number | boolean | Date | null)[] = [];
      let paramIdx = 1;

      for (const row of batch) {
        const urlHash = row.url ? this.computeUrlHash(row.url) : null;
        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, ` +
            `$${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, ` +
            `$${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, $${paramIdx + 13}, $${paramIdx + 14}, $${paramIdx + 15})`,
        );
        params.push(
          row.time,                // time
          testRunId,               // test_run_id
          systemUnderTest,         // system_under_test
          testEnvironment,         // test_environment
          'default',               // location
          row.transactionName,     // transaction_name
          row.samplerName,         // sampler_name
          row.success,             // success
          row.requestSize,         // request_size
          row.responseSize,        // response_size
          row.responseCode,        // response_code
          row.responseConnectTime, // response_connect_time
          row.responseLatency,     // response_latency
          row.responseTime,        // response_time
          scenarioName,            // scenario_name
          urlHash,                 // url_hash
        );
        paramIdx += 16;
      }

      await this.dataSource.query(
        `INSERT INTO requests_raw (time, test_run_id, system_under_test, test_environment, location,
          transaction_name, sampler_name, success, request_size, response_size,
          response_code, response_connect_time, response_latency, response_time, scenario_name, url_hash)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    this.logger.debug(
      `Inserted ${requests.length} request rows for ${testRunId}/${scenarioName}`,
    );
  }

  private async insertTransactions(
    testRunId: string,
    systemUnderTest: string,
    testEnvironment: string,
    scenarioName: string,
    transactions: ParsedScenario['transactions'],
  ): Promise<void> {
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: (string | number | boolean | Date | null)[] = [];
      let paramIdx = 1;

      for (const row of batch) {
        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, ` +
            `$${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10})`,
        );
        params.push(
          row.time,            // time
          testRunId,           // test_run_id
          systemUnderTest,     // system_under_test
          testEnvironment,     // test_environment
          'default',           // location
          row.transactionName, // transaction_name
          row.success,         // success
          row.requestSize,     // request_size
          row.responseSize,    // response_size
          row.responseTime,    // response_time
          scenarioName,        // scenario_name
        );
        paramIdx += 11;
      }

      await this.dataSource.query(
        `INSERT INTO transactions (time, test_run_id, system_under_test, test_environment, location,
          transaction_name, success, request_size, response_size, response_time, scenario_name)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    this.logger.debug(
      `Inserted ${transactions.length} transaction rows for ${testRunId}/${scenarioName}`,
    );
  }

  private async insertErrors(
    testRunId: string,
    systemUnderTest: string,
    testEnvironment: string,
    scenarioName: string,
    errors: ParsedScenario['requests'],
  ): Promise<void> {
    for (let i = 0; i < errors.length; i += BATCH_SIZE) {
      const batch = errors.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: (string | number | boolean | Date | null)[] = [];
      let paramIdx = 1;

      for (const row of batch) {
        const urlHash = row.url ? this.computeUrlHash(row.url) : null;
        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, ` +
            `$${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, ` +
            `$${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, $${paramIdx + 13}, $${paramIdx + 14})`,
        );
        params.push(
          row.time,                                            // time
          testRunId,                                           // test_run_id
          systemUnderTest,                                     // system_under_test
          testEnvironment,                                     // test_environment
          'default',                                           // location
          'default',                                           // node_name
          row.transactionName,                                 // transaction_name
          row.samplerName,                                     // sampler_name
          row.responseCode,                                    // response_code
          row.responseTime,                                    // response_time
          row.responseConnectTime,                             // connection_time
          row.url,                                             // url
          row.failureMessage || row.responseMessage || null,   // response_message
          scenarioName,                                        // scenario_name
          urlHash,                                             // url_hash
        );
        paramIdx += 15;
      }

      await this.dataSource.query(
        `INSERT INTO requests_error (time, test_run_id, system_under_test, test_environment, location,
          node_name, transaction_name, sampler_name, response_code, response_time,
          connection_time, url, response_message, scenario_name, url_hash)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    this.logger.debug(
      `Inserted ${errors.length} error rows for ${testRunId}/${scenarioName}`,
    );
  }

  private async insertVirtualUsers(
    testRunId: string,
    systemUnderTest: string,
    testEnvironment: string,
    scenarioName: string,
    virtualUsers: ParsedScenario['virtualUsers'],
  ): Promise<void> {
    for (let i = 0; i < virtualUsers.length; i += BATCH_SIZE) {
      const batch = virtualUsers.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: (string | number | boolean | Date | null)[] = [];
      let paramIdx = 1;

      for (const row of batch) {
        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, ` +
            `$${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`,
        );
        params.push(
          row.time,         // time
          testRunId,        // test_run_id
          systemUnderTest,  // system_under_test
          testEnvironment,  // test_environment
          'default',        // location
          scenarioName,     // node_name (use scenario name)
          row.allThreads,   // active_threads
          scenarioName,     // scenario_name
        );
        paramIdx += 8;
      }

      await this.dataSource.query(
        `INSERT INTO virtual_users (time, test_run_id, system_under_test, test_environment, location,
          node_name, active_threads, scenario_name)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    this.logger.debug(
      `Inserted ${virtualUsers.length} virtual user rows for ${testRunId}/${scenarioName}`,
    );
  }

  /**
   * Normalize a URL by replacing dynamic path segments and query parameter values
   * with placeholders, matching the pattern used by the JMeter plugin.
   *
   * Path segments that look like IDs (numeric, UUIDs, hex tokens) -> {id}
   * Query parameter values -> {val}
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Normalize path segments: replace numeric IDs, UUIDs, hex tokens
      // Build path string manually to avoid URL-encoding of {id} placeholders
      const segments = parsed.pathname.split('/');
      const normalizedPath = segments
        .map((seg) => {
          if (!seg) return seg;
          // UUID pattern
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return '{id}';
          // Pure numeric
          if (/^\d+$/.test(seg)) return '{id}';
          // Long hex string (likely a hash/token)
          if (/^[0-9a-f]{8,}$/i.test(seg)) return '{id}';
          return seg;
        })
        .join('/');

      // Normalize query parameter values
      // Build string manually to avoid URLSearchParams encoding {val} as %7Bval%7D
      const paramKeys = Array.from(parsed.searchParams.keys());
      if (paramKeys.length > 0) {
        const normalizedQuery = paramKeys.map((key) => `${key}={val}`).join('&');
        return `${parsed.origin}${normalizedPath}?${normalizedQuery}`;
      }

      return `${parsed.origin}${normalizedPath}`;
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  }

  /**
   * Compute MD5 hash of the normalized URL
   */
  private computeUrlHash(url: string): string {
    const normalized = this.normalizeUrl(url);
    return createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Insert unique URL patterns into the url_patterns table
   */
  private async insertUrlPatterns(
    systemUnderTest: string,
    testEnvironment: string,
    organizationId: string,
    userId: string,
    urlsWithTime: Array<{ url: string; time: Date }>,
  ): Promise<void> {
    // Deduplicate by url_hash, keeping the earliest time and first URL as example
    const patternMap = new Map<string, { normalized: string; example: string; firstSeen: Date }>();

    for (const { url, time } of urlsWithTime) {
      const normalized = this.normalizeUrl(url);
      const hash = createHash('md5').update(normalized).digest('hex');

      const existing = patternMap.get(hash);
      if (!existing || time < existing.firstSeen) {
        patternMap.set(hash, { normalized, example: url, firstSeen: time });
      }
    }

    const patterns = Array.from(patternMap.entries());
    if (patterns.length === 0) return;

    // Batch upsert into url_patterns
    for (let i = 0; i < patterns.length; i += BATCH_SIZE) {
      const batch = patterns.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: (string | number | boolean | Date | null)[] = [];
      let paramIdx = 1;

      for (const [hash, { normalized, example, firstSeen }] of batch) {
        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8})`,
        );
        params.push(
          hash,              // url_hash
          systemUnderTest,   // system_under_test
          testEnvironment,   // test_environment
          normalized,        // normalized_url
          example,           // original_example
          firstSeen,         // first_seen
          organizationId,    // organization_id
          userId,            // created_by
          userId,            // updated_by
        );
        paramIdx += 9;
      }

      await this.dataSource.query(
        `INSERT INTO url_patterns (url_hash, system_under_test, test_environment,
          normalized_url, original_example, first_seen, organization_id, created_by, updated_by)
         VALUES ${values.join(', ')}
         ON CONFLICT (url_hash, system_under_test, test_environment) DO NOTHING`,
        params,
      );
    }

    this.logger.log(`Inserted ${patterns.length} URL pattern(s)`);
  }
}
