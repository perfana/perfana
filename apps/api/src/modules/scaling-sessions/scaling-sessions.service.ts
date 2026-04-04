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
      status: 'active',
      organization_id: organizationId,
      created_by: userId,
      updated_by: userId,
    });

    const saved = await this.repo.save(session);
    this.logger.log(`Created scaling session ${saved.id}: ${saved.name}`);
    return saved;
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
        tr.adapt_config,
        tr.consolidated_result,
        dac.conclusion as adapt_conclusion,
        (SELECT jsonb_object_agg(key, value)
         FROM test_run_configurations trc
         WHERE trc.test_run_id = tr.id
           AND trc.key IN ('targetConcurrency', 'target_concurrency', 'loadLevel', 'threads', 'vusers')
        ) as load_config
      FROM test_runs tr
      LEFT JOIN ds_adapt_conclusion dac ON dac.test_run_id = tr.test_run_id
      WHERE tr.scaling_session_id = $1
      ORDER BY tr.start_time ASC
      LIMIT 100`,
      [id],
    );

    // Get key metrics per run from ds_metric_statistics
    const runIds = runs.map((r: any) => r.test_run_id);
    let metricsPerRun: Record<string, any> = {};

    if (runIds.length > 0) {
      const metrics = await this.dataSource.query(
        `SELECT
          s.test_run_id,
          s.panel_title,
          s.metric_name,
          s.median,
          s.p95,
          s.mean
        FROM ds_metric_statistics s
        WHERE s.test_run_id = ANY($1::varchar[])
          AND s.panel_title IN ('Response Times', 'Throughput', 'Requests response times', 'Request Duration')
        ORDER BY s.test_run_id, s.panel_title, s.metric_name`,
        [runIds],
      );

      for (const m of metrics) {
        if (!metricsPerRun[m.test_run_id]) metricsPerRun[m.test_run_id] = [];
        metricsPerRun[m.test_run_id].push({
          panel: m.panel_title,
          metric: m.metric_name,
          median: m.median,
          p95: m.p95,
          mean: m.mean,
        });
      }
    }

    return {
      session: {
        id: session.id,
        name: session.name,
        description: session.description,
        baseline_test_run_id: session.baseline_test_run_id,
        target_load: session.target_load,
        status: session.status,
      },
      runs: runs.map((r: any) => ({
        test_run_id: r.test_run_id,
        start_time: r.start_time,
        end_time: r.end_time,
        completed: r.completed,
        adapt_conclusion: r.adapt_conclusion || null,
        meets_requirement: r.consolidated_result?.meetsRequirement || null,
        adapt_ok: r.consolidated_result?.adaptTestRunOK || null,
        load_config: r.load_config || {},
        metrics: metricsPerRun[r.test_run_id] || [],
      })),
    };
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
