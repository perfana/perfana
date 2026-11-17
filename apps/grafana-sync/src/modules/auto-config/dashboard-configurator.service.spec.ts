/**
 * DashboardConfiguratorService — the Step 3b gate: a template whose own system/environment
 * variable queries do not know this run's value is skipped before any dashboard is built.
 */

jest.mock('@perfana/shared/entities', () => ({
  TestRun: class TestRun {},
  Profile: class Profile {},
  ProfileGrafanaDashboard: class ProfileGrafanaDashboard {},
  ProfileBenchmark: class ProfileBenchmark {},
  Benchmark: class Benchmark {},
  GrafanaDashboard: class GrafanaDashboard {},
  GrafanaInstance: class GrafanaInstance {},
  ProxyServer: class ProxyServer {},
  ApplicationDashboard: class ApplicationDashboard {},
  SystemUnderTest: class SystemUnderTest {},
}));
// Replaced by a useValue provider below anyway; mocking the module keeps its audit/TypeORM
// import chain (which needs entity classes the mock above does not carry) out of the test.
jest.mock('./services/dashboard-processor.service', () => ({
  DashboardProcessorService: class DashboardProcessorService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DashboardConfiguratorService } from './dashboard-configurator.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { VariableDiscoveryService } from './variable-discovery.service';
import { DashboardProcessorService } from './services/dashboard-processor.service';

describe('DashboardConfiguratorService — seeded-value gate (Step 3b)', () => {
  let service: DashboardConfiguratorService;
  let finder: { findGrafanaDashboardOrNull: jest.Mock; findGrafanaConfiguration: jest.Mock };
  let discovery: {
    getApplicationDashboardVariables: jest.Mock;
    findSeededValuesMissingFromDatasource: jest.Mock;
  };
  let processor: { processSingleVariableSet: jest.Mock };
  let warnSpy: jest.SpyInstance;

  const testRun = { testRunId: 'run-1', organizationId: 'org-1' } as any;
  const autoConfig = {
    dashboardUid: 'tpl-uid',
    dashboardName: 'Tpl',
    grafanaLabel: 'g',
    setHardcodedValueForVariables: [],
  } as any;
  const template = { name: 'Tpl', tags: ['perfana-template'], grafanaJson: { dashboard: {} } };
  const instance = { label: 'g' };
  const vars = [
    { name: 'system_under_test', values: ['shop'] },
    { name: 'test_environment', values: ['acc'] },
  ];

  beforeEach(async () => {
    finder = {
      findGrafanaDashboardOrNull: jest.fn().mockResolvedValue(template),
      findGrafanaConfiguration: jest.fn().mockResolvedValue(instance),
    };
    discovery = {
      getApplicationDashboardVariables: jest.fn().mockResolvedValue(vars),
      findSeededValuesMissingFromDatasource: jest.fn(),
    };
    processor = { processSingleVariableSet: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardConfiguratorService,
        { provide: DashboardFinderService, useValue: finder },
        { provide: VariableDiscoveryService, useValue: discovery },
        { provide: DashboardProcessorService, useValue: processor },
      ],
    }).compile();

    service = module.get(DashboardConfiguratorService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // Value: protects=a template whose datasource lacks the run's SUT/env is never built into an app dashboard; fails_when=the early return is removed or the length check inverted; why_new=configurator had no spec; seam=none; no_claim=what findSeededValuesMissingFromDatasource decides
  it('skips the template and processes nothing when a seeded value is missing', async () => {
    discovery.findSeededValuesMissingFromDatasource.mockResolvedValue([
      'system_under_test',
      'test_environment',
    ]);

    await service.processAutoConfigDashboard(testRun, autoConfig, []);

    expect(discovery.findSeededValuesMissingFromDatasource).toHaveBeenCalledWith(
      template,
      instance,
      vars,
    );
    expect(processor.processSingleVariableSet).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipping template tpl-uid for test run run-1: .*system_under_test \/ test_environment/,
      ),
    );
  });

  // Value: protects=the normal auto-config path still builds dashboards once the gate passes; fails_when=the gate returns unconditionally, or for an empty list; why_new=configurator had no spec; seam=none; no_claim=variable-set splitting details
  it('still processes the template when nothing is missing', async () => {
    discovery.findSeededValuesMissingFromDatasource.mockResolvedValue([]);

    await service.processAutoConfigDashboard(testRun, autoConfig, ['tv']);

    expect(processor.processSingleVariableSet).toHaveBeenCalledTimes(1);
    expect(processor.processSingleVariableSet).toHaveBeenCalledWith(
      testRun,
      autoConfig,
      vars,
      ['tv'],
      instance,
      template,
    );
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Skipping template'));
  });
});
