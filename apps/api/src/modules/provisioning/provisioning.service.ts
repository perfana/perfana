import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import * as yaml from 'js-yaml';
import {
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import {
  PERF_TEST_PROFILE_SOURCE,
  PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT,
} from '@perfana/shared/constants';
import { validateRegexPattern } from '@perfana/shared/utils';
import { PROFILE_BENCHMARK_SOURCES } from '../profiles/dto/profile-benchmark.dto';
import { parseTemplateItem, templateKey, TemplateColumns } from './compare-template-codec';

const SYSTEM_ACTOR = 'system:provisioning';

/**
 * Serialises compare-template provisioning across API replicas booting together. Session-level on
 * one dedicated connection, not `pg_advisory_xact_lock`: each item is written on its own so one bad
 * item cannot abort the rest, and a transaction would (25P02 after the first failed statement).
 */
const TEMPLATE_LOCK_KEY = "hashtext('perfana:provisioning:compare-templates')";
/**
 * How long a booting replica waits for another one to finish template provisioning. A normal run
 * takes well under a second; a lock still held after this belongs to a backend whose host died, and
 * Postgres keeps it until TCP keepalive reaps it, so this replica skips the step instead of hanging
 * its own boot (and readiness probe) behind it.
 */
const TEMPLATE_LOCK_ATTEMPTS = 30;
const TEMPLATE_LOCK_RETRY_MS = 1000;

type ProvisioningSummary = { created: number; updated: number; skipped: number; errors: number };
export type TemplateProvisioningSummary = ProvisioningSummary & {
  unchanged: number;
  takenOver: number;
  pruned: number;
};

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
  /** `performance-metrics`: no profile dashboard; `dashboardUid` is a regex over the perf-test scenario uids (default when omitted). */
  source?: string;
  grafana?: string;
  dashboardUid?: string;
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
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
    const classifications = this.loadYamlFile<unknown>(
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
        // Only a real list is a declared state. A typo such as `items:` with nothing after it reads
        // as null, and treating that as "no items" would prune every provisioned template.
        if (!Array.isArray(wrapped.items)) {
          this.logger.error(
            `${filename}: items must be a list — nothing is provisioned or pruned from this file`,
          );
          return null;
        }
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
        const existing = await withRequestEm(this.profileRepo).findOne({
          where: { name: item.name },
        });

        if (existing) {
          await withRequestEm(this.profileRepo).update(existing.id, {
            description: item.description,
            tags: item.tags,
            readOnly: true,
            updatedBy: SYSTEM_ACTOR,
            ...(organizationId ? { organizationId } : {}),
          });
          result.updated++;
        } else {
          await withRequestEm(this.profileRepo).insert({
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

        const existing = await withRequestEm(this.dashboardRepo).findOne({
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
          await withRequestEm(this.dashboardRepo).update(existing.id, {
            ...values,
            updatedBy: SYSTEM_ACTOR,
          });
          result.updated++;
        } else {
          await withRequestEm(this.dashboardRepo).insert({
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
        const profile = await withRequestEm(this.profileRepo).findOne({
          where: { name: item.profile },
        });
        if (!profile) {
          this.logger.warn(
            `Benchmark skipped: profile "${item.profile}" not found`,
          );
          result.skipped++;
          continue;
        }

        const source = item.source ?? 'grafana';
        if (!(PROFILE_BENCHMARK_SOURCES as readonly string[]).includes(source)) {
          this.logger.warn(`Benchmark skipped: unknown source "${item.source}" for profile "${item.profile}"`);
          result.skipped++;
          continue;
        }
        const isPerfTest = source === PERF_TEST_PROFILE_SOURCE;
        if (!isPerfTest && !item.dashboardUid) {
          this.logger.warn(`Benchmark skipped: dashboardUid missing for profile "${item.profile}"`);
          result.skipped++;
          continue;
        }
        // Resolve profile + dashboardUid + grafana → profile_dashboard_id. A perf-test
        // benchmark has no profile dashboard: its uid is a regex over the scenario uids.
        let dashboardId: string | null = null;
        if (!isPerfTest) {
          const dashboard = await withRequestEm(this.dashboardRepo).findOne({
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
          dashboardId = dashboard.id;
        }
        const dashboardUid = isPerfTest
          ? item.dashboardUid ?? PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT
          : item.dashboardUid;
        if (isPerfTest) {
          const check = validateRegexPattern(dashboardUid, { maxLength: 255 });
          if (!check.safe) {
            this.logger.warn(`Benchmark skipped: dashboardUid is not a valid regex (${check.error}) for profile "${item.profile}"`);
            result.skipped++;
            continue;
          }
        }

        const workloadPattern = item.addForWorkloadsMatchingRegex ?? '.*';

        // Find existing by composite key
        const existing = await withRequestEm(this.benchmarkRepo).findOne({
          where: {
            profile_id: profile.id,
            profile_dashboard_id: dashboardId ?? IsNull(),
            ...(isPerfTest ? { dashboard_uid: dashboardUid } : {}),
            panel_id: item.panel.id,
            workload_pattern: workloadPattern,
          },
        });

        const values = {
          profile_id: profile.id,
          profile_dashboard_id: dashboardId,
          workload_pattern: workloadPattern,
          source,
          grafana_instance: isPerfTest ? undefined : grafanaLabel,
          dashboard_uid: dashboardUid,
          panel_id: item.panel.id,
          panel_title: item.panel.title,
          panel_type: item.panel.type,
          // A trend is % of the series mean per hour whatever the panel measures.
          metric_unit: item.panel.evaluateType === 'trend' ? '%/h' : item.panel.yAxesFormat,
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
          await withRequestEm(this.benchmarkRepo).update(existing.id, {
            ...values,
            updatedBy: SYSTEM_ACTOR,
          });
          result.updated++;
        } else {
          await withRequestEm(this.benchmarkRepo).insert({
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

  /**
   * Makes the template table match `template_ds_compare_configs.yaml`: creates and updates the
   * templates it declares, takes over a UI-created row holding one of its keys, and prunes the
   * provisioned templates it no longer declares.
   *
   * The key is `templateKey()` (migration 1822's unique index). Every item is parsed before any
   * write, so an item that fails to parse or write still declares its key and is not pruned. An
   * item whose key cannot be read at all suppresses the prune for this boot: it may be the edited
   * form of a template the file still means to keep.
   *
   * A `profile` is resolved by name, as `profile_benchmarks.yaml` does. An item naming a profile that
   * does not exist has no key either (a profile template's key is the profile's id), but it can only
   * be a profile template, so it suppresses the prune of profile templates alone. An item whose
   * `organizationId` is not its profile's is skipped with its key still declared.
   */
  async provisionMetricClassifications(
    items: unknown[],
    organizationId?: string | null,
  ): Promise<TemplateProvisioningSummary> {
    const result = { created: 0, updated: 0, unchanged: 0, takenOver: 0, pruned: 0, skipped: 0, errors: 0 };
    const label = (index: number) => `template_ds_compare_configs.yaml item ${index + 1}`;

    // Profiles are provisioned first (profiles.yaml), so a profile the same boot creates resolves here.
    // Names are unique across the install (profiles.name), so a name is a whole reference.
    const profiles = new Map(
      (await withRequestEm(this.profileRepo).find({ select: ['id', 'name', 'organizationId'] })).map((p) => [p.name, p]),
    );
    const resolveProfile = (name: string) => profiles.get(name);

    const declared = new Set<string>();
    let unidentified = 0;
    const unresolvedProfiles = new Set<string>();
    const byKey = new Map<string, Array<{ index: number; values: TemplateColumns }>>();
    items.forEach((item, index) => {
      const parsed = parseTemplateItem(item, organizationId ?? null, { resolveProfile });
      if (!parsed.ok && parsed.unresolvedProfile !== undefined) {
        this.logger.warn(`${label(index)}: profile "${parsed.unresolvedProfile}" not found — skipped`);
        unresolvedProfiles.add(parsed.unresolvedProfile);
        result.skipped++;
        return;
      }
      if (parsed.key) declared.add(parsed.key);
      else unidentified++;
      if (!parsed.ok) {
        this.logger.error(`${label(index)}: ${parsed.error} — skipped`);
        result.errors++;
        return;
      }
      for (const warning of parsed.warnings) this.logger.warn(`${label(index)}: ${warning}`);
      byKey.set(parsed.key, [...(byKey.get(parsed.key) ?? []), { index, values: parsed.values }]);
    });

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      let locked = false;
      for (let attempt = 1; attempt <= TEMPLATE_LOCK_ATTEMPTS && !locked; attempt++) {
        const rows: Array<{ locked: boolean }> = await runner.query(
          `SELECT pg_try_advisory_lock(${TEMPLATE_LOCK_KEY}) AS locked`,
        );
        locked = rows?.[0]?.locked === true;
        if (!locked && attempt < TEMPLATE_LOCK_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, TEMPLATE_LOCK_RETRY_MS));
        }
      }
      if (!locked) {
        this.logger.error(
          `template_ds_compare_configs.yaml: another API instance held the provisioning lock for ${(TEMPLATE_LOCK_ATTEMPTS * TEMPLATE_LOCK_RETRY_MS) / 1000}s — nothing provisioned or pruned this boot`,
        );
        result.errors++;
        return result;
      }
      try {
        // Rows an API older than migration 1822 wrote after it ran (a rolling deploy, a rollback)
        // carry read_only false or NULL, and the prune skips those: mark provisioning's own again.
        await runner.query(
          `UPDATE provisioned_template_ds_compare_configs SET read_only = true
            WHERE created_by = $1 AND system_under_test_id IS NULL AND read_only IS NOT TRUE`,
          [SYSTEM_ACTOR],
        );
        const rows = await this.templateRepo.find({ where: { system_under_test_id: IsNull() } });
        const existing = new Map(rows.map((row) => [templateKey(row), row]));

        let writeFailures = 0;
        for (const group of byKey.values()) {
          if (group.length > 1) {
            // Both would write on every boot, so neither is applied; the key stays declared.
            this.logger.error(
              `${group.map((g) => label(g.index)).join(', ')} declare the same template — all skipped`,
            );
            result.errors += group.length;
            continue;
          }
          const [{ index, values }] = group as [{ index: number; values: TemplateColumns }];
          try {
            const row = existing.get(templateKey(values));
            if (!row) {
              await this.templateRepo.insert({
                ...values,
                read_only: true,
                created_by: SYSTEM_ACTOR,
                updated_by: SYSTEM_ACTOR,
              } as unknown as Parameters<typeof this.templateRepo.insert>[0]);
              result.created++;
            } else if (!row.read_only) {
              await this.templateRepo.update(row.id, {
                ...values,
                read_only: true,
                updated_by: SYSTEM_ACTOR,
              } as unknown as Parameters<typeof this.templateRepo.update>[1]);
              result.takenOver++;
            } else if (this.templateDiffers(row, values)) {
              await this.templateRepo.update(row.id, {
                ...values,
                updated_by: SYSTEM_ACTOR,
              } as unknown as Parameters<typeof this.templateRepo.update>[1]);
              result.updated++;
            } else {
              result.unchanged++;
            }
          } catch (error) {
            this.logger.error(
              `Failed to provision ${label(index)}`,
              error instanceof Error ? error.message : String(error),
            );
            result.errors++;
            writeFailures++;
          }
        }

        // Either case means the file's keys may not be what the database would store, so a stored
        // template the file still means to keep could read as undeclared. Pruning waits for a clean boot.
        if (unidentified > 0 || writeFailures > 0) {
          this.logger.error(
            `template_ds_compare_configs.yaml: ${unidentified} item(s) could not be identified and ${writeFailures} failed to write, so no provisioned template is pruned this boot`,
          );
        } else {
          if (unresolvedProfiles.size > 0) {
            this.logger.error(
              `template_ds_compare_configs.yaml: profile(s) ${[...unresolvedProfiles].map((n) => `"${n}"`).join(', ')} not found, so no provisioned profile template is pruned this boot`,
            );
          }
          for (const row of rows) {
            if (!row.read_only || declared.has(templateKey(row))) continue;
            if (row.profile_id && unresolvedProfiles.size > 0) continue;
            try {
              await this.templateRepo.delete(row.id);
              this.logger.log(
                `Pruned compare-config template ${row.id} (${row.profile_id ? `profile ${row.profile_id}, ` : ''}dashboard "${row.dashboard_uid ?? '*'}" panel ${row.panel_id ?? row.panel_title}${row.metric_name ? ` metric "${row.metric_name}"` : ''}): no longer in the file`,
              );
              result.pruned++;
            } catch (error) {
              this.logger.error(
                `Failed to prune compare-config template ${row.id}`,
                error instanceof Error ? error.message : String(error),
              );
              result.errors++;
            }
          }
        }
      } finally {
        await runner.query(`SELECT pg_advisory_unlock(${TEMPLATE_LOCK_KEY})`);
      }
    } finally {
      await runner.release();
    }

    this.logger.log(
      `Metric classifications: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ` +
        `${result.takenOver} taken over, ${result.pruned} pruned, ${result.skipped} skipped, ${result.errors} errors`,
    );
    return result;
  }

  /** Whether the file's values differ from the stored row. A NULL and an empty `config_overrides` are the same. */
  private templateDiffers(row: ProvisionedTemplateDsCompareConfig, values: TemplateColumns): boolean {
    return (Object.keys(values) as Array<keyof TemplateColumns>).some((k) =>
      k === 'config_overrides'
        ? !isDeepStrictEqual(row.config_overrides ?? {}, values.config_overrides)
        : (row[k] ?? null) !== (values[k] ?? null),
    );
  }

  private mergeSummary(target: ProvisioningSummary, source: ProvisioningSummary): void {
    target.created += source.created;
    target.updated += source.updated;
    target.skipped += source.skipped;
    target.errors += source.errors;
  }
}
