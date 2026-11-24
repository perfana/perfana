import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OwnedResource } from '@perfana/shared';
import { ConfluenceConfig, GeneratedReport, SystemUnderTest } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { validateExternalUrl } from '../../common/security/url-validator';
import { Capability } from '../../constants/capabilities.constants';
import { AuditService } from '../audit/audit.service';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';
import { ReportGenerationService } from '../reports/services/report-generation.service';
import {
  ConfluenceConnection,
  ConfluenceError,
  ConfluenceRequestOptions,
  confluenceSpace,
  ensurePagePath,
  parsePagePath,
  uploadAttachments,
  upsertPage,
} from './confluence.client';
import { ConfluenceRenderClient } from './confluence-render.client';
import { chartFilename, htmlToStorage } from './storage-format';
import {
  CreateConfluenceConfigDto,
  PublishReportToConfluenceDto,
  TestConfluenceConnectionDto,
  UpdateConfluenceConfigDto,
} from './dto/confluence.dto';

const MASK = '[MASKED]';

export type MaskedConfluenceConfig = Omit<ConfluenceConfig, 'apiToken'> & { apiToken: string };

export interface ConfluencePublication {
  pageId: string;
  url: string;
  publishedAt: Date;
  charts: number;
}

const errMsg = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';

/**
 * Confluence connections (org-owned, integration:confluence:* capabilities) and publishing a
 * generated report to one. Docs: docs/reference/Features/Confluence Publishing.md.
 *
 * Publishing needs test-run:update on the report's run, the same bar as sharing it, because it
 * copies the report out of Perfana; and the connection must belong to the run's organization, so a
 * report can never be published with another tenant's credentials or into another tenant's space.
 */
@Injectable()
export class ConfluenceService {
  private readonly logger = new Logger(ConfluenceService.name);

