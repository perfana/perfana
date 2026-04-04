import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ScalingSession } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { ResourceNotFoundException } from '../../common/exceptions/business.exception';
import { CreateScalingSessionDto } from './dto/create-scaling-session.dto';
import { UpdateScalingSessionDto } from './dto/update-scaling-session.dto';

@Injectable()
export class ScalingSessionsService {
  private readonly logger = new Logger(ScalingSessionsService.name);

  constructor(
    @InjectRepository(ScalingSession)
    private readonly repo: Repository<ScalingSession>,
    private readonly dataSource: DataSource,
    private readonly authzService: AuthorizationService,
  ) {}

  async create(dto: CreateScalingSessionDto, userId: string, organizationId: string): Promise<ScalingSession> {
    const session = this.repo.create({
      name: dto.name,
      description: dto.description,
      system_under_test_id: dto.systemUnderTestId,
      test_environment: dto.testEnvironment,
      workload: dto.workload,
      baseline_test_run_id: dto.baselineTestRunId,
      target_load: dto.targetLoad,
      linked_benchmark_ids: dto.linkedBenchmarkIds || [],
      status: 'active',
      organization_id: organizationId,
      created_by: userId,
      updated_by: userId,
    });

    const saved = await this.repo.save(session);

    // Auto-set ADAPT mode to SCALING for this workload
    await this.setWorkloadAdaptMode(dto.systemUnderTestId, dto.testEnvironment, dto.workload, dto.baselineTestRunId);

    this.logger.log(`Created scaling session ${saved.id}: ${saved.name}`);
    return saved;
  }

  /**
   * Set the workload-level ADAPT mode to SCALING so future test runs auto-use scaling comparison.
   * Updates the workload config JSONB on system_under_test_workloads (same path as PUT /test-runs/workload-adapt-settings).
   */
  private async setWorkloadAdaptMode(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    baselineTestRunId?: string,
  ): Promise<void> {
    try {
      const configUpdate: Record<string, unknown> = { adaptMode: 'SCALING' };
      if (baselineTestRunId) configUpdate.baselineTestRunId = baselineTestRunId;

      await this.dataSource.query(
        `UPDATE system_under_test_workloads w
         SET config = COALESCE(w.config, '{}'::jsonb) || $4::jsonb
         FROM system_under_test_test_environments e
         WHERE e.system_under_test_id = $1
           AND e.name = $2
           AND w.system_under_test_test_environment_id = e.id
           AND w.name = $3`,
        [systemUnderTestId, testEnvironment, workload, JSON.stringify(configUpdate)],
      );
      this.logger.log(`Set workload ADAPT mode to SCALING for ${systemUnderTestId}/${testEnvironment}/${workload}`);
    } catch (error) {
      this.logger.warn(`Failed to auto-set workload ADAPT mode: ${(error as Error).message}`);
    }
  }

