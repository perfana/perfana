import { Injectable, Logger } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { parse } from 'csv-parse/sync';

export interface JtlRequestRow {
  time: Date;
  transactionName: string;
  samplerName: string;
  responseCode: string;
  responseMessage: string;
  failureMessage: string;
  success: boolean;
  requestSize: number;
  responseSize: number;
  responseConnectTime: number;
  responseLatency: number;
  responseTime: number;
  url: string;
}

export interface JtlTransactionRow {
  time: Date;
  transactionName: string;
  success: boolean;
  requestSize: number;
  responseSize: number;
  responseTime: number;
}

export interface VirtualUserSample {
  time: Date;
  grpThreads: number;
  allThreads: number;
}

export interface ParsedScenario {
  scenarioName: string;
  requests: JtlRequestRow[];
  transactions: JtlTransactionRow[];
  startTime: Date;
  endTime: Date;
  virtualUsers: VirtualUserSample[];
}

@Injectable()
export class JtlParserService {
  private readonly logger = new Logger(JtlParserService.name);

  /**
   * Extract zip buffer and parse all JTL scenarios.
   * Each *.jtl file in the zip becomes one or more scenarios.
   * When a JTL file contains multiple JMeter thread groups (identified
   * by the threadName column), each thread group becomes a separate scenario.
   * Otherwise the parent folder name is used as the scenario name.
   *
   * By default, two types of Parallel Controller rows are excluded:
   *   - Sub-requests: rows emitted by PC virtual threads (threadName === '').
   *   - Container rows: PC aggregation rows with no HTTP data (dataType === '').
   * Set includeSubTransactions: true to retain them.
   */
  parseZip(zipBuffer: Buffer, options?: { includeSubTransactions?: boolean }): ParsedScenario[] {
    const includeSubTransactions = options?.includeSubTransactions ?? false;
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // Find all .jtl files
    const jtlEntries = entries.filter(
      (entry: AdmZip.IZipEntry) => !entry.isDirectory && entry.entryName.endsWith('.jtl'),
    );

    if (jtlEntries.length === 0) {
      throw new Error('No .jtl files found in the zip archive');
    }

    this.logger.log(`Found ${jtlEntries.length} JTL file(s) in zip`);

    const scenarios: ParsedScenario[] = [];

    for (const entry of jtlEntries) {
      const scenarioName = this.extractScenarioName(entry.entryName);
      const csvContent = entry.getData().toString('utf-8');

      this.logger.log(
        `Parsing JTL file: ${entry.entryName} (scenario: ${scenarioName}, size: ${csvContent.length} bytes)`,
      );

      const parsed = this.parseCsv(csvContent, scenarioName, includeSubTransactions);
      scenarios.push(...parsed);
    }

    return scenarios;
  }

