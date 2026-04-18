import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';

const SYSTEM_ACTOR = 'system:provisioning';

interface ProvisioningFile<T> {
  organizationId?: string | null;
  items: T[];
}

interface ProfileYaml {
  name: string;
  description?: string;
  tags?: string[];
}

interface DashboardVariable {
  name: string;
  values: string[];
}

interface MatchRegexVariable {
  name: string;
  regex: string;
}

interface DashboardYaml {
  profile: string;
  grafana?: string;
  dashboardName: string;
  dashboardUid: string;
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: DashboardVariable[] | null;
  matchRegexForVariables?: MatchRegexVariable[] | null;
}

interface BenchmarkYaml {
  profile: string;
  grafana?: string;
  dashboardUid: string;
  addForWorkloadsMatchingRegex?: string;
  panel: {
    id: number;
    title?: string;
    type?: string;
    yAxesFormat?: string;
    evaluateType?: string;
    requirement?: {
      operator?: string;
      value?: number;
    };
    excludeRampUpTime?: boolean;
    matchPattern?: string;
    validateWithDefaultIfNoData?: boolean;
    validateWithDefaultIfNoDataValue?: number;
  };
}

interface MetricClassificationYaml {
  dashboardUid: string;
  dashboardLabel?: string;
  panelId: number;
  panelTitle?: string;
  metricClassification: string;
  higherIsBetter?: boolean;
  absThreshold?: number;
  ignore?: boolean;
  ignoreMeanDiffSmallerThan?: number;
}

