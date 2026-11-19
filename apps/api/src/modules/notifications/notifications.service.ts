import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  HttpException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, TestRun, SystemUnderTest, decrypt, encrypt, getEncryptionKey, isEncrypted } from '@perfana/shared';
import { withRequestEm } from '../../common/db/request-em';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../common/exceptions/business.exception';
import { parseAllowedHosts, validateWebhookUrl } from '../../common/security';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { Capability } from '../../constants/capabilities.constants';
import { CreateNotificationChannelDto, UpdateNotificationChannelDto } from './dto';
import { MattermostMessageBuilder, SlackMessageBuilder, TeamsMessageBuilder } from './message-builders';
import { MASKED_WEBHOOK_URL } from './notifications.constants';
import { checkWebhookTarget, postJsonGuarded } from './webhook-target-guard';

/**
 * Service responsible for managing notification channels.
 *
 * Authorization (same shape as graph presets, see apps/api/CLAUDE.md):
 * - Every route resolves the caller's organizations once with `withOrgFilter`
 *   (`null` = global admin). A channel outside them answers 404, never 403, so a
 *   caller cannot learn that another tenant's channel id exists.
 * - Create, update, delete and the test send need `sut:manage` in the channel's
 *   organization (org admins and members, not viewers). The test send counts as a
 *   write because it posts into the channel.
 * - Create authorizes the caller-supplied system before inheriting its organization.
 * - The webhook URL is a bearer credential. It is never returned (`MASKED_WEBHOOK_URL`)
 *   and is encrypted at rest by the entity's column transformer.
 *
 * Mattermost is self-hosted, so its URL may name any host. The URL must be a Mattermost
 * hook (`/hooks/<key>`), and the address the host resolves to must be public unless the
 * operator listed the host in `NOTIFICATION_WEBHOOK_ALLOWED_HOSTS`. That is checked on
 * save (for immediate feedback) and again at connect time on every send
 * (`webhook-target-guard.ts`), which is the check that counts.
 *
 * There is no RLS backstop on a default deploy (`DB_ENABLE_RLS_ROLE` defaults to false),
 * so these checks are the whole protection.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly perfanaUrl: string;
  private readonly slackBuilder: SlackMessageBuilder;
  private readonly teamsBuilder: TeamsMessageBuilder;
  private readonly mattermostBuilder: MattermostMessageBuilder;
  /** Operator allowlist for self-hosted webhook hosts; never settable by a tenant. */
  private readonly allowedHosts: string[];

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly notificationChannelRepository: Repository<NotificationChannel>,
    @InjectRepository(SystemUnderTest)
    private readonly systemUnderTestRepository: Repository<SystemUnderTest>,
    private readonly configService: ConfigService,
    private readonly proxyResolver: ProxyResolverService,
    private readonly authzService: AuthorizationService,
  ) {
    // Get Perfana URL for deeplinks, fallback to localhost
    this.perfanaUrl = this.configService.get<string>('PERFANA_URL')
      || this.configService.get<string>('NEXT_PUBLIC_APP_URL')
      || 'http://localhost:4001';

    this.slackBuilder = new SlackMessageBuilder(this.perfanaUrl);
    this.teamsBuilder = new TeamsMessageBuilder(this.perfanaUrl);
    this.mattermostBuilder = new MattermostMessageBuilder(this.perfanaUrl);
    this.allowedHosts = parseAllowedHosts(
      this.configService.get<string>('NOTIFICATION_WEBHOOK_ALLOWED_HOSTS'),
    );
  }

  /**
   * Validate a webhook URL for its channel type, as a 400 the user can act on.
   * For a Mattermost channel sent directly, also resolve the host now, so a private
   * address is reported on save rather than at the first test run. Through a proxy the
   * proxy resolves and decides, so the address is not checked here.
   */
  private async assertValidTarget(
    type: NotificationChannel['type'],
    webhookUrl: string,
    useProxy: boolean,
  ): Promise<void> {
    const urlValidation = validateWebhookUrl(webhookUrl, type, { allowedHosts: this.allowedHosts });
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid webhook URL: ${urlValidation.error}`);
    }
    if (type === 'mattermost' && !useProxy) {
      const target = await checkWebhookTarget(urlValidation.url!.hostname, this.allowedHosts);
      if (!target.ok) {
        throw new BadRequestException(`Invalid webhook URL: ${target.error}`);
      }
    }
  }

  /**
   * Encrypt webhook URLs stored before the column was encrypted. The entity's transformer
   * only encrypts on save, so a channel nobody edits would otherwise keep its bearer URL in
   * plaintext in the database, backups and SUT exports.
   *
   * Reads and writes raw SQL: the transformer decrypts on load, so a loaded entity cannot
   * tell a plaintext row from an encrypted one. Each UPDATE is conditional on the value it
   * read, so concurrent replicas and a user save in between never clobber each other.
   * Never fails the boot: without ENCRYPTION_KEY it skips, and any error is logged.
   */
  async onApplicationBootstrap(): Promise<void> {
    const keyProblem = NotificationsService.encryptionKeyProblem();
    if (keyProblem) {
      this.logger.warn(`Existing notification webhook URLs stay unencrypted: ${keyProblem}`);
      return;
    }
    try {
      // No request context at boot, so no request EntityManager exists to use. One
      // statement returns the channels ('c') and a sample of every other column encrypted
      // with ENCRYPTION_KEY ('k'), which is what the key check below reads.
      // eslint-disable-next-line owned-resource-must-use-request-em
      const all: Array<{ src: 'c' | 'k'; id: string | null; v: string }> = await this.notificationChannelRepository.query(
        `SELECT 'c' AS src, id::text AS id, webhook_url AS v FROM notification_channels WHERE webhook_url <> ''
         UNION ALL
         SELECT 'k', NULL, v FROM (
           SELECT api_key AS v FROM grafana_instances UNION ALL SELECT password FROM grafana_instances
           UNION ALL SELECT api_token FROM dynatrace_configs UNION ALL SELECT platform_api_token FROM dynatrace_configs
           UNION ALL SELECT api_token FROM splunk_configs UNION ALL SELECT password FROM splunk_configs
           UNION ALL SELECT username FROM proxy_servers UNION ALL SELECT password FROM proxy_servers
         ) k WHERE v IS NOT NULL AND v <> '' LIMIT 1000`,
      );
      const rows = all.filter((r) => r.src === 'c');
      const plaintext = rows.filter((r) => !isEncrypted(r.v));

      // Prove the key is the one the existing ciphertext was written with before
      // overwriting anything: encrypting under a wrong key destroys the only readable
      // copy of each URL. AES-GCM authenticates, so one value that decrypts proves the key;
      // trying every sample keeps one corrupt row or a half-finished rotation from
      // blocking the pass. With nothing encrypted anywhere there is nothing to prove the
      // key against, so the rows are left for a user save rather than risked in bulk.
      if (plaintext.length > 0) {
        const samples = all.filter((r) => isEncrypted(r.v));
        if (samples.length === 0) {
          this.logger.warn(
            `Not encrypting ${plaintext.length} plaintext notification webhook URL(s): no encrypted credential exists yet to verify ENCRYPTION_KEY against. They are encrypted when next saved.`,
          );
          return;
        }
        const readable = samples.some((r) => {
          try {
            decrypt(r.v);
            return true;
          } catch {
            return false;
          }
        });
        if (!readable) {
          this.logger.error(
            `Not encrypting ${plaintext.length} plaintext notification webhook URL(s): ENCRYPTION_KEY decrypts none of the ${samples.length} stored credential(s), so it is not the key they were saved with`,
          );
          return;
        }
      }

      let encrypted = 0;
      for (const row of plaintext) {
        // eslint-disable-next-line owned-resource-must-use-request-em
        const result = await this.notificationChannelRepository.query(
          `UPDATE notification_channels SET webhook_url = $1 WHERE id = $2 AND webhook_url = $3`,
          [encrypt(row.v), row.id, row.v],
        );
        // UPDATE answers [rows, rowCount]; 0 when another replica or a save got there first.
        encrypted += Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
      }
      // Logged every boot, so a pass that saw nothing (e.g. a login role without RLS
      // bypass on this FORCE RLS table) is visible rather than silent.
      this.logger.log(
        `Notification webhook URLs: scanned ${rows.length}, encrypted ${encrypted} of ${plaintext.length} plaintext`,
      );
    } catch (error) {
      const msg = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Could not encrypt existing notification webhook URLs: ${msg}`);
    }
  }

  // ============================================
  // Authorization helpers
  // ============================================

  private resolveOrgFilter(userId: string, roles: string[]): Promise<string[] | null> {
    return withOrgFilter(userId, roles, this.authzService);
  }

  private static inOrgs(organizationId: string | null | undefined, orgIds: string[] | null): boolean {
    if (orgIds === null) return true;
    return !!organizationId && orgIds.includes(organizationId);
  }

  /** Whether the caller may create, change, delete or test-send channels in that organization. */
  private async canManage(
    userId: string,
    roles: string[],
    organizationId: string,
    teamId?: string | null,
  ): Promise<boolean> {
    // An API key is already confined to its own organization by the org filter above;
    // it carries no role, so it passes the capability check as it does elsewhere.
    if (userId.startsWith('api-key:')) return true;
    const caps = await this.authzService.getCapabilities(userId, roles, organizationId, teamId ?? null);
    return caps.includes(Capability.SutManage);
  }

  private async assertCanManage(
    userId: string,
    roles: string[],
    organizationId: string,
    teamId?: string | null,
  ): Promise<void> {
    if (await this.canManage(userId, roles, organizationId, teamId)) return;
    this.logger.warn(
      `Write denied: capability=${Capability.SutManage} userId=${userId} orgId=${organizationId}`,
    );
    throw new ForbiddenException('You do not have permission to manage notification channels for this system');
  }

  /**
   * Load a channel the caller may see. Returns the stored entity, webhook URL included,
   * so it must not be returned to a client as-is; use `toResponse`.
   */
  private async loadAccessible(id: string, userId: string, roles: string[]): Promise<NotificationChannel> {
    const orgIds = await this.resolveOrgFilter(userId, roles);
    const channel = await withRequestEm(this.notificationChannelRepository).findOne({
      where: { id },
    });
    if (!channel || !NotificationsService.inOrgs(channel.organizationId, orgIds)) {
      if (channel) {
        this.logger.warn(`Read denied: notification channel ${id} is outside the orgs of userId=${userId}`);
      }
      throw new ResourceNotFoundException('Notification channel', id);
    }
    return channel;
  }

  /** A copy safe to return to a client: the webhook URL is replaced by a placeholder. */
  private toResponse(channel: NotificationChannel): NotificationChannel {
    return { ...channel, webhookUrl: channel.webhookUrl ? MASKED_WEBHOOK_URL : '' };
  }

  /**
   * Saving a webhook URL encrypts it, and the transformer throws without a key. Without
   * this the caller gets a generic 500 and the cause reaches only the log.
   */
  private static assertEncryptionConfigured(): void {
    const problem = NotificationsService.encryptionKeyProblem();
    if (problem) {
      // Fixed text for the caller: the detail (length, format) describes server config and
      // goes to the boot log, not to tenant users.
      throw new ServiceUnavailableException(
        'Notification channels cannot be saved: ENCRYPTION_KEY is missing or invalid on the API',
      );
    }
  }

  /** Why ENCRYPTION_KEY is unusable (missing or malformed), or null. Never includes the key. */
  private static encryptionKeyProblem(): string | null {
    try {
      getEncryptionKey();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'ENCRYPTION_KEY is invalid';
    }
  }

  private static rethrowHttp(error: unknown): void {
    if (error instanceof HttpException) throw error;
  }

  // ============================================
  // CRUD
  // ============================================

  /**
   * Find all notification channels for a system the caller may see.
   * A system in another organization reads as having no channels.
   */
  async findBySystemId(
    systemId: string,
    userId: string,
    roles: string[],
  ): Promise<NotificationChannel[]> {
    try {
      this.logger.debug(`findBySystemId: systemId=${systemId}, userId=${userId}`);

      const orgIds = await this.resolveOrgFilter(userId, roles);
      // `In([])` renders `IN ()`, a syntax error rather than an empty result.
      if (orgIds !== null && orgIds.length === 0) return [];

      const channels = await withRequestEm(this.notificationChannelRepository).find({
        where: {
          systemUnderTestId: systemId,
          ...(orgIds !== null ? { organizationId: In(orgIds) } : {}),
        },
        order: { createdAt: 'DESC' },
      });
      return channels.map((c) => this.toResponse(c));
    } catch (error) {
      NotificationsService.rethrowHttp(error);
      this.logger.error('Failed to find notification channels:', error);
      throw new DatabaseException('Failed to retrieve notification channels', error);
    }
  }

  /** Find a single notification channel by ID. 404 when it is outside the caller's organizations. */
  async findOne(
    id: string,
    userId: string,
    roles: string[],
  ): Promise<NotificationChannel> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}`);
      return this.toResponse(await this.loadAccessible(id, userId, roles));
    } catch (error) {
      NotificationsService.rethrowHttp(error);
      this.logger.error('Failed to find notification channel:', error);
      throw new DatabaseException('Failed to retrieve notification channel', error);
    }
  }

  /**
   * Create a new notification channel. The system must be one the caller may see, and
   * the caller needs `sut:manage` in its organization; the channel inherits both its
   * organization and team.
   */
  async create(
    dto: CreateNotificationChannelDto,
    userId: string,
    roles: string[],
  ): Promise<NotificationChannel> {
    try {
      this.logger.debug(`create: userId=${userId}`);

      // Authorize the caller-supplied system BEFORE inheriting its organization:
      // otherwise naming another tenant's system id writes a channel into it.
      const orgIds = await this.resolveOrgFilter(userId, roles);
      const system = await withRequestEm(this.systemUnderTestRepository).findOne({
        where: { id: dto.systemUnderTestId },
      });
      if (!system || !NotificationsService.inOrgs(system.organization_id, orgIds)) {
        // Same message either way, so the response does not confirm the system exists.
        throw new BadRequestException(`System under test not found: ${dto.systemUnderTestId}`);
      }
      await this.assertCanManage(userId, roles, system.organization_id, system.team_id);

      // Validate webhook URL to prevent SSRF attacks
      await this.assertValidTarget(dto.type, dto.webhookUrl, dto.useProxy ?? false);
      NotificationsService.assertEncryptionConfigured();

      this.logger.log(
        `Creating notification channel "${dto.name}" for system ${dto.systemUnderTestId} by user ${userId}`
      );

      // Inherit org/team from the parent SUT — NotificationChannel.organization_id
      // is NOT NULL and the camelCase property key is required.
      const channel = this.notificationChannelRepository.create({
        systemUnderTestId: dto.systemUnderTestId,
        type: dto.type,
        name: dto.name,
        webhookUrl: dto.webhookUrl,
        notifyOnFinished: dto.notifyOnFinished ?? true,
        notifyOnFailedOnly: dto.notifyOnFailedOnly ?? false,
        enabled: dto.enabled ?? true,
        useProxy: dto.useProxy ?? false,
        createdBy: userId,
        updatedBy: userId,
        organizationId: system.organization_id,
        teamId: system.team_id,
      });

      return this.toResponse(await withRequestEm(this.notificationChannelRepository).save(channel));
    } catch (error) {
      NotificationsService.rethrowHttp(error);
      this.logger.error('Failed to create notification channel:', error);
      throw new DatabaseException('Failed to create notification channel', error);
    }
  }

  /**
   * Update an existing notification channel. A `webhookUrl` equal to
   * `MASKED_WEBHOOK_URL` (what a read returns) keeps the stored URL.
   */
  async update(
    id: string,
    dto: UpdateNotificationChannelDto,
    userId: string,
    roles: string[],
  ): Promise<NotificationChannel> {
    try {
      this.logger.debug(`update: id=${id}, userId=${userId}`);

      const channel = await this.loadAccessible(id, userId, roles);
      await this.assertCanManage(userId, roles, channel.organizationId, channel.teamId);

      // `@IsOptional()` lets an explicit null through, and webhook_url is NOT NULL,
      // so only a real string other than the placeholder replaces the stored URL.
      const newWebhookUrl =
        typeof dto.webhookUrl === 'string' && dto.webhookUrl !== MASKED_WEBHOOK_URL
          ? dto.webhookUrl
          : undefined;

      // Re-validate whenever the type, URL or proxy setting changes: the rules depend
      // on all three, and switching a Slack channel to Mattermost (or back) without
      // touching the URL must not keep a URL the new type would refuse.
      const nextType = dto.type ?? channel.type;
      const nextUrl = newWebhookUrl ?? channel.webhookUrl;
      const nextUseProxy = dto.useProxy ?? channel.useProxy;
      if (
        nextType !== channel.type ||
        newWebhookUrl !== undefined ||
        nextUseProxy !== channel.useProxy
      ) {
        await this.assertValidTarget(nextType, nextUrl, nextUseProxy);
      }
      // Every save needs the key, not only a URL change: TypeORM runs the column
      // transformer on unchanged values too when it diffs the entity, and a row still in
      // plaintext then throws inside encrypt().
      NotificationsService.assertEncryptionConfigured();

      // Update only provided fields
      if (dto.type !== undefined) channel.type = dto.type;
      if (dto.name !== undefined) channel.name = dto.name;
      if (newWebhookUrl !== undefined) channel.webhookUrl = newWebhookUrl;
      if (dto.notifyOnFinished !== undefined) channel.notifyOnFinished = dto.notifyOnFinished;
      if (dto.notifyOnFailedOnly !== undefined) channel.notifyOnFailedOnly = dto.notifyOnFailedOnly;
      if (dto.enabled !== undefined) channel.enabled = dto.enabled;
      if (dto.useProxy !== undefined) channel.useProxy = dto.useProxy;
      channel.updatedBy = userId;

      this.logger.log(`Updating notification channel ${id} by user ${userId}`);

      return this.toResponse(await withRequestEm(this.notificationChannelRepository).save(channel));
    } catch (error) {
      NotificationsService.rethrowHttp(error);
      this.logger.error('Failed to update notification channel:', error);
      throw new DatabaseException('Failed to update notification channel', error);
    }
  }

  /** Delete a notification channel. */
  async delete(
    id: string,
    userId: string,
    roles: string[],
  ): Promise<void> {
    try {
      this.logger.debug(`delete: id=${id}, userId=${userId}`);

      const channel = await this.loadAccessible(id, userId, roles);
      await this.assertCanManage(userId, roles, channel.organizationId, channel.teamId);

      this.logger.log(`Deleting notification channel ${id} by user ${userId}`);

      await withRequestEm(this.notificationChannelRepository).remove(channel);
    } catch (error) {
      NotificationsService.rethrowHttp(error);
      this.logger.error('Failed to delete notification channel:', error);
      throw new DatabaseException('Failed to delete notification channel', error);
    }
  }

  /**
   * Send a test notification to verify the channel configuration. Needs the same
   * permission as editing the channel, because it posts into it.
   */
  async testChannel(
    id: string,
    userId: string,
    roles: string[],
  ): Promise<{ success: boolean; message: string }> {
    this.logger.debug(`testChannel: id=${id}, userId=${userId}`);

    const channel = await this.loadAccessible(id, userId, roles);
    await this.assertCanManage(userId, roles, channel.organizationId, channel.teamId);

    // Get system name for the message
    const system = await withRequestEm(this.systemUnderTestRepository).findOne({
      where: { id: channel.systemUnderTestId },
    });
    const systemName = system?.name || 'Unknown System';

    try {
      let message: unknown;

      switch (channel.type) {
        case 'slack':
          message = this.slackBuilder.buildTestMessage(systemName);
          break;
        case 'teams':
          message = this.teamsBuilder.buildTestMessage(systemName);
          break;
        case 'mattermost':
          message = this.mattermostBuilder.buildTestMessage(systemName);
          break;
        default:
          throw new Error(`Unsupported notification type: ${channel.type}`);
      }

      await this.deliver(channel, message);

      this.logger.log(`Test notification sent successfully to channel ${id} by user ${userId}`);
      return { success: true, message: 'Test notification sent successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send test notification to channel ${id}:`, error);
      return { success: false, message: `Failed to send test notification: ${errorMessage}` };
    }
  }

  /**
   * Send notifications for a completed test run
   * This is the main entry point called from TestRunsMutationService
   *
   * Note: This method does not require authorization parameters as it is called internally
   * by the test runs service after a test run completes. Authorization is handled
   * at the test run level.
   */
  async sendTestRunNotification(testRun: TestRun): Promise<void> {
    try {
      // Find all enabled channels for this system that want test run notifications
      const channels = await withRequestEm(this.notificationChannelRepository).find({
        where: {
          systemUnderTestId: testRun.systemUnderTestId,
          enabled: true,
          notifyOnFinished: true,
        },
      });

      if (channels.length === 0) {
        this.logger.debug(`No notification channels configured for system ${testRun.systemUnderTestId}`);
        return;
      }

      // Get system name for the message
      const system = await withRequestEm(this.systemUnderTestRepository).findOne({
        where: { id: testRun.systemUnderTestId },
      });
      const systemName = system?.name || 'Unknown System';

      // Determine if this is a passed or failed test
      const passed = testRun.consolidatedResult?.overall === true;

      // Send to each channel
      for (const channel of channels) {
        // Skip if channel only wants failed notifications and this test passed
        if (channel.notifyOnFailedOnly && passed) {
          this.logger.debug(
            `Skipping notification to channel ${channel.name} - test passed but channel only wants failures`
          );
          continue;
        }

        try {
          await this.sendToChannel(channel, testRun, systemName);
          this.logger.log(
            `Notification sent to ${channel.type} channel "${channel.name}" for test run ${testRun.testRunId}`
          );
        } catch (error) {
          // Log error but continue to other channels
          this.logger.error(
            `Failed to send notification to channel ${channel.name}:`,
            error
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to send test run notifications:', error);
      // Don't throw - notifications should not block test run completion
    }
  }

  /**
   * Send notification to a specific channel
   */
  private async sendToChannel(
    channel: NotificationChannel,
    testRun: TestRun,
    systemName: string,
  ): Promise<void> {
    let message: unknown;

    switch (channel.type) {
      case 'slack':
        message = this.slackBuilder.buildTestRunResultMessage(testRun, systemName);
        break;
      case 'teams':
        message = this.teamsBuilder.buildTestRunResultMessage(testRun, systemName);
        break;
      case 'mattermost':
        message = this.mattermostBuilder.buildTestRunResultMessage(testRun, systemName);
        break;
      default:
        throw new Error(`Unsupported notification type: ${channel.type}`);
    }

    await this.deliver(channel, message);
  }

  /**
   * Send a built message to a channel.
   *
   * A Mattermost channel is re-validated on every send (the allowlist may have changed
   * since it was saved) and, when sent directly, goes through `postJsonGuarded`, which
   * checks the resolved address at connect time and never follows a redirect. Through a
   * proxy, redirects are refused as well. Slack and Teams are unchanged.
   */
  private async deliver(channel: NotificationChannel, message: unknown): Promise<void> {
    // The column transformer hands back the ciphertext when it cannot decrypt (a missing or
    // changed ENCRYPTION_KEY, or a SUT import from an environment with another key). Posting
    // to it would fail as "Invalid URL" with the real cause logged only at debug. Checked
    // here because every send path, Mattermost's guarded one included, goes through deliver.
    if (isEncrypted(channel.webhookUrl)) {
      throw new Error(
        'Webhook URL could not be decrypted: ENCRYPTION_KEY is missing or differs from the one it was saved with. Restore the key or re-enter the URL.',
      );
    }
    const agents = await this.proxyResolver.resolve(channel.organizationId, channel.useProxy);

    if (channel.type !== 'mattermost') {
      await this.sendWebhook(channel.webhookUrl, message, agents?.dispatcher);
      return;
    }

    const urlValidation = validateWebhookUrl(channel.webhookUrl, 'mattermost', {
      allowedHosts: this.allowedHosts,
    });
    if (!urlValidation.isValid) {
      throw new Error(`Refusing to send: ${urlValidation.error}`);
    }
    if (agents?.dispatcher) {
      await this.sendWebhook(channel.webhookUrl, message, agents.dispatcher, 'error');
    } else {
      await postJsonGuarded(channel.webhookUrl, message, this.allowedHosts);
    }
  }

  /**
   * Send a message to a webhook URL
   */
  private async sendWebhook(
    url: string,
    message: unknown,
    dispatcher?: unknown,
    redirect: RequestRedirect = 'follow',
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      redirect,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit & { dispatcher?: unknown });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Webhook request failed with status ${response.status}: ${errorText}`);
    }
  }
}
