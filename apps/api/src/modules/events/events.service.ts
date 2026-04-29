import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event, SystemUnderTest, ApplicationDashboard, GrafanaInstance, TestRun } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { GrafanaClientService } from '../grafana/grafana-client.service';
import { CreateEventDto, UpdateEventDto, EventQueryDto } from './dto/event.dto';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @InjectRepository(SystemUnderTest)
    private readonly sutRepo: Repository<SystemUnderTest>,
    @InjectRepository(ApplicationDashboard)
    private readonly appDashboardRepo: Repository<ApplicationDashboard>,
    @InjectRepository(GrafanaInstance)
    private readonly grafanaInstanceRepo: Repository<GrafanaInstance>,
    private readonly authzService: AuthorizationService,
    private readonly grafanaClient: GrafanaClientService,
  ) {}

  async findAll(userId: string, roles: string[], query?: EventQueryDto): Promise<Event[]> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.systemUnderTest', 'sut')
      .orderBy('e.timestamp', 'DESC');

    if (orgIds !== null) {
      qb.andWhere(
        '(e.organization_id IN (:...orgIds) OR e.organization_id IS NULL)',
        { orgIds: orgIds.length > 0 ? orgIds : ['00000000-0000-0000-0000-000000000000'] },
      );
    }

    if (query?.systemUnderTestId) {
      qb.andWhere('e.system_under_test_id = :sutId', { sutId: query.systemUnderTestId });
    }
    if (query?.testEnvironment) {
      qb.andWhere('e.test_environment = :env', { env: query.testEnvironment });
    }
    if (query?.from) {
      qb.andWhere('e.timestamp >= :from', { from: query.from });
    }
    if (query?.to) {
      qb.andWhere('e.timestamp <= :to', { to: query.to });
    }

    return qb.getMany();
  }

  async findByTestRun(testRunId: string, userId: string, roles: string[]): Promise<Event[]> {
    // Load test run info to get system + env + time window
    // Support both UUID (id) and human-readable test_run_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testRunId);
    const testRun = await this.eventRepo.manager.getRepository(TestRun).findOne({
      where: isUuid ? { id: testRunId } : { testRunId },
      select: ['id', 'systemUnderTestId', 'testEnvironment', 'startTime', 'endTime'],
    });

    if (!testRun) {
      throw new NotFoundException(`Test run ${testRunId} not found`);
    }

    const orgIds = await withOrgFilter(userId, roles, this.authzService);

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.systemUnderTest', 'sut')
      .where('e.system_under_test_id = :sutId', { sutId: testRun.systemUnderTestId })
      .andWhere('e.test_environment = :env', { env: testRun.testEnvironment })
      .orderBy('e.timestamp', 'ASC');

    // Time window: startTime - 120s to endTime + 120s (or now if no endTime)
    if (testRun.startTime) {
      const from = new Date(new Date(testRun.startTime).getTime() - 120_000);
      const to = testRun.endTime
        ? new Date(new Date(testRun.endTime).getTime() + 120_000)
        : new Date();
      qb.andWhere('e.timestamp BETWEEN :from AND :to', { from, to });
    }

    // Filter out auto-generated test start/end events
    qb.andWhere("e.title NOT IN ('Test start', 'Test end')");

    if (orgIds !== null) {
      qb.andWhere(
        '(e.organization_id IN (:...orgIds) OR e.organization_id IS NULL)',
        { orgIds: orgIds.length > 0 ? orgIds : ['00000000-0000-0000-0000-000000000000'] },
      );
    }

    return qb.getMany();
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<Event> {
    const event = await this.eventRepo.findOne({
      where: { id },
      relations: ['systemUnderTest'],
    });

    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    if (!this.authzService.isGlobalAdmin(roles) && event.organizationId) {
      const hasAccess = await this.authzService.isOrganizationMember(userId, event.organizationId);
      if (!hasAccess) {
        throw new NotFoundException(`Event ${id} not found`);
      }
    }

    return event;
  }

  async create(dto: CreateEventDto, userId: string, _roles: string[]): Promise<Event> {
    // Resolve system under test by UUID or name
    let sut: SystemUnderTest | null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.systemUnderTest);

    if (isUuid) {
      sut = await this.sutRepo.findOne({ where: { id: dto.systemUnderTest } });
    } else {
      sut = await this.sutRepo.findOne({ where: { name: dto.systemUnderTest } });
    }

    if (!sut) {
      throw new NotFoundException(`System under test "${dto.systemUnderTest}" not found`);
    }

    const event = this.eventRepo.create({
      title: dto.title,
      description: dto.description,
      systemUnderTestId: sut.id,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      source: dto.source || 'manual',
      tags: dto.tags,
      alertMetadata: dto.alertMetadata,
      organizationId: dto.organizationId || sut.organization_id,
      createdBy: userId,
      updatedBy: userId,
    });

    const saved = await this.eventRepo.save(event);

    // Best-effort Grafana annotation creation
    await this.syncGrafanaAnnotations(saved);

    return this.eventRepo.findOne({ where: { id: saved.id }, relations: ['systemUnderTest'] }) as Promise<Event>;
  }

  async update(id: string, dto: UpdateEventDto, userId: string, roles: string[]): Promise<Event> {
    const event = await this.findOne(id, userId, roles);

    const timestampChanged = dto.timestamp && new Date(dto.timestamp).getTime() !== event.timestamp.getTime();

    if (dto.title !== undefined) event.title = dto.title;
    if (dto.description !== undefined) event.description = dto.description;
    if (dto.timestamp !== undefined) event.timestamp = new Date(dto.timestamp);
    if (dto.tags !== undefined) event.tags = dto.tags;
    event.updatedBy = userId;

    const saved = await this.eventRepo.save(event);

    // If timestamp changed, re-sync Grafana annotations
    if (timestampChanged) {
      await this.deleteGrafanaAnnotations(event);
      event.grafanaAnnotationIds = {};
      await this.syncGrafanaAnnotations(saved);
    }

    return this.eventRepo.findOne({ where: { id: saved.id }, relations: ['systemUnderTest'] }) as Promise<Event>;
  }

  async remove(id: string, userId: string, roles: string[]): Promise<void> {
    const event = await this.findOne(id, userId, roles);

    // Best-effort Grafana annotation cleanup
    await this.deleteGrafanaAnnotations(event);

    await this.eventRepo.remove(event);
  }

  /**
   * Create Grafana annotations for all matching application dashboards (best-effort)
   */
  private async syncGrafanaAnnotations(event: Event): Promise<void> {
    try {
      const appDashboards = await this.appDashboardRepo.find({
        where: {
          systemUnderTestId: event.systemUnderTestId,
          testEnvironment: event.testEnvironment,
        },
        relations: ['grafanaInstance'],
      });

      if (appDashboards.length === 0) return;

      const annotationIds: Record<string, number> = {};
      const timestamp = event.timestamp.getTime();
      let failed = 0;

      for (const appDash of appDashboards) {
        if (!appDash.grafanaInstance || !appDash.dashboardUid) continue;

        const instance = appDash.grafanaInstance;
        const key = `${instance.id}:${appDash.dashboardUid}`;

        try {
          const grafanaInst = {
            id: instance.id,
            label: instance.label,
            client_url: instance.client_url,
            server_url: instance.server_url,
            org_id: instance.orgId,
            api_key: instance.apiKey || '',
          };

          const result = await this.grafanaClient.createAnnotation(grafanaInst, {
            dashboardUID: appDash.dashboardUid,
            time: timestamp,
            tags: event.tags || [],
            text: `${event.title}${event.description ? '\n' + event.description : ''}`,
          });

          annotationIds[key] = result.id;
        } catch {
          failed++;
        }
      }

      if (failed > 0) {
        this.logger.warn(`Grafana annotations: ${Object.keys(annotationIds).length} created, ${failed} failed for event ${event.id}`);
      }

      if (Object.keys(annotationIds).length > 0) {
        await this.eventRepo.update(event.id, { grafanaAnnotationIds: annotationIds });
        event.grafanaAnnotationIds = annotationIds;
      }
    } catch (err) {
      this.logger.warn(`Failed to sync Grafana annotations for event ${event.id}: ${err}`);
    }
  }

  /**
   * Delete all stored Grafana annotations for an event (best-effort)
   */
  private async deleteGrafanaAnnotations(event: Event): Promise<void> {
    if (!event.grafanaAnnotationIds || Object.keys(event.grafanaAnnotationIds).length === 0) return;

    let deleted = 0;
    let failed = 0;

    for (const [key, annotationId] of Object.entries(event.grafanaAnnotationIds)) {
      const [instanceId] = key.split(':');
      try {
        const instance = await this.grafanaInstanceRepo.findOne({ where: { id: instanceId } });
        if (!instance) continue;

        const grafanaInst = {
          id: instance.id,
          label: instance.label,
          client_url: instance.client_url,
          server_url: instance.server_url,
          org_id: instance.orgId,
          api_key: instance.apiKey || '',
        };

        await this.grafanaClient.deleteAnnotation(grafanaInst, annotationId);
        deleted++;
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      this.logger.warn(`Grafana annotation cleanup: ${deleted} deleted, ${failed} failed for event ${event.id}`);
    }
  }
}