@Injectable()
export class ProvisioningService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    @InjectRepository(ProfileGrafanaDashboard)
    private readonly dashboardRepo: Repository<ProfileGrafanaDashboard>,
    @InjectRepository(ProfileBenchmark)
    private readonly benchmarkRepo: Repository<ProfileBenchmark>,
    @InjectRepository(ProvisionedTemplateDsCompareConfig)
    private readonly templateRepo: Repository<ProvisionedTemplateDsCompareConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const enabled = this.configService.get<string>('PROVISIONING_ENABLED', 'true');
      if (enabled !== 'true') {
        this.logger.log('Provisioning is disabled (PROVISIONING_ENABLED != true)');
        return;
      }

      const dir = this.configService.get<string>(
        'PROVISIONING_DIR',
        '/data/provisioning',
      );

      if (!fs.existsSync(dir)) {
        this.logger.log(
          `Provisioning directory not found: ${dir} — skipping provisioning`,
        );
        return;
      }

      this.logger.log(`Starting provisioning from ${dir}`);
      await this.runProvisioning(dir);
    } catch (error) {
      this.logger.error(
        'Provisioning failed unexpectedly — API will continue to start',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async runProvisioning(dir: string): Promise<void> {
    const summary = { created: 0, updated: 0, skipped: 0, errors: 0 };

    // 1. Profiles (no dependencies)
    const profiles = this.loadYamlFile<ProfileYaml>(dir, 'profiles.yaml');
    if (profiles) {
      const result = await this.provisionProfiles(
        profiles.items,
        profiles.organizationId,
      );
      this.mergeSummary(summary, result);
    }

    // 2. Profile Grafana Dashboards (depends on profiles by name)
    const dashboards = this.loadYamlFile<DashboardYaml>(
      dir,
      'profile_grafana_dashboards.yaml',
    );
    if (dashboards) {
      const result = await this.provisionProfileDashboards(
        dashboards.items,
        dashboards.organizationId,
      );
      this.mergeSummary(summary, result);
    }

    // 3. Profile Benchmarks (depends on profiles and dashboards)
    const benchmarks = this.loadYamlFile<BenchmarkYaml>(
      dir,
      'profile_benchmarks.yaml',
    );
    if (benchmarks) {
      const result = await this.provisionProfileBenchmarks(
        benchmarks.items,
        benchmarks.organizationId,
      );
      this.mergeSummary(summary, result);
    }

    // 4. Metric Classifications (no FK dependencies)
    const classifications = this.loadYamlFile<MetricClassificationYaml>(
      dir,
      'template_ds_compare_configs.yaml',
    );
    if (classifications) {
      const result = await this.provisionMetricClassifications(
        classifications.items,
        classifications.organizationId,
      );
      this.mergeSummary(summary, result);
    }

    this.logger.log(
      `Provisioning complete: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors} errors`,
    );
  }

  /**
   * Load and parse a YAML file. Supports both wrapped format ({ organizationId, items: [...] })
   * and flat array format ([...]).
   */
  loadYamlFile<T>(
    dir: string,
    filename: string,
  ): ProvisioningFile<T> | null {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      this.logger.log(`${filename} not found — skipping`);
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = yaml.load(content);

      if (Array.isArray(parsed)) {
        return { organizationId: null, items: parsed as T[] };
      }

      if (parsed && typeof parsed === 'object' && 'items' in parsed) {
        const wrapped = parsed as { organizationId?: string | null; items: T[] };
        return {
          organizationId: wrapped.organizationId ?? null,
          items: wrapped.items,
        };
      }

      this.logger.warn(
        `${filename}: unexpected format — expected array or { items: [...] }`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to parse ${filename}`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  async provisionProfiles(
    items: ProfileYaml[],
    organizationId?: string | null,
  ): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
    const result = { created: 0, updated: 0, skipped: 0, errors: 0 };

    for (const item of items) {
      try {
        const existing = await this.profileRepo.findOne({
          where: { name: item.name },
        });

        if (existing) {
          await this.profileRepo.update(existing.id, {
            description: item.description,
            tags: item.tags,
            readOnly: true,
            updatedBy: SYSTEM_ACTOR,
            ...(organizationId ? { organizationId } : {}),
          });
          result.updated++;
        } else {
          await this.profileRepo.insert({
            name: item.name,
            description: item.description,
            tags: item.tags,
            readOnly: true,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
            ...(organizationId ? { organizationId } : {}),
          });
          result.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to provision profile "${item.name}"`,
          error instanceof Error ? error.message : String(error),
        );
        result.errors++;
      }
    }

    this.logger.log(
      `Profiles: ${result.created} created, ${result.updated} updated, ${result.errors} errors`,
    );
    return result;
  }

  async provisionProfileDashboards(
    items: DashboardYaml[],
    organizationId?: string | null,
  ): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
    const result = { created: 0, updated: 0, skipped: 0, errors: 0 };

    for (const item of items) {
      try {
        const grafanaLabel = item.grafana ?? 'Default';

        const existing = await this.dashboardRepo.findOne({
          where: {
            profile: item.profile,
            dashboardUid: item.dashboardUid,
            grafanaLabel,
          },
        });

        // Convert [{name, regex}] array to Record<string, string> for entity
        const matchRegex = item.matchRegexForVariables
          ? Object.fromEntries(
              item.matchRegexForVariables.map((v) => [v.name, v.regex]),
            )
          : undefined;

        const values = {
          profile: item.profile,
          dashboardName: item.dashboardName,
          dashboardUid: item.dashboardUid,
          grafanaLabel,
          createSeparateDashboardForVariable:
            item.createSeparateDashboardForVariable ?? undefined,
          setHardcodedValueForVariables:
            item.setHardcodedValueForVariables ?? undefined,
          matchRegexForVariables: matchRegex,
          readOnly: true,
          ...(organizationId ? { organizationId } : {}),
        };

        if (existing) {
          await this.dashboardRepo.update(existing.id, {
            ...values,
            updatedBy: SYSTEM_ACTOR,
          });
          result.updated++;
        } else {
          await this.dashboardRepo.insert({
            ...values,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
          });
          result.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to provision dashboard "${item.dashboardName}" for profile "${item.profile}"`,
          error instanceof Error ? error.message : String(error),
        );
        result.errors++;
      }
    }

    this.logger.log(
      `Profile dashboards: ${result.created} created, ${result.updated} updated, ${result.errors} errors`,
    );
    return result;
  }

  async provisionProfileBenchmarks(
    items: BenchmarkYaml[],
    organizationId?: string | null,
  ): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
    const result = { created: 0, updated: 0, skipped: 0, errors: 0 };

    for (const item of items) {
      try {
        const grafanaLabel = item.grafana ?? 'Default';

        // Resolve profile name → profile_id
        const profile = await this.profileRepo.findOne({
          where: { name: item.profile },
        });
        if (!profile) {
          this.logger.warn(
            `Benchmark skipped: profile "${item.profile}" not found`,
          );
          result.skipped++;
          continue;
        }

        // Resolve profile + dashboardUid + grafana → profile_dashboard_id
        const dashboard = await this.dashboardRepo.findOne({
          where: {
            profile: item.profile,
            dashboardUid: item.dashboardUid,
            grafanaLabel,
          },
        });
        if (!dashboard) {
          this.logger.warn(
            `Benchmark skipped: dashboard "${item.dashboardUid}" for profile "${item.profile}" not found`,
          );
          result.skipped++;
          continue;
        }

        const workloadPattern = item.addForWorkloadsMatchingRegex ?? '.*';

        // Find existing by composite key
        const existing = await this.benchmarkRepo.findOne({
          where: {
            profile_id: profile.id,
            profile_dashboard_id: dashboard.id,
            panel_id: item.panel.id,
            workload_pattern: workloadPattern,
          },
        });

        const values = {
          profile_id: profile.id,
          profile_dashboard_id: dashboard.id,
          workload_pattern: workloadPattern,
          source: 'grafana' as const,
          grafana_instance: grafanaLabel,
          dashboard_uid: item.dashboardUid,
          panel_id: item.panel.id,
          panel_title: item.panel.title,
          panel_type: item.panel.type,
          metric_unit: item.panel.yAxesFormat,
          evaluate_type: item.panel.evaluateType,
          requirement_operator: item.panel.requirement?.operator,
          requirement_value: item.panel.requirement?.value,
          exclude_ramp_up_time: item.panel.excludeRampUpTime ?? true,
          match_pattern: item.panel.matchPattern,
          validate_with_default_if_no_data:
            item.panel.validateWithDefaultIfNoData ?? false,
          validate_with_default_if_no_data_value:
            item.panel.validateWithDefaultIfNoDataValue,
          read_only: true,
          ...(organizationId ? { organizationId } : {}),
        };

        if (existing) {
          await this.benchmarkRepo.update(existing.id, {
            ...values,
            updatedBy: SYSTEM_ACTOR,
          });
          result.updated++;
        } else {
          await this.benchmarkRepo.insert({
            ...values,
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
          });
          result.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to provision benchmark for panel ${item.panel?.id} in dashboard "${item.dashboardUid}"`,
          error instanceof Error ? error.message : String(error),
        );
        result.errors++;
      }
    }

    this.logger.log(
      `Profile benchmarks: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`,
    );
    return result;
  }

  async provisionMetricClassifications(
    items: MetricClassificationYaml[],
    organizationId?: string | null,
  ): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
    const result = { created: 0, updated: 0, skipped: 0, errors: 0 };

    for (const item of items) {
      try {
        // Find existing by dashboard_uid + panel_id
        const existing = await this.templateRepo.findOne({
          where: {
            dashboard_uid: item.dashboardUid,
            panel_id: item.panelId,
          },
        });

        // Build config_overrides from threshold fields in the YAML
        const configOverrides: Record<string, number | boolean | string> = {};
        if (item.absThreshold !== undefined) configOverrides.absThreshold = item.absThreshold;
        if (item.ignore !== undefined) configOverrides.ignore = item.ignore;
        if (item.ignoreMeanDiffSmallerThan !== undefined) configOverrides.ignoreMeanDiffSmallerThan = item.ignoreMeanDiffSmallerThan;

        const values = {
          dashboard_uid: item.dashboardUid,
          dashboard_label: item.dashboardLabel,
          panel_id: item.panelId,
          panel_title: item.panelTitle,
          metric_classification: item.metricClassification,
          higher_is_better: item.higherIsBetter,
          ...(Object.keys(configOverrides).length > 0 ? { config_overrides: configOverrides } : {}),
          ...(organizationId ? { organization_id: organizationId } : {}),
        };

        if (existing) {
          await this.templateRepo.update(existing.id, {
            ...values,
            updated_by: SYSTEM_ACTOR,
          } as any);
          result.updated++;
        } else {
          await this.templateRepo.insert({
            ...values,
            created_by: SYSTEM_ACTOR,
            updated_by: SYSTEM_ACTOR,
          } as any);
          result.created++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to provision metric classification for dashboard "${item.dashboardUid}" panel ${item.panelId}`,
          error instanceof Error ? error.message : String(error),
        );
        result.errors++;
      }
    }

    this.logger.log(
      `Metric classifications: ${result.created} created, ${result.updated} updated, ${result.errors} errors`,
    );
    return result;
  }

  private mergeSummary(
    target: { created: number; updated: number; skipped: number; errors: number },
    source: { created: number; updated: number; skipped: number; errors: number },
  ): void {
    target.created += source.created;
    target.updated += source.updated;
    target.skipped += source.skipped;
    target.errors += source.errors;
  }
}
