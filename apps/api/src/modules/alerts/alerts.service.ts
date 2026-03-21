import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun, SystemUnderTest, AlertTagFilter } from '../../entities';
import { EventsService } from '../events/events.service';
import { GrafanaAlertDto, AlertmanagerPayloadDto, AlertmanagerAlert } from './dto/alert-webhook.dto';

interface ParsedAlert {
  systemUnderTest: string;
  testEnvironment: string;
  title: string;
  description: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(TestRun)
    private readonly testRunRepo: Repository<TestRun>,
    @InjectRepository(SystemUnderTest)
    private readonly sutRepo: Repository<SystemUnderTest>,
    @InjectRepository(AlertTagFilter)
    private readonly filterRepo: Repository<AlertTagFilter>,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Process a Grafana legacy alert webhook payload.
   */
  async processGrafanaAlert(dto: GrafanaAlertDto): Promise<{ processed: number; matched: number }> {
    const parsed = this.parseGrafanaLegacy(dto);
    if (!parsed) {
      this.logger.warn('Grafana alert missing system_under_test or test_environment tags, skipping');
      return { processed: 1, matched: 0 };
    }

    const matched = await this.processAlert(parsed, 'grafana');
    return { processed: 1, matched };
  }

  /**
   * Process an Alertmanager / Grafana unified alerting webhook payload.
   */
  async processAlertmanagerPayload(dto: AlertmanagerPayloadDto): Promise<{ processed: number; matched: number }> {
    let totalMatched = 0;

    for (const alert of dto.alerts) {
      if (alert.status !== 'firing') continue;

      const parsed = this.parseAlertmanagerAlert(alert);
      if (!parsed) {
        this.logger.warn('Alertmanager alert missing system_under_test or test_environment labels, skipping');
        continue;
      }

      const matched = await this.processAlert(parsed, 'alertmanager');
      totalMatched += matched;
    }

    return { processed: dto.alerts.length, matched: totalMatched };
  }

  private parseGrafanaLegacy(dto: GrafanaAlertDto): ParsedAlert | null {
    const tags = dto.tags || {};
    const sut = tags.system_under_test || tags.systemUnderTest;
    const env = tags.test_environment || tags.testEnvironment;

    if (!sut || !env) return null;

    const title = dto.ruleName || dto.title || 'Grafana Alert';
    const description = dto.message || '';

    return {
      systemUnderTest: sut,
      testEnvironment: env,
      title,
      description,
      tags,
      metadata: {
        ruleId: dto.ruleId,
        ruleUrl: dto.ruleUrl,
        state: dto.state,
        dashboardId: dto.dashboardId,
        panelId: dto.panelId,
        evalMatches: dto.evalMatches,
      },
    };
  }

  private parseAlertmanagerAlert(alert: AlertmanagerAlert): ParsedAlert | null {
    const labels = alert.labels || {};
    const sut = labels.system_under_test || labels.systemUnderTest;
    const env = labels.test_environment || labels.testEnvironment;

    if (!sut || !env) return null;

    const annotations = alert.annotations || {};
    const title = labels.alertname || annotations.summary || 'Alert';
    const description = annotations.description || annotations.message || '';

    return {
      systemUnderTest: sut,
      testEnvironment: env,
      title,
      description,
      tags: labels,
      metadata: {
        generatorUrl: alert.generatorURL,
        panelUrl: alert.panelURL,
        dashboardUrl: alert.dashboardURL,
        startsAt: alert.startsAt,
        fingerprint: alert.fingerprint,
        status: alert.status,
      },
    };
  }

