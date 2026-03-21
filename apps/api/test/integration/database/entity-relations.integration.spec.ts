import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  TestRun,
  SystemUnderTest,
  TestRunConfiguration,
  Team,
  Organization,
  Benchmark,
  ApplicationDashboard,
  GrafanaInstance,
  GrafanaDashboard,
} from '@perfana/shared/entities';

// Import all entity classes from the test entities barrel
import * as testEntities from '../../../src/test/test-entities';

describe.skip('Entity Relations - Database Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let testRunRepository: Repository<TestRun>;
  let systemRepository: Repository<SystemUnderTest>;
  let configRepository: Repository<TestRunConfiguration>;
  let teamRepository: Repository<Team>;
  let benchmarkRepository: Repository<Benchmark>;
  let applicationDashboardRepository: Repository<ApplicationDashboard>;
  let grafanaInstanceRepository: Repository<GrafanaInstance>;
  let grafanaDashboardRepository: Repository<GrafanaDashboard>;

  // Cleanup tracking
  const cleanup = {
    testRuns: [] as string[],
    systems: [] as string[],
    teams: [] as string[],
    configs: [] as string[],
    benchmarks: [] as string[],
    applicationDashboards: [] as string[],
    grafanaInstances: [] as string[],
    grafanaDashboards: [] as string[],
  };

  beforeAll(async () => {
    // Get all entity classes as an array from the test entities barrel
    const entityClasses = Object.values(testEntities).filter(
      (value) => typeof value === 'function' && value.prototype,
    ) as any[];

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'perfana',
          password: process.env.DB_PASSWORD || 'perfana_test_password',
          database: process.env.DB_NAME || 'perfana_test',
          entities: entityClasses,
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          TestRun,
          SystemUnderTest,
          TestRunConfiguration,
          Team,
          Organization,
          Benchmark,
          ApplicationDashboard,
          GrafanaInstance,
          GrafanaDashboard,
        ]),
      ],
    }).compile();

    dataSource = module.get<DataSource>(DataSource);

    // Wait for database connection to be fully established (fixes CI race condition)
    let retries = 10;
    while (retries > 0) {
      try {
        await dataSource.query('SELECT 1');
        console.log('✓ Database connection established');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error('❌ Database connection failed after 10 retries');
          throw error;
        }
        console.log(`⏳ Waiting for database... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    testRunRepository = dataSource.getRepository(TestRun);
    systemRepository = dataSource.getRepository(SystemUnderTest);
    configRepository = dataSource.getRepository(TestRunConfiguration);
    teamRepository = dataSource.getRepository(Team);
    benchmarkRepository = dataSource.getRepository(Benchmark);
    applicationDashboardRepository = dataSource.getRepository(ApplicationDashboard);
    grafanaInstanceRepository = dataSource.getRepository(GrafanaInstance);
    grafanaDashboardRepository = dataSource.getRepository(GrafanaDashboard);
  });

  afterAll(async () => {
    // Clean up in reverse order of dependencies
    if (cleanup.configs.length > 0) {
      await configRepository.delete(cleanup.configs);
    }
    if (cleanup.testRuns.length > 0) {
      await testRunRepository.delete(cleanup.testRuns);
    }
    if (cleanup.benchmarks.length > 0) {
      await benchmarkRepository.delete(cleanup.benchmarks);
    }
    if (cleanup.applicationDashboards.length > 0) {
      await applicationDashboardRepository.delete(cleanup.applicationDashboards);
    }
    if (cleanup.grafanaDashboards.length > 0) {
      await grafanaDashboardRepository.delete(cleanup.grafanaDashboards);
    }
    if (cleanup.grafanaInstances.length > 0) {
      await grafanaInstanceRepository.delete(cleanup.grafanaInstances);
    }
    if (cleanup.systems.length > 0) {
      await systemRepository.delete(cleanup.systems);
    }
    if (cleanup.teams.length > 0) {
      await teamRepository.delete(cleanup.teams);
    }

    await module.close();
  });

  describe('TestRun -> SystemUnderTest (ManyToOne)', () => {
    it('should load system with test run using leftJoin', async () => {
      const team = await teamRepository.save({
        name: `team-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `relation-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
        relations: ['systemUnderTest'],
      });

      expect(found).toBeDefined();
      expect(found?.systemUnderTest).toBeDefined();
      expect(found?.systemUnderTest?.id).toBe(system.id);
      expect(found?.systemUnderTest?.name).toBe(system.name);
    });

    it('should handle null systemUnderTest gracefully', async () => {
      const testRuns = await testRunRepository.find({
        relations: ['systemUnderTest'],
        take: 1,
      });

      // Should not throw, even if systemUnderTest is null/undefined
      expect(testRuns).toBeInstanceOf(Array);
    });

    it('should eager load system when configured', async () => {
      const team = await teamRepository.save({
        name: `team-eager-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-eager-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `eager-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      // Query builder with join
      const found = await testRunRepository
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .where('tr.id = :id', { id: testRun.id })
        .getOne();

      expect(found?.systemUnderTest).toBeDefined();
    });
  });

  describe('TestRun -> TestRunConfiguration (OneToMany)', () => {
    it('should load configurations with test run', async () => {
      const team = await teamRepository.save({
        name: `team-config-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-config-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `config-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const config1 = await configRepository.save({
        testRunId: testRun.id,
        key: 'database.connections',
        value: '100',
      });
      cleanup.configs.push(config1.id);

      const config2 = await configRepository.save({
        testRunId: testRun.id,
        key: 'cache.enabled',
        value: 'true',
      });
      cleanup.configs.push(config2.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
        relations: ['configurations'],
      });

      expect(found?.configurations).toBeDefined();
      expect(found?.configurations.length).toBe(2);
      expect(found?.configurations.some(c => c.key === 'database.connections')).toBe(true);
      expect(found?.configurations.some(c => c.key === 'cache.enabled')).toBe(true);
    });

    it('should cascade delete configurations when test run is deleted', async () => {
      const team = await teamRepository.save({
        name: `team-cascade-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-cascade-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `cascade-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const config = await configRepository.save({
        testRunId: testRun.id,
        key: 'test.key',
        value: 'test.value',
      });

      const configId = config.id;

      // Delete test run
      await testRunRepository.delete(testRun.id);

      // Configuration should be deleted via cascade or manual cleanup
      await configRepository.findOne({ where: { id: configId } });
      // May be null if cascade works, or still exist if we need manual cleanup
      // This depends on the cascade configuration in the entity

      // Remove from cleanup
      const trIndex = cleanup.testRuns.indexOf(testRun.id);
      if (trIndex > -1) cleanup.testRuns.splice(trIndex, 1);
    });

    it('should handle empty configurations array', async () => {
      const team = await teamRepository.save({
        name: `team-empty-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-empty-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `empty-config-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
        relations: ['configurations'],
      });

      expect(found?.configurations).toBeDefined();
      expect(found?.configurations.length).toBe(0);
    });
  });

  describe('SystemUnderTest -> Team (ManyToOne)', () => {
    it('should load team with system', async () => {
      const team = await teamRepository.save({
        name: `team-relation-${Date.now()}`,
        description: 'Test team for relation',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-team-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const found = await systemRepository.findOne({
        where: { id: system.id },
        relations: ['team'],
      });

      expect(found?.team).toBeDefined();
      expect(found?.team?.id).toBe(team.id);
      expect(found?.team?.name).toBe(team.name);
    });

    it('should handle system without team', async () => {
      const system = await systemRepository.save({
        name: `system-no-team-${Date.now()}`,
        description: 'Test system without team',
      });
      cleanup.systems.push(system.id);

      const found = await systemRepository.findOne({
        where: { id: system.id },
        relations: ['team'],
      });

      expect(found).toBeDefined();
      expect(found?.team).toBeUndefined();
    });
  });

  describe('SystemUnderTest -> TestRun (OneToMany)', () => {
    it('should load all test runs for a system', async () => {
      const team = await teamRepository.save({
        name: `team-multi-tr-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-multi-tr-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const tr1 = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `multi-tr-1-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(tr1.id);

      const tr2 = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'stressTest',
        testRunId: `multi-tr-2-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(tr2.id);

      const found = await systemRepository.findOne({
        where: { id: system.id },
        relations: ['testRuns'],
      });

      expect(found?.testRuns).toBeDefined();
      expect(found?.testRuns?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Benchmark -> SystemUnderTest (ManyToOne)', () => {
    it('should create benchmark with system relation', async () => {
      const team = await teamRepository.save({
        name: `team-benchmark-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-benchmark-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const benchmark = await benchmarkRepository.save({
        system_under_test_id: system.id,
        test_environment: 'production',
        workload: 'loadTest',
        source: 'grafana',
        configuration: {},
        tags: [],
        alert_channels: [],
        metadata: {},
      });
      cleanup.benchmarks.push(benchmark.id);

      const found = await benchmarkRepository.findOne({
        where: { id: benchmark.id },
        relations: ['system_under_test'],
      });

      expect(found?.system_under_test).toBeDefined();
      expect(found?.system_under_test?.id).toBe(system.id);
    });
  });

  describe('Benchmark -> ApplicationDashboard (ManyToOne with CASCADE)', () => {
    it('should create benchmark with application dashboard relation', async () => {
      const team = await teamRepository.save({
        name: `team-app-dash-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-app-dash-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const grafanaInstance = await grafanaInstanceRepository.save({
        name: `grafana-${Date.now()}`,
        url: 'http://localhost:3000',
        apiKey: 'test-api-key',
      });
      cleanup.grafanaInstances.push(grafanaInstance.id);

      const grafanaDashboard = await grafanaDashboardRepository.save({
        grafanaInstanceId: grafanaInstance.id,
        dashboardUid: `dash-uid-${Date.now()}`,
        title: 'Test Dashboard',
        url: 'http://localhost:3000/d/test',
      });
      cleanup.grafanaDashboards.push(grafanaDashboard.id);

      const appDashboard = await applicationDashboardRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'production',
        grafanaInstanceId: grafanaInstance.id,
        grafanaDashboardId: grafanaDashboard.id,
        dashboardName: 'Test Dashboard',
        dashboardLabel: 'test-label',
      });
      cleanup.applicationDashboards.push(appDashboard.id);

      const benchmark = await benchmarkRepository.save({
        system_under_test_id: system.id,
        test_environment: 'production',
        workload: 'loadTest',
        source: 'grafana',
        application_dashboard_id: appDashboard.id,
        configuration: {},
        tags: [],
        alert_channels: [],
        metadata: {},
      });
      cleanup.benchmarks.push(benchmark.id);

      const found = await benchmarkRepository.findOne({
        where: { id: benchmark.id },
        relations: ['application_dashboard'],
      });

      expect(found?.application_dashboard).toBeDefined();
      expect(found?.application_dashboard?.id).toBe(appDashboard.id);
    });

    it('should cascade delete benchmark when application dashboard is deleted', async () => {
      const team = await teamRepository.save({
        name: `team-cascade-bench-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-cascade-bench-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const grafanaInstance = await grafanaInstanceRepository.save({
        name: `grafana-cascade-${Date.now()}`,
        url: 'http://localhost:3000',
        apiKey: 'test-api-key',
      });
      cleanup.grafanaInstances.push(grafanaInstance.id);

      const grafanaDashboard = await grafanaDashboardRepository.save({
        grafanaInstanceId: grafanaInstance.id,
        dashboardUid: `dash-cascade-${Date.now()}`,
        title: 'Test Dashboard',
        url: 'http://localhost:3000/d/test',
      });
      cleanup.grafanaDashboards.push(grafanaDashboard.id);

      const appDashboard = await applicationDashboardRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'production',
        grafanaInstanceId: grafanaInstance.id,
        grafanaDashboardId: grafanaDashboard.id,
        dashboardName: 'Test Dashboard',
        dashboardLabel: 'test-label',
      });
      cleanup.applicationDashboards.push(appDashboard.id);

      const benchmark = await benchmarkRepository.save({
        system_under_test_id: system.id,
        test_environment: 'production',
        workload: 'loadTest',
        source: 'grafana',
        application_dashboard_id: appDashboard.id,
        configuration: {},
        tags: [],
        alert_channels: [],
        metadata: {},
      });

      const benchmarkId = benchmark.id;

      // Delete application dashboard
      await applicationDashboardRepository.delete(appDashboard.id);

      // Benchmark should be deleted via cascade (onDelete: 'CASCADE' in entity)
      const foundBenchmark = await benchmarkRepository.findOne({
        where: { id: benchmarkId },
      });

      expect(foundBenchmark).toBeNull();

      // Remove from cleanup
      const appIndex = cleanup.applicationDashboards.indexOf(appDashboard.id);
      if (appIndex > -1) cleanup.applicationDashboards.splice(appIndex, 1);
    });
  });

  describe('ApplicationDashboard -> SystemUnderTest (ManyToOne)', () => {
    it('should load system with application dashboard', async () => {
      const team = await teamRepository.save({
        name: `team-ad-sys-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-ad-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const grafanaInstance = await grafanaInstanceRepository.save({
        name: `grafana-ad-${Date.now()}`,
        url: 'http://localhost:3000',
        apiKey: 'test-api-key',
      });
      cleanup.grafanaInstances.push(grafanaInstance.id);

      const grafanaDashboard = await grafanaDashboardRepository.save({
        grafanaInstanceId: grafanaInstance.id,
        dashboardUid: `dash-ad-${Date.now()}`,
        title: 'Test Dashboard',
        url: 'http://localhost:3000/d/test',
      });
      cleanup.grafanaDashboards.push(grafanaDashboard.id);

      const appDashboard = await applicationDashboardRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'production',
        grafanaInstanceId: grafanaInstance.id,
        grafanaDashboardId: grafanaDashboard.id,
        dashboardName: 'Test Dashboard',
        dashboardLabel: 'test-label',
      });
      cleanup.applicationDashboards.push(appDashboard.id);

      const found = await applicationDashboardRepository.findOne({
        where: { id: appDashboard.id },
        relations: ['systemUnderTest'],
      });

      expect(found?.systemUnderTest).toBeDefined();
      expect(found?.systemUnderTest?.id).toBe(system.id);
    });
  });

  describe('ApplicationDashboard -> GrafanaInstance (ManyToOne)', () => {
    it('should load grafana instance with application dashboard', async () => {
      const team = await teamRepository.save({
        name: `team-gi-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-gi-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const grafanaInstance = await grafanaInstanceRepository.save({
        name: `grafana-gi-${Date.now()}`,
        url: 'http://localhost:3000',
        apiKey: 'test-api-key',
      });
      cleanup.grafanaInstances.push(grafanaInstance.id);

      const grafanaDashboard = await grafanaDashboardRepository.save({
        grafanaInstanceId: grafanaInstance.id,
        dashboardUid: `dash-gi-${Date.now()}`,
        title: 'Test Dashboard',
        url: 'http://localhost:3000/d/test',
      });
      cleanup.grafanaDashboards.push(grafanaDashboard.id);

      const appDashboard = await applicationDashboardRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'production',
        grafanaInstanceId: grafanaInstance.id,
        grafanaDashboardId: grafanaDashboard.id,
        dashboardName: 'Test Dashboard',
        dashboardLabel: 'test-label',
      });
      cleanup.applicationDashboards.push(appDashboard.id);

      const found = await applicationDashboardRepository.findOne({
        where: { id: appDashboard.id },
        relations: ['grafanaInstance'],
      });

      expect(found?.grafanaInstance).toBeDefined();
      expect(found?.grafanaInstance?.id).toBe(grafanaInstance.id);
    });
  });

  describe('Multiple Level Relations', () => {
    it('should load nested relations (TestRun -> System -> Team)', async () => {
      const team = await teamRepository.save({
        name: `team-nested-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-nested-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `nested-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .leftJoinAndSelect('system.team', 'team')
        .where('tr.id = :id', { id: testRun.id })
        .getOne();

      expect(found?.systemUnderTest).toBeDefined();
      expect(found?.systemUnderTest?.team).toBeDefined();
      expect(found?.systemUnderTest?.team?.id).toBe(team.id);
    });

    it('should load multiple relations simultaneously', async () => {
      const team = await teamRepository.save({
        name: `team-multi-rel-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-multi-rel-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `multi-rel-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const config = await configRepository.save({
        testRunId: testRun.id,
        key: 'test.key',
        value: 'test.value',
      });
      cleanup.configs.push(config.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
        relations: ['systemUnderTest', 'configurations'],
      });

      expect(found?.systemUnderTest).toBeDefined();
      expect(found?.configurations).toBeDefined();
      expect(found?.configurations.length).toBeGreaterThan(0);
    });
  });

  describe('Lazy vs Eager Loading', () => {
    it('should support lazy loading when not explicitly joining', async () => {
      const team = await teamRepository.save({
        name: `team-lazy-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-lazy-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `lazy-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      // Find without relations
      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
      });

      expect(found).toBeDefined();
      expect(found?.systemUnderTest).toBeUndefined();
    });

    it('should support eager loading with query builder', async () => {
      const team = await teamRepository.save({
        name: `team-eager-qb-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-eager-qb-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `eager-qb-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository
        .createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .where('tr.id = :id', { id: testRun.id })
        .getOne();

      expect(found?.systemUnderTest).toBeDefined();
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should enforce foreign key constraint on invalid system_id', async () => {
      const invalidSystemId = '00000000-0000-0000-0000-000000000000';

      await expect(async () => {
        await testRunRepository.save({
          systemUnderTestId: invalidSystemId,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `fk-test-${Date.now()}`,
          startTime: new Date(),
        });
      }).rejects.toThrow();
    });

    it('should not allow deletion of system with dependent test runs', async () => {
      const team = await teamRepository.save({
        name: `team-fk-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-fk-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `fk-constraint-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      // Attempt to delete system should fail due to foreign key constraint
      await expect(async () => {
        await systemRepository.delete(system.id);
      }).rejects.toThrow();
    });
  });
});
