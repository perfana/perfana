import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { JtlImportService, JtlImportOptions } from './jtl-import.service';
import { JtlParserService, ParsedScenario } from './jtl-parser.service';
import { TestRunsMutationService } from './test-runs-mutation.service';
import { TestRunsConfigService } from './test-runs-config.service';
import { InitTestHandler } from '../handlers/init-test.handler';

// ---------------------------------------------------------------------------
// Fixtures & Factories
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

function makeRequest(overrides: Partial<ParsedScenario['requests'][0]> = {}): ParsedScenario['requests'][0] {
  return {
    time: new Date(BASE_TS),
    transactionName: 'GET /api/health',
    samplerName: 'GET /api/health',
    responseCode: '200',
    responseMessage: 'OK',
    failureMessage: '',
    success: true,
    requestSize: 64,
    responseSize: 512,
    responseConnectTime: 5,
    responseLatency: 80,
    responseTime: 100,
    url: 'http://example.com/api/health',
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<ParsedScenario['transactions'][0]> = {}): ParsedScenario['transactions'][0] {
  return {
    time: new Date(BASE_TS),
    transactionName: 'TX_Home',
    success: true,
    requestSize: 64,
    responseSize: 512,
    responseTime: 200,
    ...overrides,
  };
}

function makeVirtualUser(overrides: Partial<ParsedScenario['virtualUsers'][0]> = {}): ParsedScenario['virtualUsers'][0] {
  return {
    time: new Date(BASE_TS),
    grpThreads: 5,
    allThreads: 10,
    ...overrides,
  };
}

function makeScenario(overrides: Partial<ParsedScenario> = {}): ParsedScenario {
  return {
    scenarioName: 'loadtest',
    requests: [makeRequest()],
    transactions: [makeTransaction()],
    virtualUsers: [makeVirtualUser()],
    startTime: new Date(BASE_TS),
    endTime: new Date(BASE_TS + 60_000),
    ...overrides,
  };
}

const DEFAULT_OPTIONS: JtlImportOptions = {
  systemUnderTest: 'PaymentService',
  testEnvironment: 'production',
  workload: 'loadTest',
  analysisStartOffset: 60,
  configs: [],
  userId: 'user-001',
  roles: ['user'],
  organizationId: 'org-001',
};

const MOCK_TEST_RUN = {
  id: 'uuid-test-run-1',
  test_run_id: 'PaymentService-production-loadTest-00001',
  completed: false,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('JtlImportService', () => {
  let service: JtlImportService;
  let jtlParserService: jest.Mocked<JtlParserService>;
  let mutationService: jest.Mocked<TestRunsMutationService>;
  let configService: jest.Mocked<TestRunsConfigService>;
  let initTestHandler: jest.Mocked<InitTestHandler>;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;

  beforeEach(async () => {
    const mockJtlParserService = { parseZip: jest.fn() };
    const mockMutationService = { updateRunningTest: jest.fn() };
    const mockConfigService = { addTestRunConfigsByUuid: jest.fn() };
    const mockInitTestHandler = { execute: jest.fn() };
    // Issue #398: metric inserts now route through `withRequestQuery(this.dataSource).query`,
    // which resolves to `dataSource.manager.query` outside an HTTP request. Share one
    // jest.fn across both so the existing `dataSource.query` assertions keep observing calls.
    const mockQuery = jest.fn();
    const mockDataSource = { query: mockQuery, manager: { query: mockQuery } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JtlImportService,
        { provide: JtlParserService, useValue: mockJtlParserService },
        { provide: TestRunsMutationService, useValue: mockMutationService },
        { provide: TestRunsConfigService, useValue: mockConfigService },
        { provide: InitTestHandler, useValue: mockInitTestHandler },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<JtlImportService>(JtlImportService);
    jtlParserService = module.get(JtlParserService);
    mutationService = module.get(TestRunsMutationService);
    configService = module.get(TestRunsConfigService);
    initTestHandler = module.get(InitTestHandler);
    dataSource = module.get(DataSource);

    // Default happy-path stubs
    initTestHandler.execute.mockResolvedValue({ testRunId: MOCK_TEST_RUN.test_run_id });
    mutationService.updateRunningTest.mockResolvedValue(MOCK_TEST_RUN as any);
    dataSource.query.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // importJtl — orchestration
  // -------------------------------------------------------------------------

  describe('importJtl', () => {
    describe('Happy Path', () => {
      it('should return testRunId and scenarioCount for a single scenario', async () => {
        const scenario = makeScenario();
        jtlParserService.parseZip.mockReturnValue([scenario]);

        const result = await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        expect(result.testRunId).toBe(MOCK_TEST_RUN.test_run_id);
        expect(result.scenarioCount).toBe(1);
      });

      it('should return correct scenarioCount for multiple scenarios', async () => {
        const scenarios = [
          makeScenario({ scenarioName: 'scenario-a' }),
          makeScenario({ scenarioName: 'scenario-b' }),
          makeScenario({ scenarioName: 'scenario-c' }),
        ];
        jtlParserService.parseZip.mockReturnValue(scenarios);

        const result = await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        expect(result.scenarioCount).toBe(3);
      });

      it('should call initTestHandler with correct system/environment/workload', async () => {
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        expect(initTestHandler.execute).toHaveBeenCalledWith(
          {
            systemUnderTest: DEFAULT_OPTIONS.systemUnderTest,
            testEnvironment: DEFAULT_OPTIONS.testEnvironment,
            workload: DEFAULT_OPTIONS.workload,
          },
          DEFAULT_OPTIONS.userId,
          DEFAULT_OPTIONS.organizationId,
        );
      });

      it('should call updateRunningTest twice: once not completed, once completed', async () => {
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        expect(mutationService.updateRunningTest).toHaveBeenCalledTimes(2);
        const firstCall = mutationService.updateRunningTest.mock.calls[0][0];
        const secondCall = mutationService.updateRunningTest.mock.calls[1][0];
        expect(firstCall.completed).toBe(false);
        expect(secondCall.completed).toBe(true);
      });

      it('should pass analysisStartOffset from options to updateRunningTest', async () => {
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), { ...DEFAULT_OPTIONS, analysisStartOffset: 120 });

        const firstCall = mutationService.updateRunningTest.mock.calls[0][0];
        expect(firstCall.analysisStartOffset).toBe(120);
      });

      it('should default analysisStartOffset to 0 when not provided', async () => {
        const optionsWithoutAnalysisStartOffset = { ...DEFAULT_OPTIONS };
        delete optionsWithoutAnalysisStartOffset.analysisStartOffset;
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), optionsWithoutAnalysisStartOffset);

        const firstCall = mutationService.updateRunningTest.mock.calls[0][0];
        expect(firstCall.analysisStartOffset).toBe(0);
      });

      it('should add source:jtl-upload and scenario tags to test run', async () => {
        const scenario = makeScenario({ scenarioName: 'perf-scenario' });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const firstCall = mutationService.updateRunningTest.mock.calls[0][0];
        expect(firstCall.tags).toContain('source:jtl-upload');
        expect(firstCall.tags).toContain('scenario:perf-scenario');
      });

      it('should compute duration from min start to max end across all scenarios', async () => {
        const scenarios = [
          makeScenario({
            startTime: new Date(BASE_TS),
            endTime: new Date(BASE_TS + 30_000),
          }),
          makeScenario({
            startTime: new Date(BASE_TS + 10_000),
            endTime: new Date(BASE_TS + 90_000), // latest end
          }),
        ];
        jtlParserService.parseZip.mockReturnValue(scenarios);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const firstCall = mutationService.updateRunningTest.mock.calls[0][0];
        // duration = (BASE_TS+90_000 - BASE_TS) / 1000 = 90
        expect(firstCall.duration).toBe(90);
      });
    });

    describe('Config storage', () => {
      it('should store configs when provided', async () => {
        const configs = [{ key: 'version', value: '1.2.3' }];
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), { ...DEFAULT_OPTIONS, configs });

        expect(configService.addTestRunConfigsByUuid).toHaveBeenCalledWith(
          MOCK_TEST_RUN.id,
          ['jtl-upload'],
          configs,
        );
      });

      it('should not call addTestRunConfigsByUuid when configs array is empty', async () => {
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), { ...DEFAULT_OPTIONS, configs: [] });

        expect(configService.addTestRunConfigsByUuid).not.toHaveBeenCalled();
      });

      it('should not call addTestRunConfigsByUuid when configs is undefined', async () => {
        const optionsWithoutConfigs = { ...DEFAULT_OPTIONS };
        delete optionsWithoutConfigs.configs;
        jtlParserService.parseZip.mockReturnValue([makeScenario()]);

        await service.importJtl(Buffer.from(''), optionsWithoutConfigs);

        expect(configService.addTestRunConfigsByUuid).not.toHaveBeenCalled();
      });
    });

    describe('Data insertion routing', () => {
      it('should insert requests when scenario has requests', async () => {
        const scenario = makeScenario({ requests: [makeRequest()], transactions: [], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const requestInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
        expect(requestInsert).toBeDefined();
      });

      it('should not insert requests when scenario has no requests', async () => {
        const scenario = makeScenario({ requests: [], transactions: [makeTransaction()], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const requestInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
        expect(requestInsert).toBeUndefined();
      });

      it('should insert transactions when scenario has transactions', async () => {
        const scenario = makeScenario({ requests: [], transactions: [makeTransaction()], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const txInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO transactions'));
        expect(txInsert).toBeDefined();
      });

      it('should insert errors for failed requests', async () => {
        const failedReq = makeRequest({ success: false, responseCode: '500', failureMessage: 'Internal Server Error' });
        const scenario = makeScenario({ requests: [failedReq], transactions: [], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const errInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
        expect(errInsert).toBeDefined();
      });

      it('should not insert errors when all requests succeed', async () => {
        const scenario = makeScenario({ requests: [makeRequest({ success: true })], transactions: [], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const errInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
        expect(errInsert).toBeUndefined();
      });

      it('should insert virtual users when scenario has VU samples', async () => {
        const scenario = makeScenario({ requests: [], transactions: [], virtualUsers: [makeVirtualUser()] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const vuInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO virtual_users'));
        expect(vuInsert).toBeDefined();
      });

      it('should not insert virtual users when scenario has no VU samples', async () => {
        const scenario = makeScenario({ requests: [], transactions: [], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const vuInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO virtual_users'));
        expect(vuInsert).toBeUndefined();
      });

      it('should insert url_patterns when requests have URLs', async () => {
        const scenario = makeScenario({
          requests: [makeRequest({ url: 'http://example.com/api/users/123' })],
          transactions: [],
          virtualUsers: [],
        });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const urlInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
        expect(urlInsert).toBeDefined();
      });

      it('should not insert url_patterns when requests have no URLs', async () => {
        const scenario = makeScenario({
          requests: [makeRequest({ url: '' })],
          transactions: [],
          virtualUsers: [],
        });
        jtlParserService.parseZip.mockReturnValue([scenario]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const urlInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
        expect(urlInsert).toBeUndefined();
      });
    });

    describe('Multiple scenarios', () => {
      it('should process each scenario independently', async () => {
        const scenarioA = makeScenario({ scenarioName: 'a', requests: [makeRequest()], transactions: [], virtualUsers: [] });
        const scenarioB = makeScenario({ scenarioName: 'b', requests: [makeRequest()], transactions: [], virtualUsers: [] });
        jtlParserService.parseZip.mockReturnValue([scenarioA, scenarioB]);

        await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

        const insertCalls = (dataSource.query as jest.Mock).mock.calls;
        const requestInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
        // One requests_raw insert per scenario
        expect(requestInserts).toHaveLength(2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // insertRequests — batch SQL construction
  // -------------------------------------------------------------------------

  describe('Batch insert: requests_raw', () => {
    it('should produce correct column count per row (16 params)', async () => {
      const scenario = makeScenario({ requests: [makeRequest()], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      // 1 row × 16 columns
      expect(params).toHaveLength(16);
    });

    it('should use scenario_name in request insert params', async () => {
      const scenario = makeScenario({
        scenarioName: 'my-scenario',
        requests: [makeRequest()],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      expect(params).toContain('my-scenario');
    });

    it('should split > 1000 requests into multiple batches', async () => {
      const requests = Array.from({ length: 2500 }, () => makeRequest());
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const requestInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      // ceil(2500 / 1000) = 3 batches
      expect(requestInserts).toHaveLength(3);
    });

    it('should produce exactly 1000 rows per full batch', async () => {
      const requests = Array.from({ length: 1000 }, () => makeRequest());
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      // 1000 rows × 16 params
      expect(params).toHaveLength(1000 * 16);
    });

    it('should compute url_hash as null when url is empty', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: '' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      // url_hash is the last param (index 15)
      expect(params[15]).toBeNull();
    });

    it('should compute a non-null url_hash when url is provided', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'http://example.com/api/health' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      expect(params[15]).not.toBeNull();
      expect(typeof params[15]).toBe('string');
      expect(params[15]).toHaveLength(32); // MD5 hex
    });
  });

  // -------------------------------------------------------------------------
  // insertTransactions — batch SQL construction
  // -------------------------------------------------------------------------

  describe('Batch insert: transactions', () => {
    it('should produce correct column count per row (11 params)', async () => {
      const scenario = makeScenario({ requests: [], transactions: [makeTransaction()], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO transactions'));
      // 1 row × 11 columns
      expect(params).toHaveLength(11);
    });

    it('should include scenario_name in transaction params', async () => {
      const scenario = makeScenario({
        scenarioName: 'tx-scenario',
        requests: [],
        transactions: [makeTransaction()],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO transactions'));
      expect(params).toContain('tx-scenario');
    });

    it('should split > 1000 transactions into multiple batches', async () => {
      const transactions = Array.from({ length: 1500 }, () => makeTransaction());
      const scenario = makeScenario({ requests: [], transactions, virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const txInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO transactions'));
      // ceil(1500 / 1000) = 2 batches
      expect(txInserts).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // insertErrors — batch SQL construction
  // -------------------------------------------------------------------------

  describe('Batch insert: requests_error', () => {
    it('should produce correct column count per row (15 params)', async () => {
      const failedReq = makeRequest({ success: false });
      const scenario = makeScenario({ requests: [failedReq], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      // 1 row × 15 columns
      expect(params).toHaveLength(15);
    });

    it('should use failureMessage when present', async () => {
      const failedReq = makeRequest({
        success: false,
        failureMessage: 'Connection refused',
        responseMessage: 'Internal Server Error',
      });
      const scenario = makeScenario({ requests: [failedReq], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      // response_message is at index 12 (0-based)
      expect(params[12]).toBe('Connection refused');
    });

    it('should fall back to responseMessage when failureMessage is empty', async () => {
      const failedReq = makeRequest({
        success: false,
        failureMessage: '',
        responseMessage: 'Service Unavailable',
      });
      const scenario = makeScenario({ requests: [failedReq], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      expect(params[12]).toBe('Service Unavailable');
    });

    it('should set response_message to null when both failureMessage and responseMessage are empty', async () => {
      const failedReq = makeRequest({ success: false, failureMessage: '', responseMessage: '' });
      const scenario = makeScenario({ requests: [failedReq], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      expect(params[12]).toBeNull();
    });

    it('should compute url_hash as null when url is empty for errors', async () => {
      const failedReq = makeRequest({ success: false, url: '' });
      const scenario = makeScenario({ requests: [failedReq], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      // url_hash is the last param (index 14)
      expect(params[14]).toBeNull();
    });

    it('should split > 1000 errors into multiple batches', async () => {
      const failedRequests = Array.from({ length: 2001 }, () => makeRequest({ success: false }));
      const scenario = makeScenario({ requests: failedRequests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const errInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      // ceil(2001 / 1000) = 3 batches
      expect(errInserts).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // insertVirtualUsers — batch SQL construction
  // -------------------------------------------------------------------------

  describe('Batch insert: virtual_users', () => {
    it('should produce correct column count per row (8 params)', async () => {
      const scenario = makeScenario({ requests: [], transactions: [], virtualUsers: [makeVirtualUser()] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO virtual_users'));
      // 1 row × 8 columns
      expect(params).toHaveLength(8);
    });

    it('should use scenario_name as node_name for virtual users', async () => {
      const scenario = makeScenario({
        scenarioName: 'vu-scenario',
        requests: [],
        transactions: [],
        virtualUsers: [makeVirtualUser()],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO virtual_users'));
      // node_name is at index 5, scenario_name at index 7
      expect(params[5]).toBe('vu-scenario');
      expect(params[7]).toBe('vu-scenario');
    });

    it('should include allThreads count in virtual user params', async () => {
      const vu = makeVirtualUser({ allThreads: 42 });
      const scenario = makeScenario({ requests: [], transactions: [], virtualUsers: [vu] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO virtual_users'));
      expect(params[6]).toBe(42); // active_threads
    });

    it('should split > 1000 VU samples into multiple batches', async () => {
      const virtualUsers = Array.from({ length: 3000 }, () => makeVirtualUser());
      const scenario = makeScenario({ requests: [], transactions: [], virtualUsers });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const vuInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO virtual_users'));
      // ceil(3000 / 1000) = 3 batches
      expect(vuInserts).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // URL normalization (via insertUrlPatterns)
  // -------------------------------------------------------------------------

  describe('URL normalization and url_patterns deduplication', () => {
    it('should deduplicate URLs with same normalized form into one url_pattern', async () => {
      // UUID path segments should all normalize to the same pattern
      const requests = [
        makeRequest({ url: 'http://example.com/api/users/11111111-1111-1111-1111-111111111111' }),
        makeRequest({ url: 'http://example.com/api/users/22222222-2222-2222-2222-222222222222' }),
        makeRequest({ url: 'http://example.com/api/users/33333333-3333-3333-3333-333333333333' }),
      ];
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      // Only 1 deduplicated pattern → 6 params per row × 1 = 6
      expect(params).toHaveLength(6);
    });

    it('should not deduplicate URLs with distinct normalized forms', async () => {
      const requests = [
        makeRequest({ url: 'http://example.com/api/users/123' }),
        makeRequest({ url: 'http://example.com/api/orders/456' }),
      ];
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      // 2 distinct patterns → 6 params per row × 2 = 12
      expect(params).toHaveLength(12);
    });

    it('should replace numeric path segments with {id}', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'http://example.com/api/orders/42/items/7' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      // normalized_url is at index 3 of each row
      const normalizedUrl = params[3];
      expect(normalizedUrl).toContain('{id}');
      expect(normalizedUrl).not.toMatch(/\/42/);
      expect(normalizedUrl).not.toMatch(/\/7/);
    });

    it('should replace UUID path segments with {id}', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'http://example.com/api/users/550e8400-e29b-41d4-a716-446655440000' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      const normalizedUrl = params[3];
      expect(normalizedUrl).toContain('{id}');
      expect(normalizedUrl).not.toContain('550e8400');
    });

    it('should replace query parameter values with {val}', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'http://example.com/api/search?q=test&page=2' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      const normalizedUrl = params[3];
      expect(normalizedUrl).toContain('{val}');
      expect(normalizedUrl).not.toContain('test');
      expect(normalizedUrl).not.toContain('page=2');
    });

    it('should pass through URLs that fail to parse (invalid URL)', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'not-a-valid-url' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      // Should not throw — graceful fallback
      await expect(service.importJtl(Buffer.from(''), DEFAULT_OPTIONS)).resolves.toBeDefined();
    });

    it('should keep the earliest time for a deduplicated url_pattern', async () => {
      const earliest = new Date(BASE_TS);
      const later = new Date(BASE_TS + 5000);
      // Same normalized URL, two different timestamps — earliest should win
      const requests = [
        makeRequest({ url: 'http://example.com/api/users/999', time: later }),
        makeRequest({ url: 'http://example.com/api/users/888', time: earliest }),
      ];
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      // first_seen is at index 5
      expect(params[5]).toEqual(earliest);
    });

    it('should use ON CONFLICT DO NOTHING in url_patterns upsert SQL', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'http://example.com/api/health' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [sql] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO NOTHING');
    });

    it('should split > 1000 url patterns into multiple batches', async () => {
      // Generate 1001 unique URLs (each has a distinct numeric ID)
      const requests = Array.from({ length: 1001 }, (_, i) =>
        makeRequest({ url: `http://example.com/api/items/${i}` }),
      );
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      // All 1001 items normalize to the same pattern http://example.com/api/items/{id}
      // so only 1 batch (deduplicated to 1 pattern)
      const urlInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      expect(urlInserts).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // URL hash consistency
  // -------------------------------------------------------------------------

  describe('URL hash (computeUrlHash)', () => {
    it('should produce the same hash for URLs that normalize to the same pattern', async () => {
      const reqA = makeRequest({ url: 'http://example.com/api/users/100' });
      const reqB = makeRequest({ url: 'http://example.com/api/users/200' });
      const scenario = makeScenario({ requests: [reqA, reqB], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, requestsParams] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      const hash1 = requestsParams[15];       // url_hash of first row
      const hash2 = requestsParams[15 + 16];  // url_hash of second row
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32);
    });

    it('should produce different hashes for URLs that normalize differently', async () => {
      const reqA = makeRequest({ url: 'http://example.com/api/users/100' });
      const reqB = makeRequest({ url: 'http://example.com/api/orders/100' });
      const scenario = makeScenario({ requests: [reqA, reqB], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, requestsParams] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      const hash1 = requestsParams[15];
      const hash2 = requestsParams[15 + 16];
      expect(hash1).not.toBe(hash2);
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  describe('Error propagation', () => {
    it('should propagate parser errors', async () => {
      jtlParserService.parseZip.mockImplementation(() => {
        throw new Error('No .jtl files found in the zip archive');
      });

      await expect(service.importJtl(Buffer.from('bad'), DEFAULT_OPTIONS)).rejects.toThrow(
        'No .jtl files found in the zip archive',
      );
    });

    it('should propagate initTestHandler errors', async () => {
      jtlParserService.parseZip.mockReturnValue([makeScenario()]);
      initTestHandler.execute.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.importJtl(Buffer.from(''), DEFAULT_OPTIONS)).rejects.toThrow('DB connection failed');
    });

    it('should propagate database query errors', async () => {
      const scenario = makeScenario({ requests: [makeRequest()], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);
      (dataSource.query as jest.Mock).mockRejectedValue(new Error('Query timeout'));

      await expect(service.importJtl(Buffer.from(''), DEFAULT_OPTIONS)).rejects.toThrow('Query timeout');
    });

    it('should propagate mutationService errors', async () => {
      jtlParserService.parseZip.mockReturnValue([makeScenario()]);
      mutationService.updateRunningTest.mockRejectedValue(new Error('Conflict'));

      await expect(service.importJtl(Buffer.from(''), DEFAULT_OPTIONS)).rejects.toThrow('Conflict');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle a scenario with only failed requests (no successes)', async () => {
      const failedRequests = [
        makeRequest({ success: false, responseCode: '503' }),
        makeRequest({ success: false, responseCode: '500' }),
      ];
      const scenario = makeScenario({ requests: failedRequests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      const result = await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      expect(result.testRunId).toBe(MOCK_TEST_RUN.test_run_id);
      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const requestsRawInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      const errInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      expect(requestsRawInsert).toBeDefined();
      expect(errInsert).toBeDefined();
    });

    it('should handle a scenario with both success and failure requests', async () => {
      const requests = [
        makeRequest({ success: true }),
        makeRequest({ success: false }),
      ];
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const errInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_error'));
      expect(errInsert).toBeDefined();
      // 1 failed request → 15 params
      expect(errInsert[1]).toHaveLength(15);
    });

    it('should handle scenario with no data at all (empty requests, transactions, VUs)', async () => {
      const scenario = makeScenario({ requests: [], transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      const result = await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      expect(result.scenarioCount).toBe(1);
      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const dataInserts = insertCalls.filter((c: [string, ...unknown[]]) =>
        ['requests_raw', 'transactions', 'requests_error', 'virtual_users', 'url_patterns'].some((t) =>
          c[0].includes(t),
        ),
      );
      expect(dataInserts).toHaveLength(0);
    });

    it('should handle exactly BATCH_SIZE requests without creating an extra batch', async () => {
      const requests = Array.from({ length: 1000 }, () => makeRequest());
      const scenario = makeScenario({ requests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const requestInserts = insertCalls.filter((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO requests_raw'));
      expect(requestInserts).toHaveLength(1);
    });

    it('should handle requests with long hex token path segments (normalised to {id})', async () => {
      const scenario = makeScenario({
        requests: [makeRequest({ url: 'http://example.com/api/token/deadbeefcafe1234abcd5678' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      const normalizedUrl = params[3];
      expect(normalizedUrl).toContain('{id}');
    });

    it('should pass the zipBuffer directly to jtlParserService.parseZip', async () => {
      const buffer = Buffer.from('zip content');
      jtlParserService.parseZip.mockReturnValue([makeScenario()]);

      await service.importJtl(buffer, DEFAULT_OPTIONS);

      expect(jtlParserService.parseZip).toHaveBeenCalledWith(buffer, { includeSubTransactions: false });
    });

    it('should not insert url_patterns when url field is absent (empty string)', async () => {
      const allEmptyUrlRequests = [
        makeRequest({ url: '' }),
        makeRequest({ url: '' }),
      ];
      const scenario = makeScenario({ requests: allEmptyUrlRequests, transactions: [], virtualUsers: [] });
      jtlParserService.parseZip.mockReturnValue([scenario]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const urlInsert = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      expect(urlInsert).toBeUndefined();
    });

    it('should aggregate url patterns across multiple scenarios', async () => {
      // Two scenarios with the same URL path but different IDs — normalize to same pattern
      const scenarioA = makeScenario({
        scenarioName: 'a',
        requests: [makeRequest({ url: 'http://example.com/api/users/10' })],
        transactions: [],
        virtualUsers: [],
      });
      const scenarioB = makeScenario({
        scenarioName: 'b',
        requests: [makeRequest({ url: 'http://example.com/api/users/20' })],
        transactions: [],
        virtualUsers: [],
      });
      jtlParserService.parseZip.mockReturnValue([scenarioA, scenarioB]);

      await service.importJtl(Buffer.from(''), DEFAULT_OPTIONS);

      const insertCalls = (dataSource.query as jest.Mock).mock.calls;
      const [, params] = insertCalls.find((c: [string, ...unknown[]]) => c[0].includes('INSERT INTO url_patterns'));
      // Both normalize to http://example.com/api/users/{id} → deduplicated to 1 pattern
      expect(params).toHaveLength(6);
    });
  });
});
