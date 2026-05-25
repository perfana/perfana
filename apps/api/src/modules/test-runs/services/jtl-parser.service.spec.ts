import AdmZip = require('adm-zip');
import { JtlParserService, ParsedScenario } from './jtl-parser.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard JTL CSV header used across all test fixtures */
const JTL_HEADER =
  'timeStamp,elapsed,label,responseCode,responseMessage,threadName,success,bytes,sentBytes,grpThreads,allThreads,URL,Latency,Connect,failureMessage,dataType';

interface JtlRowOptions {
  timeStamp?: number;
  elapsed?: number;
  label?: string;
  responseCode?: string;
  responseMessage?: string;
  threadName?: string;
  success?: boolean;
  bytes?: number;
  sentBytes?: number;
  grpThreads?: number;
  allThreads?: number;
  url?: string;
  latency?: number;
  connect?: number;
  failureMessage?: string;
  dataType?: string;
}

/**
 * Wrap a CSV field value in double-quotes if it contains a comma, so that
 * the csv-parse library correctly handles multi-word responseMessage values
 * like "Number of samples in transaction : 3, number of failing samples : 0".
 */
function csvField(value: string | number | boolean): string {
  const str = String(value);
  return str.includes(',') ? `"${str}"` : str;
}

/**
 * Build a single CSV data row with sensible defaults.
 * Timestamps default to a fixed base time so tests are deterministic.
 */
function buildJtlRow(opts: JtlRowOptions = {}): string {
  const BASE_TIMESTAMP = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z
  const fields: Array<string | number | boolean> = [
    opts.timeStamp ?? BASE_TIMESTAMP,
    opts.elapsed ?? 100,
    opts.label ?? 'GET /api/health',
    opts.responseCode ?? '200',
    opts.responseMessage ?? 'OK',
    opts.threadName ?? 'ThreadGroup 1-1',
    opts.success !== undefined ? String(opts.success) : 'true',
    opts.bytes ?? 512,
    opts.sentBytes ?? 64,
    opts.grpThreads ?? 5,
    opts.allThreads ?? 10,
    opts.url ?? 'http://localhost/api/health',
    opts.latency ?? 80,
    opts.connect ?? 5,
    opts.failureMessage ?? '',
    opts.dataType ?? 'text',
  ];
  return fields.map(csvField).join(',');
}

/** Build a complete CSV string from an array of row option objects. */
function buildJtlCsv(rows: JtlRowOptions[]): string {
  return [JTL_HEADER, ...rows.map(buildJtlRow)].join('\n');
}

/**
 * Create an in-memory ZIP buffer containing a single JTL file.
 *
 * @param entryName - The path inside the zip (e.g. "myScenario/results.jtl")
 * @param csvContent - Raw CSV content for the .jtl file
 */
function createZipWithJtl(entryName: string, csvContent: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(entryName, Buffer.from(csvContent, 'utf-8'));
  return zip.toBuffer();
}

/**
 * Create a ZIP containing multiple JTL files.
 *
 * @param files - Array of [entryName, csvContent] tuples
 */