  /**
   * Drop lines whose quote characters are unbalanced (odd count).
   * JMeter writes JTL files from multiple threads without file-level locking;
   * two threads can interleave their output onto one physical line.  Every
   * such corrupted line contains exactly one stray `"` — either an unclosed
   * opening quote from a transaction-message field, or a closing quote from
   * an interleaved transaction message appended to an unrelated field value.
   * Either way the line is unusable and safe to discard.
   * The header line (which never contains quotes) is always kept.
   */
  /**
   * Count commas that are outside of quoted fields.
   * A valid CSV row always has exactly (headerColumnCount - 1) such commas,
   * regardless of how many commas appear inside quoted field values.
   */
  private countUnquotedCommas(line: string): number {
    let count = 0;
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ',' && !inQuote) count++;
    }
    return count;
  }

  /**
   * Drop lines whose structure is broken by JMeter concurrent-write interleaving.
   * Three patterns detected:
   *
   * A — odd `"` count: one `"` without a matching pair.
   *
   * B — even `"` count but a closing `"` is followed by something other than
   *     `,`, `\r`, `\n`, or `"`.  E.g. `"…samples : 0"0,…` where `0` lands
   *     immediately after the closing quote.
   *
   * C — wrong number of unquoted commas.  A valid row always has exactly
   *     (headerColumns - 1) unquoted commas.  Column-shifted rows (an extra
   *     comma from an un-quoted transaction message) or merged rows (two rows
   *     concatenated) have the wrong count and slip past patterns A and B.
   *     This is the main cause of fake thread-groups and NaN start/end times.
   */
  private removeCorruptedLines(content: string, scenarioName: string): string {
    const BAD_CLOSING = /[^,\r\n]"[^,\r\n"]/;
    const lines = content.split(/\r?\n/);
    if (lines.length === 0) return content;

    const expectedCommas = this.countUnquotedCommas(lines[0]!);

    const cleaned: string[] = [lines[0]!];
    let dropped = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) {
        cleaned.push(line); // skip_empty_lines handles blanks; keep them
        continue;
      }
      const quoteCount = (line.match(/"/g) ?? []).length;
      if (
        quoteCount % 2 !== 0 ||
        BAD_CLOSING.test(line) ||
        this.countUnquotedCommas(line) !== expectedCommas
      ) {
        dropped++;
      } else {
        cleaned.push(line);
      }
    }
    if (dropped > 0) {
      this.logger.warn(
        `Dropped ${dropped} corrupted line(s) from "${scenarioName}" (concurrent JMeter thread-write interleaving)`,
      );
    }
    return cleaned.join('\n');
  }

  private extractScenarioName(entryName: string): string {
    // entryName e.g. "scenarioFolder/results_001.jtl" or "results.jtl"
    const parts = entryName.replace(/\\/g, '/').split('/');
    if (parts.length >= 2) {
      // Parent folder name is the scenario name
      return parts[parts.length - 2]!;
    }
    // If no folder, use the filename without extension
    return parts[0]!.replace(/\.jtl$/, '');
  }

  /**
   * Parse CSV content and return one or more scenarios.
   * When a JTL contains multiple JMeter thread groups (via the threadName
   * column), each group becomes a separate scenario.  Otherwise the
   * folder-based scenarioName is used (backward compatible).
   */
  private parseCsv(
    csvContent: string,
    scenarioName: string,
    includeSubTransactions = false,
  ): ParsedScenario[] {
    const cleanedContent = this.removeCorruptedLines(csvContent, scenarioName);
    const records = parse(cleanedContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    if (records.length === 0) {
      return [];
    }

    // Detect multiple thread groups via the threadName column
    const hasThreadName =
      records[0] !== undefined && 'threadName' in records[0];

    if (hasThreadName) {
      const groupedRecords = new Map<string, Record<string, string>[]>();
      for (const row of records) {
        const groupName = this.extractThreadGroupName(
          row['threadName'] || '',
        );
        let group = groupedRecords.get(groupName);
        if (!group) {
          group = [];
          groupedRecords.set(groupName, group);
        }
        group.push(row);
      }

      // Drop the empty-thread-name group: these are Parallel Controller
      // sub-requests that run in virtual threads with no thread name.
      if (!includeSubTransactions) groupedRecords.delete('');

      if (groupedRecords.size > 1) {
        this.logger.log(
          `Detected ${groupedRecords.size} thread groups in "${scenarioName}": ` +
            `${Array.from(groupedRecords.keys()).join(', ')}`,
        );

        const scenarios: ParsedScenario[] = [];
        for (const [groupName, groupRecords] of groupedRecords) {
          scenarios.push(
            this.buildScenarioFromRecords(groupRecords, groupName, true, includeSubTransactions),
          );
        }
        return scenarios;
      }
    }

    // Single thread group or no threadName column — use folder-based name.
    // Still filter out empty-threadName rows (PC sub-requests) for the
    // single-group path, since they never belong in the main scenario.
    const activeRecords =
      includeSubTransactions
        ? records
        : records.filter((r) => (r['threadName'] ?? '') !== '');
    return [this.buildScenarioFromRecords(activeRecords, scenarioName, false, includeSubTransactions)];
  }

  /**
   * Extract the thread group name from a JMeter threadName value.
   * JMeter format: "ThreadGroupName N-N" (e.g. "Init 1-1", "KP01_loadtest 3-2").
   */
  private extractThreadGroupName(threadName: string): string {
    return threadName.replace(/ \d+-\d+$/, '') || threadName;
  }

  /**
   * Build a ParsedScenario from pre-parsed CSV records.
   *
   * @param isThreadGroupSplit - When true, uses grpThreads for VU tracking
   *   (per-thread-group count) instead of allThreads (global total).
   * @param includeSubTransactions - When false (default), rows with an empty
   *   dataType (Parallel Controller container rows) are excluded from requests.
   */
  private buildScenarioFromRecords(
    records: Record<string, string>[],
    scenarioName: string,
    isThreadGroupSplit: boolean,
    includeSubTransactions = false,
  ): ParsedScenario {
    const requests: JtlRequestRow[] = [];
    const transactions: JtlTransactionRow[] = [];

    let minTime = Infinity;
    let maxTimeWithElapsed = -Infinity;
    // Per-thread transaction label: JMeter writes rows from concurrent VU threads
    // interleaved by timestamp, so a single shared label would assign requests from
    // one thread to the last transaction seen on a different thread.
    const transactionLabelByThread = new Map<string, string>();

    // Track VU samples per second to avoid duplicates
    const vuPerSecond = new Map<number, VirtualUserSample>();

    for (const row of records) {
      const timeStamp = parseInt(row['timeStamp'] || '0', 10);
      const elapsed = parseInt(row['elapsed'] || '0', 10);
      const label = row['label'] || '';
      const responseCode = row['responseCode'] || '';
      const responseMessage = row['responseMessage'] || '';
      const success = row['success'] === 'true';
      const bytes = parseInt(row['bytes'] || '0', 10);
      const sentBytes = parseInt(row['sentBytes'] || '0', 10);
      const grpThreads = parseInt(row['grpThreads'] || '0', 10);
      const allThreads = parseInt(row['allThreads'] || '0', 10);
      const failureMessage = row['failureMessage'] || '';
      const url = row['URL'] || '';
      const latency = parseInt(row['Latency'] || '0', 10);
      const connectTime = parseInt(row['Connect'] || '0', 10);
      const threadName = row['threadName'] || '';

      const time = new Date(timeStamp);

      // Track min/max times
      if (timeStamp < minTime) minTime = timeStamp;
      if (timeStamp + elapsed > maxTimeWithElapsed)
        maxTimeWithElapsed = timeStamp + elapsed;

      // Classify: transaction row vs request row
      const isTransaction = responseMessage.startsWith(
        'Number of samples in transaction',
      );

      if (isTransaction) {
        transactionLabelByThread.set(threadName, label);
        transactions.push({
          time,
          transactionName: label,
          success,
          requestSize: sentBytes,
          responseSize: bytes,
          responseTime: elapsed,
        });
      } else if (includeSubTransactions || (row['dataType'] ?? 'text') !== '') {
        // Exclude Parallel Controller container rows: they have dataType='' and
        // carry no real HTTP data. TC rows are always kept (handled above).
        requests.push({
          time,
          transactionName: transactionLabelByThread.get(threadName) || label,
          samplerName: label,
          responseCode,
          responseMessage,
          failureMessage,
          success,
          requestSize: sentBytes,
          responseSize: bytes,
          responseConnectTime: connectTime,
          responseLatency: latency,
          responseTime: elapsed,
          url,
        });
      }

      // Sample virtual users (one per second)
      // When split by thread group, use grpThreads (per-group count)
      // rather than allThreads (global total)
      const vuCount = isThreadGroupSplit ? grpThreads : allThreads;
      const secondBucket = Math.floor(timeStamp / 1000);
      if (!vuPerSecond.has(secondBucket)) {
        vuPerSecond.set(secondBucket, {
          time: new Date(secondBucket * 1000),
          grpThreads,
          allThreads: vuCount,
        });
      }
    }

    // Convert VU map to sorted array
    const virtualUsers = Array.from(vuPerSecond.values()).sort(
      (a, b) => a.time.getTime() - b.time.getTime(),
    );

    // When no JMeter Transaction Controllers are present, synthesize
    // transaction rows from the raw requests so the analysis pipeline
    // (TransactionsProcessor) still produces per-label metrics.
    // Each request becomes its own single-sampler transaction.
    if (transactions.length === 0 && requests.length > 0) {
      this.logger.log(
        `No transaction rows detected in "${scenarioName}" — synthesizing transactions from ${requests.length} requests`,
      );

      for (const req of requests) {
        transactions.push({
          time: req.time,
          transactionName: req.samplerName,
          success: req.success,
          requestSize: req.requestSize,
          responseSize: req.responseSize,
          responseTime: req.responseTime,
        });
      }

      // Keep transactionName = samplerName (the label) on requests so
      // the UI's "get samplers for transaction" query can join:
      //   requests_raw.transaction_name = transactions.transaction_name
      // The worker's buildNewRequestMetricName handles the case where
      // transactionName === samplerName by skipping the redundant prefix.
    }

    const startTime =
      minTime === Infinity ? new Date() : new Date(minTime);
    const endTime =
      maxTimeWithElapsed === -Infinity
        ? new Date()
        : new Date(maxTimeWithElapsed);

    this.logger.log(
      `Parsed scenario "${scenarioName}": ${requests.length} requests, ${transactions.length} transactions, ${virtualUsers.length} VU samples, ` +
        `duration: ${Math.round((endTime.getTime() - startTime.getTime()) / 1000)}s`,
    );

    return {
      scenarioName,
      requests,
      transactions,
      startTime,
      endTime,
      virtualUsers,
    };
  }
}