  constructor(
    @InjectRepository(ConfluenceConfig) private readonly configRepo: Repository<ConfluenceConfig>,
    @InjectRepository(GeneratedReport) private readonly reportRepo: Repository<GeneratedReport>,
    @InjectRepository(SystemUnderTest) private readonly sutRepo: Repository<SystemUnderTest>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly proxyResolver: ProxyResolverService,
    private readonly reports: ReportGenerationService,
    private readonly renderer: ConfluenceRenderClient,
  ) {}

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  async listConfigs(userId: string, roles: string[], organizationId?: string): Promise<MaskedConfluenceConfig[]> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    if (orgIds !== null && orgIds.length === 0) return [];
    const qb = withRequestEm(this.configRepo).createQueryBuilder('c').orderBy('c.label', 'ASC');
    if (orgIds !== null) qb.where('c.organization_id IN (:...orgIds)', { orgIds });
    if (organizationId) qb.andWhere('c.organization_id = :organizationId', { organizationId });
    return (await qb.getMany()).map((c) => this.mask(c));
  }

  async getConfig(id: string, userId: string, roles: string[]): Promise<MaskedConfluenceConfig> {
    return this.mask(await this.loadConfig(id, userId, roles));
  }

  async createConfig(dto: CreateConfluenceConfigDto, userId: string, roles: string[]): Promise<MaskedConfluenceConfig> {
    const organizationId = dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
    if (!organizationId) throw new ForbiddenException('User has no accessible organization');
    await this.requireCapability(userId, roles, organizationId, Capability.IntegrationConfluenceCreate);

    const entity = this.configRepo.create({
      label: dto.label,
      deployment: dto.deployment,
      baseUrl: this.checkBaseUrl(dto.baseUrl, dto.deployment),
      username: dto.username?.trim() || null,
      apiToken: dto.apiToken.trim(),
      spaceKey: dto.spaceKey.trim(),
      parentPageId: dto.parentPageId?.trim() || null,
      useProxy: dto.useProxy ?? false,
      organizationId,
      createdBy: userId,
      updatedBy: userId,
    });
    this.requireCredentials(entity);
    const saved = await withRequestEm(this.configRepo).save(entity);
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return this.mask(saved);
  }

  async updateConfig(id: string, dto: UpdateConfluenceConfigDto, userId: string, roles: string[]): Promise<MaskedConfluenceConfig> {
    const entity = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, entity.organizationId, Capability.IntegrationConfluenceUpdate);
    const before = Object.assign(new ConfluenceConfig(), entity);
    const freshToken = dto.apiToken !== undefined && dto.apiToken !== MASK && dto.apiToken.trim() !== '';

    if (dto.label !== undefined) entity.label = dto.label;
    if (dto.deployment !== undefined) entity.deployment = dto.deployment;
    if (dto.baseUrl !== undefined || dto.deployment !== undefined) {
      const baseUrl = this.checkBaseUrl(dto.baseUrl ?? entity.baseUrl, entity.deployment);
      // Never send a stored token to a host it was not entered for.
      if (baseUrl !== before.baseUrl && !freshToken) {
        throw new BadRequestException('Changing the Confluence URL needs the token entered again');
      }
      entity.baseUrl = baseUrl;
    }
    if (dto.username !== undefined) entity.username = dto.username?.trim() || null;
    if (freshToken) entity.apiToken = dto.apiToken!.trim();
    if (dto.spaceKey !== undefined) entity.spaceKey = dto.spaceKey.trim();
    // null and '' both clear; an absent key leaves the stored value.
    if (dto.parentPageId !== undefined) entity.parentPageId = dto.parentPageId?.trim() || null;
    if (dto.useProxy !== undefined) entity.useProxy = dto.useProxy;
    this.requireCredentials(entity);
    entity.updatedBy = userId;

    const saved = await withRequestEm(this.configRepo).save(entity);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });
    return this.mask(saved);
  }

  /** Pages already published stay in Confluence; reports keep their link to them. */
  async deleteConfig(id: string, userId: string, roles: string[]): Promise<void> {
    const entity = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, entity.organizationId, Capability.IntegrationConfluenceDelete);
    await withRequestEm(this.configRepo).delete({ id });
    this.auditService.logDelete(entity as unknown as OwnedResource, { organizationIdOverride: entity.organizationId });
  }

  async testConnection(dto: TestConfluenceConnectionDto, userId: string, roles: string[]) {
    const organizationId = dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
    if (!organizationId) throw new ForbiddenException('User has no accessible organization');
    await this.requireCapability(userId, roles, organizationId, Capability.IntegrationConfluenceCreate);
    const conn: ConfluenceConnection = {
      baseUrl: this.checkBaseUrl(dto.baseUrl, dto.deployment),
      deployment: dto.deployment,
      username: dto.username?.trim() || null,
      apiToken: dto.apiToken.trim(),
    };
    return this.probe(conn, dto.spaceKey.trim(), await this.requestOptions(organizationId, dto.useProxy ?? false));
  }

  async testSavedConnection(id: string, userId: string, roles: string[]) {
    const config = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, config.organizationId, Capability.IntegrationConfluenceUpdate);
    return this.probe(this.connectionOf(config), config.spaceKey, await this.requestOptions(config.organizationId, config.useProxy));
  }

  // ---------------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------------

  /**
   * Renders the report's charts (perfana-report), converts the HTML to storage format, creates or
   * updates the page and uploads the charts as attachments. Republishing the same report to the
   * same connection updates its page in place, as a new page version.
   *
   * ponytail: synchronous, one request end to end (render + one page call + one upload per 10
   * charts). Fine for ordinary reports; move onto a queue with a status column if large reports
   * start tripping proxy timeouts.
   */
  // audit-skip: generated_reports is DELETE-only audited (GeneratedReport.auditableFields); the publication columns are job bookkeeping like share telemetry, and the publish is logged above
  async publishReport(reportId: string, dto: PublishReportToConfluenceDto, userId: string, roles: string[], appUrl: string): Promise<ConfluencePublication> {
    await this.reports.assertCanChangeSharing(reportId, userId, roles);
    const report = await this.reports.findById(reportId, userId, roles);
    if (!report.html_content) throw new ConflictException('The report has no HTML yet; wait until it has been generated');

    const config = await this.loadConfig(dto.configId, userId, roles);
    if (config.organizationId !== report.test_run?.organizationId) {
      throw new BadRequestException('That Confluence connection belongs to another organization than this report');
    }

    const testRunId = report.test_run?.testRunId ?? report.test_run_id;
    const title = dto.title?.trim() || (report.name.includes(testRunId) ? report.name : `${report.name} (${testRunId})`);
    const rendered = await this.renderer.render(reportId);
    const { storage, chartIndexes } = htmlToStorage(rendered.html);
    const publishedAt = new Date();
    const banner =
      `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Published from Perfana on ${publishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. ` +
      `<a href="${escapeAttr(`${appUrl}/test-runs/${encodeURIComponent(testRunId)}`)}">Open test run ${escapeText(testRunId)} in Perfana</a> for the interactive version.</p></ac:rich-text-body></ac:structured-macro>`;

    const conn = this.connectionOf(config);
    const opts = await this.requestOptions(config.organizationId, config.useProxy);
    const charts = [...new Set(chartIndexes)].filter((i) => rendered.images[i]);
    try {
      const page = await upsertPage(conn, {
        spaceKey: config.spaceKey,
        resolveParentPageId: () => this.parentPageFor(conn, config, report.test_run?.systemUnderTestId, opts),
        existingPageId: report.confluence_config_id === config.id ? report.confluence_page_id : null,
        title,
        storage: banner + storage,
      }, opts);
      // Remember the page before uploading: if the upload fails, a retry updates this page instead
      // of creating a second one, which Confluence refuses because titles are unique per space.
      await withRequestEm(this.reportRepo).update(report.id, {
        confluence_config_id: config.id,
        confluence_page_id: page.id,
        confluence_page_url: page.url,
      });
      await uploadAttachments(conn, page.id, charts.map((i) => ({
        filename: chartFilename(i),
        data: Buffer.from(rendered.images[i]!, 'base64'),
        contentType: 'image/png',
      })), opts);
      await withRequestEm(this.reportRepo).update(report.id, { confluence_published_at: publishedAt });
      this.logger.log(`Published report ${reportId} to Confluence page ${page.id} (${charts.length} chart(s)) via connection ${config.id}`);
      return { pageId: page.id, url: page.url, publishedAt, charts: charts.length };
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Cloud accepts the site URL with or without /wiki; the client adds it. */
  private checkBaseUrl(raw: string, deployment: ConfluenceConfig['deployment']): string {
    const validation = validateExternalUrl(raw.trim());
    if (!validation.isValid) throw new BadRequestException(`Invalid Confluence URL: ${validation.error}`);
    let url = raw.trim().replace(/\/+$/, '');
    if (deployment === 'cloud') url = url.replace(/\/wiki$/i, '');
    return url;
  }

  private requireCredentials(c: ConfluenceConfig): void {
    if (!c.apiToken) throw new BadRequestException('A Confluence connection needs a token');
    if (c.deployment === 'cloud' && !c.username) {
      throw new BadRequestException('Confluence Cloud needs the Atlassian account email with the API token');
    }
  }

  private async probe(conn: ConfluenceConnection, spaceKey: string, opts: ConfluenceRequestOptions) {
    try {
      const space = await confluenceSpace(conn, spaceKey, opts);
      return { success: true, message: `Connected; reports will be published to space "${space.name}"` };
    } catch (err) {
      this.logger.warn(`Confluence connection test to ${new URL(conn.baseUrl).host} failed: ${errMsg(err)}`);
      return { success: false, message: errMsg(err) };
    }
  }

  /**
   * The connection's parent page, or the system's page path below it when the system sets one for
   * this connection; missing levels are created. Only called when a page is created: a report
   * published before keeps its page where it is, and its republish never walks the path.
   */
  private async parentPageFor(conn: ConfluenceConnection, config: ConfluenceConfig, sutId: string | undefined, opts: ConfluenceRequestOptions): Promise<string | null> {
    const sut = sutId ? await withRequestEm(this.sutRepo).findOne({ where: { id: sutId }, select: ['id', 'confluence_parent_pages'] }) : null;
    const titles = parsePagePath(sut?.confluence_parent_pages?.[config.id]);
    if (titles.length === 0) return config.parentPageId ?? null;
    return ensurePagePath(conn, config.spaceKey, config.parentPageId, titles, opts);
  }

  private connectionOf(c: ConfluenceConfig): ConfluenceConnection {
    return { baseUrl: c.baseUrl, deployment: c.deployment, username: c.username, apiToken: c.apiToken };
  }

  private async requestOptions(organizationId: string, useProxy: boolean): Promise<ConfluenceRequestOptions> {
    const agents = await this.proxyResolver.resolve(organizationId, useProxy);
    return agents ? { dispatcher: agents.dispatcher } : {};
  }

  private toHttp(err: unknown): Error {
    if (err instanceof ConfluenceError) {
      this.logger.warn(`Confluence request failed: ${err.message}`);
      return new BadRequestException(`Confluence: ${err.message}`);
    }
    return err as Error;
  }

  private mask(c: ConfluenceConfig): MaskedConfluenceConfig {
    return { ...c, apiToken: c.apiToken ? MASK : '' };
  }

  private async loadConfig(id: string, userId: string, roles: string[]): Promise<ConfluenceConfig> {
    const config = await withRequestEm(this.configRepo).findOne({ where: { id } });
    if (!config) throw new NotFoundException('Confluence connection not found');
    const access = await this.authzService.canAccessResource(userId, roles, {
      organization_id: config.organizationId,
      created_by: '',
    } as OwnedResource);
    if (!access.allowed) throw new NotFoundException('Confluence connection not found');
    return config;
  }

  private async requireCapability(userId: string, roles: string[], organizationId: string, capability: string): Promise<void> {
    const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
    if (!caps.includes(capability as (typeof caps)[number])) {
      throw new ForbiddenException('You do not have permission to manage Confluence connections in this organization');
    }
  }
}

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');