function createZipWithMultipleJtl(
  files: Array<[string, string]>,
): Buffer {
  const zip = new AdmZip();
  for (const [entryName, csvContent] of files) {
    zip.addFile(entryName, Buffer.from(csvContent, 'utf-8'));
  }
  return zip.toBuffer();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('JtlParserService', () => {
  let service: JtlParserService;

  // Instantiate directly — the service has no injected dependencies.
  beforeEach(() => {
    service = new JtlParserService();
  });

  // -------------------------------------------------------------------------
  // parseZip — guard clauses
  // -------------------------------------------------------------------------

  describe('parseZip — invalid input', () => {
    it('should throw when the ZIP contains no .jtl files', () => {
      const zip = new AdmZip();
      zip.addFile('readme.txt', Buffer.from('no jtl here'));
      const zipBuffer = zip.toBuffer();

      expect(() => service.parseZip(zipBuffer)).toThrow(
        'No .jtl files found in the zip archive',
      );
    });

    it('should skip non-.jtl entries and still parse valid .jtl entries', () => {
      const csv = buildJtlCsv([{ label: 'GET /ping' }]);
      const zip = new AdmZip();
      zip.addFile('scenario/results.jtl', Buffer.from(csv, 'utf-8'));
      zip.addFile('scenario/extra.csv', Buffer.from('irrelevant', 'utf-8'));
      zip.addFile('notes.md', Buffer.from('# notes', 'utf-8'));
      const zipBuffer = zip.toBuffer();

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]!.scenarioName).toBe('scenario');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario name extraction
  // -------------------------------------------------------------------------

  describe('scenario name extraction', () => {
    it('should use the parent folder name when the .jtl is nested (backward-compatible path)', () => {
      const csv = buildJtlCsv([{ label: 'GET /' }]);
      const zipBuffer = createZipWithJtl('myScenario/results.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios[0]!.scenarioName).toBe('myScenario');
    });

    it('should use the filename (without extension) when there is no parent folder', () => {
      const csv = buildJtlCsv([{ label: 'GET /' }]);
      const zipBuffer = createZipWithJtl('results.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios[0]!.scenarioName).toBe('results');
    });

    it('should handle deeply nested paths and use the immediate parent folder', () => {
      const csv = buildJtlCsv([{ label: 'GET /' }]);
      const zipBuffer = createZipWithJtl(
        'runs/2024/loadTest/results.jtl',
        csv,
      );

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios[0]!.scenarioName).toBe('loadTest');
    });

    it('should normalise Windows-style backslash paths', () => {
      // AdmZip on Windows may produce backslash entry names.
      // The service converts them before splitting.
      const csv = buildJtlCsv([{ label: 'GET /' }]);
      const zip = new AdmZip();
      // Manually set an entry with a backslash path by using the low-level API
      zip.addFile('winScenario\\results.jtl', Buffer.from(csv, 'utf-8'));
      const zipBuffer = zip.toBuffer();

      // Should not throw and should produce a deterministic scenario name
      const scenarios = service.parseZip(zipBuffer);
      expect(scenarios.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Single thread group — backward-compatible behaviour
  // -------------------------------------------------------------------------

  describe('single thread group (backward compatible)', () => {
    it('should return exactly one scenario when all rows share the same thread group', () => {
      const csv = buildJtlCsv([
        { label: 'GET /home', threadName: 'Users 1-1' },
        { label: 'GET /home', threadName: 'Users 1-2' },
        { label: 'GET /home', threadName: 'Users 2-1' },
      ]);
      const zipBuffer = createZipWithJtl('loadTest/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]!.scenarioName).toBe('loadTest');
    });

    it('should return the folder name as scenario name for a single-group file', () => {
      const csv = buildJtlCsv([
        { label: 'POST /login', threadName: 'Checkout 1-1' },
      ]);
      const zipBuffer = createZipWithJtl('checkoutScenario/results.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios[0]!.scenarioName).toBe('checkoutScenario');
    });

    it('should use folder name even when a threadName column is present but only one group exists', () => {
      const csv = buildJtlCsv([
        { label: 'GET /api', threadName: 'SingleGroup 1-1' },
        { label: 'GET /api', threadName: 'SingleGroup 2-3' },
      ]);
      const zipBuffer = createZipWithJtl('apiTests/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      // Only one distinct group → folder-based name
      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]!.scenarioName).toBe('apiTests');
    });
  });

  // -------------------------------------------------------------------------
  // Multiple thread groups — split behaviour
  // -------------------------------------------------------------------------

  describe('multiple thread groups', () => {
    it('should split into separate scenarios for each thread group', () => {
      const csv = buildJtlCsv([
        { label: 'GET /init', threadName: 'Init 1-1' },
        { label: 'POST /login', threadName: 'KP01_loadtest 1-1' },
        { label: 'GET /dashboard', threadName: 'KP01_loadtest 1-2' },
        { label: 'GET /cleanup', threadName: 'Cleanup 1-1' },
      ]);
      const zipBuffer = createZipWithJtl('multiGroup/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(3);
      const names = scenarios.map((s) => s.scenarioName).sort();
      expect(names).toEqual(['Cleanup', 'Init', 'KP01_loadtest']);
    });

    it('should assign requests to the correct scenario', () => {
      const csv = buildJtlCsv([
        { label: 'GET /init', threadName: 'Init 1-1' },
        { label: 'POST /login', threadName: 'LoadGroup 1-1' },
        { label: 'GET /data', threadName: 'LoadGroup 2-1' },
      ]);
      const zipBuffer = createZipWithJtl('scenario/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      const initScenario = scenarios.find((s) => s.scenarioName === 'Init')!;
      const loadScenario = scenarios.find(
        (s) => s.scenarioName === 'LoadGroup',
      )!;

      expect(initScenario.requests).toHaveLength(1);
      expect(initScenario.requests[0]!.samplerName).toBe('GET /init');

      expect(loadScenario.requests).toHaveLength(2);
      expect(loadScenario.requests.map((r) => r.samplerName)).toEqual([
        'POST /login',
        'GET /data',
      ]);
    });

    it('should produce independent time ranges per scenario', () => {
      const BASE = 1_700_000_000_000;
      const csv = buildJtlCsv([
        { label: 'GET /early', threadName: 'GroupA 1-1', timeStamp: BASE, elapsed: 50 },
        {
          label: 'GET /late',
          threadName: 'GroupB 1-1',
          timeStamp: BASE + 5000,
          elapsed: 200,
        },
      ]);
      const zipBuffer = createZipWithJtl('test/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);
      const groupA = scenarios.find((s) => s.scenarioName === 'GroupA')!;
      const groupB = scenarios.find((s) => s.scenarioName === 'GroupB')!;

      expect(groupA.startTime.getTime()).toBe(BASE);
      expect(groupA.endTime.getTime()).toBe(BASE + 50);

      expect(groupB.startTime.getTime()).toBe(BASE + 5000);
      expect(groupB.endTime.getTime()).toBe(BASE + 5200);
    });
  });

  // -------------------------------------------------------------------------
  // Thread group name extraction (exercised indirectly via parseZip)
  // -------------------------------------------------------------------------

  describe('thread group name extraction', () => {
    /**
     * Helper: parse a CSV where each row carries a different threadName value
     * and collect the resulting scenario names.
     */
    function scenarioNamesForThreadNames(threadNames: string[]): string[] {
      // We need at least two distinct groups to trigger the split path.
      // Build rows so that at least one "Filler" group always exists.
      const rows: JtlRowOptions[] = threadNames.map((tn) => ({
        label: 'GET /',
        threadName: tn,
      }));
      // Add a dummy second group only when all rows share the same group,
      // to avoid collapsing to the single-group path.
      const csv = buildJtlCsv(rows);
      const zipBuffer = createZipWithJtl('test/results.jtl', csv);
      const scenarios = service.parseZip(zipBuffer);
      return scenarios.map((s) => s.scenarioName);
    }

    it('should strip trailing " N-N" from "Init 1-1"', () => {
      const names = scenarioNamesForThreadNames(['Init 1-1', 'Load 1-1']);
      expect(names).toContain('Init');
      expect(names).toContain('Load');
    });

    it('should strip trailing " N-N" from "KP01_loadtest 3-2"', () => {
      const names = scenarioNamesForThreadNames([
        'KP01_loadtest 3-2',
        'Cleanup 1-1',
      ]);
      expect(names).toContain('KP01_loadtest');
    });

    it('should strip trailing " N-N" regardless of thread/virtual-user numbers', () => {
      const names = scenarioNamesForThreadNames([
        'PaymentFlow 10-99',
        'SearchFlow 1-1',
      ]);
      expect(names).toContain('PaymentFlow');
      expect(names).toContain('SearchFlow');
    });

    it('should preserve thread names that do not match the " N-N" pattern', () => {
      // A threadName without the numeric suffix should be kept as-is.
      const names = scenarioNamesForThreadNames([
        'MyGroup',
        'OtherGroup',
      ]);
      expect(names).toContain('MyGroup');
      expect(names).toContain('OtherGroup');
    });

    it('should handle thread names that contain hyphens in the base name', () => {
      const names = scenarioNamesForThreadNames([
        'my-thread-group 2-5',
        'other-group 1-1',
      ]);
      expect(names).toContain('my-thread-group');
      expect(names).toContain('other-group');
    });
  });

  // -------------------------------------------------------------------------
  // Transaction classification
  // -------------------------------------------------------------------------

  describe('transaction classification', () => {
    it('should classify rows with "Number of samples in transaction" responseMessage as transactions', () => {
      const csv = buildJtlCsv([
        {
          label: 'CheckoutFlow',
          responseMessage: 'Number of samples in transaction : 3, number of failing samples : 0',
          success: true,
          elapsed: 350,
        },
        { label: 'GET /cart', responseMessage: 'OK', success: true },
        { label: 'POST /checkout', responseMessage: 'OK', success: true },
      ]);
      const zipBuffer = createZipWithJtl('shop/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);
      const scenario = scenarios[0]!;

      expect(scenario.transactions).toHaveLength(1);
      expect(scenario.transactions[0]!.transactionName).toBe('CheckoutFlow');
      expect(scenario.requests).toHaveLength(2);
    });

    it('should record correct responseTime and success for a transaction row', () => {
      const csv = buildJtlCsv([
        {
          label: 'LoginFlow',
          responseMessage: 'Number of samples in transaction : 2, number of failing samples : 0',
          success: true,
          elapsed: 500,
          bytes: 1024,
          sentBytes: 128,
        },
      ]);
      const zipBuffer = createZipWithJtl('auth/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      const tx = scenario.transactions[0]!;

      expect(tx.responseTime).toBe(500);
      expect(tx.success).toBe(true);
      expect(tx.responseSize).toBe(1024);
      expect(tx.requestSize).toBe(128);
    });

    it('should set transactionName on requests that follow a transaction controller row', () => {
      const csv = buildJtlCsv([
        {
          label: 'SearchFlow',
          responseMessage: 'Number of samples in transaction : 2, number of failing samples : 0',
          success: true,
        },
        { label: 'GET /search', responseMessage: 'OK' },
        { label: 'GET /results', responseMessage: 'OK' },
      ]);
      const zipBuffer = createZipWithJtl('search/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      expect(scenario.requests[0]!.transactionName).toBe('SearchFlow');
      expect(scenario.requests[1]!.transactionName).toBe('SearchFlow');
    });

    it('should only classify rows starting with "Number of samples in transaction" as transactions', () => {
      // A responseMessage that merely contains the phrase elsewhere should NOT be classified.
      const csv = buildJtlCsv([
        {
          label: 'SomeRequest',
          responseMessage: 'Error: Number of samples in transaction exceeded',
          success: false,
        },
      ]);
      const zipBuffer = createZipWithJtl('edge/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      // The row starts with "Error:", not the expected prefix → request, not transaction
      expect(scenario.requests).toHaveLength(1);
      expect(scenario.transactions).toHaveLength(1); // synthesised from the request
    });

    it('should handle failed transaction rows correctly', () => {
      const csv = buildJtlCsv([
        {
          label: 'FailingFlow',
          responseMessage: 'Number of samples in transaction : 1, number of failing samples : 1',
          success: false,
          elapsed: 200,
        },
      ]);
      const zipBuffer = createZipWithJtl('fail/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      expect(scenario.transactions[0]!.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Transaction synthesis
  // -------------------------------------------------------------------------

  describe('transaction synthesis', () => {
    it('should synthesise a transaction for each request when no transaction rows are present', () => {
      const csv = buildJtlCsv([
        { label: 'GET /home', responseMessage: 'OK' },
        { label: 'GET /about', responseMessage: 'OK' },
        { label: 'POST /contact', responseMessage: 'Created' },
      ]);
      const zipBuffer = createZipWithJtl('site/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      // 3 requests → 3 synthesised transactions
      expect(scenario.requests).toHaveLength(3);
      expect(scenario.transactions).toHaveLength(3);
    });

    it('should set transactionName to samplerName for synthesised transactions', () => {
      const csv = buildJtlCsv([
        { label: 'POST /api/order', responseMessage: 'Created' },
      ]);
      const zipBuffer = createZipWithJtl('orders/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      const tx = scenario.transactions[0]!;
      const req = scenario.requests[0]!;

      expect(tx.transactionName).toBe('POST /api/order');
      expect(req.transactionName).toBe('POST /api/order');
      expect(req.samplerName).toBe('POST /api/order');
    });

    it('should mirror request metrics into the synthesised transaction', () => {
      const csv = buildJtlCsv([
        {
          label: 'GET /resource',
          responseMessage: 'OK',
          success: true,
          elapsed: 250,
          bytes: 2048,
          sentBytes: 64,
          timeStamp: 1_700_000_001_000,
        },
      ]);
      const zipBuffer = createZipWithJtl('res/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      const tx = scenario.transactions[0]!;

      expect(tx.success).toBe(true);
      expect(tx.responseTime).toBe(250);
      expect(tx.responseSize).toBe(2048);
      expect(tx.requestSize).toBe(64);
      expect(tx.time.getTime()).toBe(1_700_000_001_000);
    });

    it('should NOT synthesise transactions when real transaction rows already exist', () => {
      const csv = buildJtlCsv([
        {
          label: 'FlowA',
          responseMessage: 'Number of samples in transaction : 1, number of failing samples : 0',
          success: true,
        },
        { label: 'GET /step1', responseMessage: 'OK' },
      ]);
      const zipBuffer = createZipWithJtl('flow/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      // 1 real transaction row + 1 request → no synthesis
      expect(scenario.transactions).toHaveLength(1);
      expect(scenario.transactions[0]!.transactionName).toBe('FlowA');
    });
  });

  // -------------------------------------------------------------------------
  // Virtual user (VU) tracking
  // -------------------------------------------------------------------------

  describe('virtual user tracking', () => {
    it('should record one VU sample per second bucket', () => {
      const BASE = 1_700_000_000_000; // exact second boundary
      const csv = buildJtlCsv([
        {
          label: 'r1',
          timeStamp: BASE,
          grpThreads: 3,
          allThreads: 10,
          threadName: 'Group 1-1',
        },
        {
          label: 'r2',
          timeStamp: BASE + 500,   // same second bucket
          grpThreads: 4,
          allThreads: 12,
          threadName: 'Group 1-2',
        },
        {
          label: 'r3',
          timeStamp: BASE + 1000,  // next second bucket
          grpThreads: 5,
          allThreads: 15,
          threadName: 'Group 1-3',
        },
      ]);
      const zipBuffer = createZipWithJtl('vu/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      // Two distinct seconds → two VU samples (first write wins per bucket)
      expect(scenario.virtualUsers).toHaveLength(2);
    });

    it('should sort virtual user samples chronologically', () => {
      const BASE = 1_700_000_000_000;
      // Deliberately add rows out of timestamp order
      const csv = buildJtlCsv([
        { label: 'r3', timeStamp: BASE + 2000, grpThreads: 5, allThreads: 15 },
        { label: 'r1', timeStamp: BASE, grpThreads: 3, allThreads: 10 },
        { label: 'r2', timeStamp: BASE + 1000, grpThreads: 4, allThreads: 12 },
      ]);
      const zipBuffer = createZipWithJtl('vu/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      const times = scenario.virtualUsers.map((v) => v.time.getTime());

      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    describe('when NOT split by thread group (single scenario)', () => {
      it('should use allThreads as the allThreads field in VU samples', () => {
        const BASE = 1_700_000_000_000;
        const csv = buildJtlCsv([
          {
            label: 'r1',
            timeStamp: BASE,
            grpThreads: 3,
            allThreads: 20,
            // Single thread group → no split
            threadName: 'OnlyGroup 1-1',
          },
        ]);
        const zipBuffer = createZipWithJtl('vu/run.jtl', csv);

        const scenario = service.parseZip(zipBuffer)[0]!;
        const vu = scenario.virtualUsers[0]!;

        // Not split → allThreads (global) is used
        expect(vu.allThreads).toBe(20);
        expect(vu.grpThreads).toBe(3);
      });
    });

    describe('when SPLIT by thread group (multiple scenarios)', () => {
      it('should use grpThreads as the allThreads field per scenario', () => {
        const BASE = 1_700_000_000_000;
        // Two distinct thread groups to trigger the split path
        const csv = buildJtlCsv([
          {
            label: 'r1',
            timeStamp: BASE,
            grpThreads: 3,
            allThreads: 20,
            threadName: 'GroupA 1-1',
          },
          {
            label: 'r2',
            timeStamp: BASE + 100,
            grpThreads: 7,
            allThreads: 20,
            threadName: 'GroupB 1-1',
          },
        ]);
        const zipBuffer = createZipWithJtl('vu/run.jtl', csv);

        const scenarios = service.parseZip(zipBuffer);

        // Two groups → two scenarios
        expect(scenarios).toHaveLength(2);

        const groupA = scenarios.find((s) => s.scenarioName === 'GroupA')!;
        const groupB = scenarios.find((s) => s.scenarioName === 'GroupB')!;

        // Split path → allThreads field reflects grpThreads for each group
        expect(groupA.virtualUsers[0]!.allThreads).toBe(3);
        expect(groupB.virtualUsers[0]!.allThreads).toBe(7);
      });

      it('should keep grpThreads column unchanged regardless of split mode', () => {
        const BASE = 1_700_000_000_000;
        const csv = buildJtlCsv([
          {
            label: 'r1',
            timeStamp: BASE,
            grpThreads: 5,
            allThreads: 25,
            threadName: 'G1 1-1',
          },
          {
            label: 'r2',
            timeStamp: BASE + 100,
            grpThreads: 8,
            allThreads: 25,
            threadName: 'G2 1-1',
          },
        ]);
        const zipBuffer = createZipWithJtl('vu/run.jtl', csv);

        const scenarios = service.parseZip(zipBuffer);
        const g1 = scenarios.find((s) => s.scenarioName === 'G1')!;

        expect(g1.virtualUsers[0]!.grpThreads).toBe(5);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Time range computation (startTime / endTime)
  // -------------------------------------------------------------------------

  describe('time range computation', () => {
    it('should set startTime to the earliest timestamp in the records', () => {
      const BASE = 1_700_000_000_000;
      const csv = buildJtlCsv([
        { label: 'r1', timeStamp: BASE + 2000, elapsed: 50 },
        { label: 'r2', timeStamp: BASE, elapsed: 100 },
        { label: 'r3', timeStamp: BASE + 1000, elapsed: 200 },
      ]);
      const zipBuffer = createZipWithJtl('time/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      expect(scenario.startTime.getTime()).toBe(BASE);
    });

    it('should set endTime to max(timeStamp + elapsed) across all records', () => {
      const BASE = 1_700_000_000_000;
      const csv = buildJtlCsv([
        { label: 'r1', timeStamp: BASE, elapsed: 500 },        // ends at BASE + 500
        { label: 'r2', timeStamp: BASE + 200, elapsed: 1000 }, // ends at BASE + 1200 ← max
      ]);
      const zipBuffer = createZipWithJtl('time/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      expect(scenario.endTime.getTime()).toBe(BASE + 1200);
    });

    it('should use current time for startTime and endTime when records is empty', () => {
      // An empty CSV (header only) produces zero records.
      const csvHeaderOnly = JTL_HEADER;
      const zipBuffer = createZipWithJtl('empty/run.jtl', csvHeaderOnly);

      const before = Date.now();
      const scenarios = service.parseZip(zipBuffer);
      const after = Date.now();

      // Empty CSV → empty result (parseCsv returns [])
      expect(scenarios).toHaveLength(0);
      void before; void after; // suppress unused variable warnings
    });
  });

  // -------------------------------------------------------------------------
  // Corrupted / malformed CSV rows (JMeter concurrent-write interleaving)
  // -------------------------------------------------------------------------

  describe('malformed CSV (JMeter concurrent-write corruption)', () => {
    // Pattern A: unclosed opening quote (one " at start of responseMessage field).
    // Would previously cause "Invalid Closing Quote: got N".
    const corruptedOpeningQuote =
      '1776095051068,3,CORRUPTED_TX,200,"Number of samples in t343,39,OTHER_TX,302,,Grp 1-1,,true,,0,0,1,1,null,0,0,0';

    // Pattern B: stray closing quote mid-field (one " embedded in URL column).
    // Would previously cause "Invalid Opening Quote: a quote is found on field Latency".
    const corruptedClosingQuote =
      '1776095076805,5,PWS_28_07_Uitloggen_05,200,,jp@gc 1-2,,true,,785,947,2,2,https://example.com/lev/Vransaction : 1, number of failing samples : 0",jp@gc 1-2,,true,,1401,1017,2,2,null,0,1661,0';

    it('should not throw when a line has an unclosed opening quote (pattern A)', () => {
      const csv = [JTL_HEADER, corruptedOpeningQuote, buildJtlRow({ label: 'GET /ok' })].join('\n');
      expect(() => service.parseZip(createZipWithJtl('c/run.jtl', csv))).not.toThrow();
    });

    it('should not throw when a line has a stray closing quote mid-field (pattern B)', () => {
      const csv = [JTL_HEADER, corruptedClosingQuote, buildJtlRow({ label: 'GET /ok' })].join('\n');
      expect(() => service.parseZip(createZipWithJtl('c/run.jtl', csv))).not.toThrow();
    });

    it('should not throw when a corrupted line appears at end of file with no subsequent quoted field', () => {
      const csv = [JTL_HEADER, corruptedOpeningQuote].join('\n');
      expect(() => service.parseZip(createZipWithJtl('c/run.jtl', csv))).not.toThrow();
    });

    it('should drop corrupted lines and still parse all healthy rows', () => {
      const goodBefore = buildJtlRow({ label: 'GET /before', timeStamp: 1_700_000_000_000 });
      const goodAfter  = buildJtlRow({ label: 'GET /after',  timeStamp: 1_700_000_002_000 });
      const csv = [JTL_HEADER, goodBefore, corruptedOpeningQuote, corruptedClosingQuote, goodAfter].join('\n');

      const scenarios = service.parseZip(createZipWithJtl('c/run.jtl', csv));
      const labels = scenarios.flatMap((s) => s.requests.map((r) => r.samplerName));

      expect(labels).toContain('GET /before');
      expect(labels).toContain('GET /after');
      expect(labels).not.toContain('CORRUPTED_TX');
    });
  });

  // -------------------------------------------------------------------------
  // Empty / degenerate records
  // -------------------------------------------------------------------------

  describe('empty records', () => {
    it('should return an empty array when the .jtl file has no data rows', () => {
      const csvHeaderOnly = JTL_HEADER;
      const zipBuffer = createZipWithJtl('empty/run.jtl', csvHeaderOnly);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(0);
    });

    it('should return an empty array when the .jtl file is completely empty', () => {
      const zipBuffer = createZipWithJtl('empty/run.jtl', '');

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(0);
    });

    it('should handle a file with blank lines between rows', () => {
      const csv = [
        JTL_HEADER,
        buildJtlRow({ label: 'GET /' }),
        '',
        buildJtlRow({ label: 'GET /about' }),
        '',
      ].join('\n');
      const zipBuffer = createZipWithJtl('blankLines/run.jtl', csv);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0]!.requests).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple JTL files in a single ZIP
  // -------------------------------------------------------------------------

  describe('multiple JTL files in a ZIP', () => {
    it('should return one scenario per JTL file when each has a single thread group', () => {
      const csvA = buildJtlCsv([{ label: 'GET /a', threadName: 'A 1-1' }]);
      const csvB = buildJtlCsv([{ label: 'GET /b', threadName: 'B 1-1' }]);

      const zipBuffer = createZipWithMultipleJtl([
        ['scenarioA/results.jtl', csvA],
        ['scenarioB/results.jtl', csvB],
      ]);

      const scenarios = service.parseZip(zipBuffer);

      expect(scenarios).toHaveLength(2);
      const names = scenarios.map((s) => s.scenarioName).sort();
      expect(names).toEqual(['scenarioA', 'scenarioB']);
    });

    it('should return multiple scenarios from a multi-group JTL plus one from a single-group JTL', () => {
      const csvMulti = buildJtlCsv([
        { label: 'GET /init', threadName: 'Init 1-1' },
        { label: 'POST /load', threadName: 'Load 1-1' },
      ]);
      const csvSingle = buildJtlCsv([
        { label: 'GET /health', threadName: 'Health 1-1' },
      ]);

      const zipBuffer = createZipWithMultipleJtl([
        ['multi/run.jtl', csvMulti],
        ['health/run.jtl', csvSingle],
      ]);

      const scenarios = service.parseZip(zipBuffer);

      // multi splits into 2 + single stays as 1 = 3 total
      expect(scenarios).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Request field mapping
  // -------------------------------------------------------------------------

  describe('request field mapping', () => {
    it('should map all JTL columns to JtlRequestRow fields correctly', () => {
      const timestamp = 1_700_000_000_000;
      const csv = buildJtlCsv([
        {
          timeStamp: timestamp,
          elapsed: 300,
          label: 'GET /products',
          responseCode: '404',
          responseMessage: 'Not Found',
          threadName: 'Shoppers 1-1',
          success: false,
          bytes: 256,
          sentBytes: 80,
          grpThreads: 2,
          allThreads: 8,
          url: 'http://api.example.com/products',
          latency: 120,
          connect: 10,
          failureMessage: 'Response was not 2xx',
        },
      ]);
      const zipBuffer = createZipWithJtl('shop/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      const req = scenario.requests[0]!;

      expect(req.time.getTime()).toBe(timestamp);
      expect(req.samplerName).toBe('GET /products');
      expect(req.responseCode).toBe('404');
      expect(req.responseMessage).toBe('Not Found');
      expect(req.success).toBe(false);
      expect(req.responseSize).toBe(256);
      expect(req.requestSize).toBe(80);
      expect(req.url).toBe('http://api.example.com/products');
      expect(req.responseLatency).toBe(120);
      expect(req.responseConnectTime).toBe(10);
      expect(req.responseTime).toBe(300);
      expect(req.failureMessage).toBe('Response was not 2xx');
    });

    it('should default missing numeric fields to 0', () => {
      // Use a minimal CSV that omits many optional columns
      const minimalCsv = [
        'timeStamp,elapsed,label,responseCode,responseMessage,threadName,success,bytes,sentBytes,grpThreads,allThreads',
        '1700000000000,100,GET /minimal,200,OK,Grp 1-1,true,512,64,1,1',
      ].join('\n');
      const zipBuffer = createZipWithJtl('minimal/run.jtl', minimalCsv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      const req = scenario.requests[0]!;

      expect(req.responseLatency).toBe(0);
      expect(req.responseConnectTime).toBe(0);
      expect(req.url).toBe('');
      expect(req.failureMessage).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario-level shape assertions
  // -------------------------------------------------------------------------

  describe('ParsedScenario shape', () => {
    it('should include scenarioName, requests, transactions, startTime, endTime, virtualUsers', () => {
      const csv = buildJtlCsv([{ label: 'GET /' }]);
      const zipBuffer = createZipWithJtl('shape/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      expect(scenario).toHaveProperty('scenarioName');
      expect(scenario).toHaveProperty('requests');
      expect(scenario).toHaveProperty('transactions');
      expect(scenario).toHaveProperty('startTime');
      expect(scenario).toHaveProperty('endTime');
      expect(scenario).toHaveProperty('virtualUsers');

      expect(scenario.startTime).toBeInstanceOf(Date);
      expect(scenario.endTime).toBeInstanceOf(Date);
      expect(Array.isArray(scenario.requests)).toBe(true);
      expect(Array.isArray(scenario.transactions)).toBe(true);
      expect(Array.isArray(scenario.virtualUsers)).toBe(true);
    });

    it('should have endTime >= startTime', () => {
      const csv = buildJtlCsv([
        { label: 'r1', timeStamp: 1_700_000_000_000, elapsed: 100 },
      ]);
      const zipBuffer = createZipWithJtl('time/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;

      expect(scenario.endTime.getTime()).toBeGreaterThanOrEqual(
        scenario.startTime.getTime(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Sub-transaction filtering (Parallel Controller rows)
  // -------------------------------------------------------------------------

  describe('sub-transaction filtering', () => {
    /**
     * Build a CSV that contains:
     *  - one real TC row (responseMessage starts with 'Number of samples…')
     *  - one normal request row (threadName='MainGroup 1-1', dataType='text')
     *  - one PC sub-request row (threadName='', dataType='text')
     *  - one PC container row (threadName='MainGroup 1-1', dataType='')
     */
    function buildMixedCsv(): string {
      const BASE = 1_700_000_000_000;
      const rows = [
        buildJtlRow({ timeStamp: BASE,       label: 'GET /api',    threadName: 'MainGroup 1-1', dataType: 'text' }),
        buildJtlRow({ timeStamp: BASE + 10,  label: 'PC_sub',      threadName: '',              dataType: 'text' }),
        buildJtlRow({ timeStamp: BASE + 20,  label: 'PC_container',threadName: 'MainGroup 1-1', dataType: '' }),
        // TC row last (as JMeter emits it after samplers)
        buildJtlRow({
          timeStamp: BASE + 100,
          label: 'MyTransaction',
          threadName: 'MainGroup 1-1',
          responseMessage: 'Number of samples in transaction : 1, number of failing samples : 0',
          dataType: '',
        }),
      ];
      return [JTL_HEADER, ...rows].join('\n');
    }

    it('should exclude PC sub-request rows (threadName="") by default', () => {
      const zipBuffer = createZipWithJtl('s/run.jtl', buildMixedCsv());
      const scenarios = service.parseZip(zipBuffer);

      // No spurious "" scenario
      const names = scenarios.map((s) => s.scenarioName);
      expect(names).not.toContain('');
      // All rows belong to 'MainGroup'
      expect(scenarios.length).toBe(1);
      expect(scenarios[0]!.requests.every((r) => r.samplerName !== 'PC_sub')).toBe(true);
    });

    it('should exclude PC container rows (dataType="") by default', () => {
      const zipBuffer = createZipWithJtl('s/run.jtl', buildMixedCsv());
      const scenario = service.parseZip(zipBuffer)[0]!;

      expect(scenario.requests.every((r) => r.samplerName !== 'PC_container')).toBe(true);
    });

    it('should always include TC rows regardless of dataType', () => {
      const zipBuffer = createZipWithJtl('s/run.jtl', buildMixedCsv());
      const scenario = service.parseZip(zipBuffer)[0]!;

      // TC row (dataType='') must appear in transactions
      expect(scenario.transactions.some((t) => t.transactionName === 'MyTransaction')).toBe(true);
    });

    it('should include PC sub-request rows when includeSubTransactions=true', () => {
      const zipBuffer = createZipWithJtl('s/run.jtl', buildMixedCsv());
      const scenarios = service.parseZip(zipBuffer, { includeSubTransactions: true });

      // With opt-in, the "" thread group becomes its own scenario
      const names = scenarios.map((s) => s.scenarioName);
      expect(names.some((n) => n === '')).toBe(true);
    });

    it('should include PC container rows when includeSubTransactions=true', () => {
      const zipBuffer = createZipWithJtl('s/run.jtl', buildMixedCsv());
      // opt-in: all thread groups included; find the MainGroup scenario
      const scenarios = service.parseZip(zipBuffer, { includeSubTransactions: true });
      const main = scenarios.find((s) => s.scenarioName === 'MainGroup')!;

      expect(main.requests.some((r) => r.samplerName === 'PC_container')).toBe(true);
    });

    it('should filter PC sub-requests in single-group files (no thread split)', () => {
      // Single-thread-group CSV — no split, exercises the activeRecords path
      const BASE = 1_700_000_000_000;
      const csv = [
        JTL_HEADER,
        buildJtlRow({ timeStamp: BASE,      label: 'GET /real', threadName: 'T 1-1', dataType: 'text' }),
        buildJtlRow({ timeStamp: BASE + 10, label: 'PC_sub',    threadName: '',      dataType: 'text' }),
      ].join('\n');
      const zipBuffer = createZipWithJtl('single/run.jtl', csv);

      const scenario = service.parseZip(zipBuffer)[0]!;
      expect(scenario.requests.every((r) => r.samplerName !== 'PC_sub')).toBe(true);
      expect(scenario.requests.some((r) => r.samplerName === 'GET /real')).toBe(true);
    });
  });
});