  /**
   * Core alert processing: find running test runs, apply filters, create events, check abort.
   */
  private async processAlert(parsed: ParsedAlert, source: string): Promise<number> {
    // 1. Resolve system under test
    const sut = await this.sutRepo.findOne({ where: { name: parsed.systemUnderTest } });
    if (!sut) {
      this.logger.warn(`No system under test found for name "${parsed.systemUnderTest}"`);
      return 0;
    }

    // 2. Find running test runs (completed = false, endTime still in the future or within 30s grace)
    const now = new Date();
    const graceWindow = new Date(now.getTime() - 30_000);

    const testRuns = await this.testRunRepo
      .createQueryBuilder('tr')
      .where('tr.system_under_test_id = :sutId', { sutId: sut.id })
      .andWhere('tr.test_environment = :env', { env: parsed.testEnvironment })
      .andWhere('tr.completed = false')
      .andWhere('(tr.end_time IS NULL OR tr.end_time >= :grace)', { grace: graceWindow })
      .getMany();

    if (testRuns.length === 0) {
      this.logger.debug(`No running test runs for ${parsed.systemUnderTest}/${parsed.testEnvironment}`);
      return 0;
    }

    // 3. Load omit filters scoped to this SUT/env and strip matching tags
    const omitFilters = await this.filterRepo.find({
      where: { filterType: 'omit', alertSource: source },
    });

    const filteredTags = this.applyOmitFilters(
      parsed.tags, omitFilters, sut, parsed.testEnvironment, testRuns,
    );

    // 4. Create events for each matched test run
    const eventTags = Object.entries(filteredTags).map(([k, v]) => `${k}=${v}`);

    for (const testRun of testRuns) {
      try {
        await this.eventsService.create(
          {
            title: parsed.title,
            description: parsed.description,
            systemUnderTest: sut.id,
            testEnvironment: parsed.testEnvironment,
            timestamp: new Date().toISOString(),
            source,
            tags: eventTags,
            alertMetadata: parsed.metadata,
            organizationId: testRun.organizationId || sut.organization_id,
          },
          'system:alerts',
          [],
        );
      } catch (err) {
        this.logger.error(`Failed to create event for test run ${testRun.id}: ${err}`);
      }
    }

    // 5. Check abort conditions
    await this.checkAbortConditions(parsed, source, sut, testRuns);

    return testRuns.length;
  }

  /**
   * Strip tags that match omit filters scoped to this SUT/env/workload.
   * Returns a new tags object with matching keys removed.
   */
  private applyOmitFilters(
    tags: Record<string, string>,
    filters: AlertTagFilter[],
    sut: SystemUnderTest,
    testEnvironment: string,
    testRuns: TestRun[],
  ): Record<string, string> {
    const workloads = new Set(testRuns.map(tr => tr.workload).filter(Boolean));
    const result = { ...tags };

    for (const filter of filters) {
      // Check SUT/env/workload scope
      if (filter.systemUnderTestId && filter.systemUnderTestId !== sut.id) continue;
      if (filter.testEnvironment && filter.testEnvironment !== testEnvironment) continue;
      if (filter.testType && !workloads.has(filter.testType)) continue;

      const tagValue = result[filter.tagKey];
      if (tagValue === undefined) continue;

      // If filter has no tagValue, any value matches; otherwise exact match
      if (!filter.tagValue || tagValue === filter.tagValue) {
        delete result[filter.tagKey];
        this.logger.debug(`Omitted tag ${filter.tagKey} from alert for ${sut.name}`);
      }
    }

    return result;
  }

  private async checkAbortConditions(
    parsed: ParsedAlert,
    source: string,
    sut: SystemUnderTest,
    testRuns: TestRun[],
  ): Promise<void> {
    const abortFilters = await this.filterRepo.find({
      where: { filterType: 'abort', alertSource: source },
    });

    if (abortFilters.length === 0) return;

    for (const filter of abortFilters) {
      // Check if filter applies to this system/environment
      if (filter.systemUnderTestId && filter.systemUnderTestId !== sut.id) continue;
      if (filter.testEnvironment && filter.testEnvironment !== parsed.testEnvironment) continue;

      // Check if tag matches
      const tagValue = parsed.tags[filter.tagKey];
      if (tagValue === undefined) continue;
      if (filter.tagValue && tagValue !== filter.tagValue) continue;

      // Tag matches - abort matching test runs
      const abortMessage = `Alert abort: ${parsed.title} (tag ${filter.tagKey}=${tagValue || '*'} from ${source})`;

      for (const testRun of testRuns) {
        if (filter.testType && testRun.workload !== filter.testType) continue;

        try {
          await this.testRunRepo.update(testRun.id, {
            abort: true,
            abortMessage,
          });
          this.logger.warn(`Test run ${testRun.testRunId} aborted by alert: ${abortMessage}`);
        } catch (err) {
          this.logger.error(`Failed to abort test run ${testRun.id}: ${err}`);
        }
      }
    }
  }
}