  async findAll(
    userId: string,
    roles: string[],
    filters?: { systemUnderTestId?: string; testEnvironment?: string; workload?: string; status?: string },
  ): Promise<ScalingSession[]> {
    const qb = this.repo.createQueryBuilder('s');

    if (!this.authzService.isGlobalAdmin(roles)) {
      const orgIds = await this.authzService.getAccessibleOrganizations(userId);
      if (orgIds.length === 0) return [];
      qb.andWhere('(s.organization_id IN (:...orgIds) OR s.organization_id IS NULL)', { orgIds });
    }

    if (filters?.systemUnderTestId) qb.andWhere('s.system_under_test_id = :sutId', { sutId: filters.systemUnderTestId });
    if (filters?.testEnvironment) qb.andWhere('s.test_environment = :env', { env: filters.testEnvironment });
    if (filters?.workload) qb.andWhere('s.workload = :wl', { wl: filters.workload });
    if (filters?.status) qb.andWhere('s.status = :status', { status: filters.status });

    qb.orderBy('s.created_at', 'DESC');
    return qb.getMany();
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<ScalingSession> {
    const session = await this.repo.findOne({ where: { id } });
    if (!session) throw new ResourceNotFoundException('ScalingSession', id);

    if (!this.authzService.isGlobalAdmin(roles) && session.organization_id) {
      const orgIds = await this.authzService.getAccessibleOrganizations(userId);
      if (!orgIds.includes(session.organization_id)) {
        throw new ResourceNotFoundException('ScalingSession', id);
      }
    }

    return session;
  }

  async update(id: string, dto: UpdateScalingSessionDto, userId: string, roles: string[]): Promise<ScalingSession> {
    const session = await this.findOne(id, userId, roles);

    if (dto.name !== undefined) session.name = dto.name;
    if (dto.description !== undefined) session.description = dto.description;
    if (dto.baselineTestRunId !== undefined) session.baseline_test_run_id = dto.baselineTestRunId;
    if (dto.targetLoad !== undefined) session.target_load = dto.targetLoad;
    if (dto.status !== undefined) session.status = dto.status;
    session.updated_by = userId;

    return this.repo.save(session);
  }

  async getProgression(id: string, userId: string, roles: string[]) {
    const session = await this.findOne(id, userId, roles);

    // Get all test runs in this session, ordered by start time
    const runs = await this.dataSource.query(
      `SELECT
        tr.test_run_id,
        tr.start_time,
        tr.end_time,
        tr.completed,
        tr.consolidated_result,
        tr.application_release,
        tr.annotations,
        (SELECT jsonb_object_agg(key, value)
         FROM test_run_configs trc
         WHERE trc.test_run_id = tr.id
           AND trc.key IN ('targetConcurrency', 'target_concurrency', 'loadLevel', 'threads', 'vusers')
        ) as load_config
      FROM test_runs tr
      WHERE tr.scaling_session_id = $1
      ORDER BY tr.start_time ASC
      LIMIT 100`,
      [id],
    );

    const runIds = runs.map((r: any) => r.test_run_id);

    // Get anomaly detection summary per run (conclusion label counts)
    let anomalySummaryPerRun: Record<string, Record<string, number>> = {};
    if (runIds.length > 0) {
      const anomalyCounts = await this.dataSource.query(
        `SELECT
          dar.test_run_id,
          COALESCE(dar.conclusion->>'label', 'unknown') as conclusion_label,
          COUNT(*)::int as count
        FROM ds_adapt_results dar
        WHERE dar.test_run_id = ANY($1::varchar[])
        GROUP BY dar.test_run_id, COALESCE(dar.conclusion->>'label', 'unknown')
        ORDER BY dar.test_run_id`,
        [runIds],
      );
      for (const row of anomalyCounts) {
        if (!anomalySummaryPerRun[row.test_run_id]) anomalySummaryPerRun[row.test_run_id] = {};
        anomalySummaryPerRun[row.test_run_id]![row.conclusion_label] = row.count;
      }
    }
    let sloResultsPerRun: Record<string, any[]> = {};

    // Get per-benchmark SLO check results for each run
    if (runIds.length > 0 && session.linked_benchmark_ids.length > 0) {
      const checkResults = await this.dataSource.query(
        `SELECT
          cr.test_run_id,
          cr.benchmark_id,
          cr.status,
          cr.meets_requirement,
          cr.panel_title,
          cr.metric_name,
          cr.metric_unit,
          cr.evaluate_type,
          cr.requirement,
          cr.panel_average,
          b.benchmark_type,
          b.config_title,
          b.requirement_operator,
          b.requirement_value,
          b.transaction_name,
          b.min_apdex_score,
          b.apdex_threshold_ms
        FROM check_results cr
        JOIN benchmarks b ON b.id::text = cr.benchmark_id
        WHERE cr.test_run_id = ANY($1::varchar[])
          AND b.id = ANY($2::uuid[])
        ORDER BY cr.test_run_id, b.config_title, cr.panel_title`,
        [runIds, session.linked_benchmark_ids],
      );

      for (const cr of checkResults) {
        if (!sloResultsPerRun[cr.test_run_id]) sloResultsPerRun[cr.test_run_id] = [];
        sloResultsPerRun[cr.test_run_id]!.push({
          benchmark_id: cr.benchmark_id,
          benchmark_type: cr.benchmark_type,
          label: cr.config_title || cr.panel_title || cr.metric_name || 'SLO',
          status: cr.status,
          meets_requirement: cr.meets_requirement,
          actual_value: cr.panel_average != null ? Number(cr.panel_average) : null,
          requirement_operator: cr.requirement_operator,
          requirement_value: cr.requirement_value != null ? Number(cr.requirement_value) : null,
          metric_unit: cr.metric_unit,
          transaction_name: cr.transaction_name,
          min_apdex_score: cr.min_apdex_score != null ? Number(cr.min_apdex_score) : null,
          apdex_threshold_ms: cr.apdex_threshold_ms,
        });
      }
    }

    // Load linked benchmark definitions for the session header
    let linkedBenchmarks: any[] = [];
    if (session.linked_benchmark_ids.length > 0) {
      linkedBenchmarks = await this.dataSource.query(
        `SELECT id, benchmark_type, config_title, panel_title, requirement_operator, requirement_value,
                metric_unit, transaction_name, min_apdex_score, apdex_threshold_ms, enabled
         FROM benchmarks WHERE id = ANY($1::uuid[])
         ORDER BY config_title, panel_title`,
        [session.linked_benchmark_ids],
      );
    }

    return {
      session: {
        id: session.id,
        name: session.name,
        description: session.description,
        baseline_test_run_id: session.baseline_test_run_id,
        target_load: session.target_load,
        status: session.status,
        linked_benchmarks: linkedBenchmarks.map((b: any) => ({
          id: b.id,
          benchmark_type: b.benchmark_type,
          label: b.config_title || b.panel_title || 'SLO',
          requirement_operator: b.requirement_operator,
          requirement_value: b.requirement_value != null ? Number(b.requirement_value) : null,
          metric_unit: b.metric_unit,
          transaction_name: b.transaction_name,
          min_apdex_score: b.min_apdex_score != null ? Number(b.min_apdex_score) : null,
          apdex_threshold_ms: b.apdex_threshold_ms,
          enabled: b.enabled,
        })),
      },
      runs: runs.map((r: any) => ({
        test_run_id: r.test_run_id,
        start_time: r.start_time,
        end_time: r.end_time,
        completed: r.completed,
        meets_requirement: r.consolidated_result?.meetsRequirement ?? null,
        application_release: r.application_release || null,
        annotations: r.annotations || [],
        load_config: r.load_config || {},
        slo_results: sloResultsPerRun[r.test_run_id] || [],
        anomaly_summary: anomalySummaryPerRun[r.test_run_id] || {},
        comment: session.run_comments?.[r.test_run_id] || '',
      })),
    };
  }

  /**
   * Add a test run to a scaling session.
   * Sets scaling_session_id on the test run and switches ADAPT mode to SCALING.
   */
  async addTestRun(sessionId: string, testRunId: string, userId: string, roles: string[]): Promise<{ success: true }> {
    const session = await this.findOne(sessionId, userId, roles);

    // Find the test run (by test_run_id string, not UUID)
    const testRunRows = await this.dataSource.query(
      `SELECT id, test_run_id, system_under_test_id, test_environment, workload, adapt_config
       FROM test_runs WHERE test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (testRunRows.length === 0) {
      throw new ResourceNotFoundException('TestRun', testRunId);
    }
    const testRun = testRunRows[0];

    // Verify the test run matches the session's scope
    if (testRun.system_under_test_id !== session.system_under_test_id ||
        testRun.test_environment !== session.test_environment ||
        testRun.workload !== session.workload) {
      throw new ResourceNotFoundException(
        'TestRun',
        `${testRunId} (scope mismatch: test run does not match session system/environment/workload)`,
      );
    }

    // Set scaling_session_id and switch adapt_config to SCALING mode
    const adaptConfig = testRun.adapt_config || {};
    adaptConfig.mode = 'SCALING';
    if (session.baseline_test_run_id && !adaptConfig.baselineTestRunId) {
      adaptConfig.baselineTestRunId = session.baseline_test_run_id;
    }

    await this.dataSource.query(
      `UPDATE test_runs
       SET scaling_session_id = $1, adapt_config = $2, updated_by = $3, updated_at = NOW()
       WHERE id = $4`,
      [sessionId, JSON.stringify(adaptConfig), userId, testRun.id],
    );

    // If session has no baseline yet, set this test run as baseline
    if (!session.baseline_test_run_id) {
      await this.setBaseline(sessionId, testRunId);
    }

    this.logger.log(`Added test run ${testRunId} to scaling session ${sessionId}`);
    return { success: true };
  }

  /**
   * Update the comment for a specific test run in a scaling session.
   */
  async updateRunComment(sessionId: string, testRunId: string, comment: string, userId: string, roles: string[]): Promise<{ success: true }> {
    const session = await this.findOne(sessionId, userId, roles);
    const comments = session.run_comments || {};
    if (comment.trim()) {
      comments[testRunId] = comment.trim();
    } else {
      delete comments[testRunId];
    }
    await this.repo.update(sessionId, { run_comments: comments, updated_by: userId });
    return { success: true };
  }

  /**
   * Look up a scaling session by ID. Used during test run creation
   * to auto-apply SCALING mode and baseline.
   */
  async findById(id: string): Promise<ScalingSession | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Set the baseline test run for a session (used when first run is created).
   */
  async setBaseline(id: string, testRunId: string): Promise<void> {
    await this.repo.update(id, { baseline_test_run_id: testRunId });
    this.logger.log(`Set baseline for session ${id}: ${testRunId}`);
  }
}
