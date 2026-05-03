import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, TestRun, SystemUnderTest } from '@perfana/shared';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../common/exceptions/business.exception';
import { validateWebhookUrl } from '../../common/security';
// NOTE: AuthorizationService will be re-added when Phase 3 adds org filtering to notifications
import { CreateNotificationChannelDto, UpdateNotificationChannelDto } from './dto';
import { SlackMessageBuilder, TeamsMessageBuilder } from './message-builders';

/**
 * Service responsible for managing notification channels.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - Currently NotificationChannel entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to NotificationChannel (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly perfanaUrl: string;
  private readonly slackBuilder: SlackMessageBuilder;
  private readonly teamsBuilder: TeamsMessageBuilder;

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly notificationChannelRepository: Repository<NotificationChannel>,
    @InjectRepository(SystemUnderTest)
    private readonly systemUnderTestRepository: Repository<SystemUnderTest>,
    private readonly configService: ConfigService,
  ) {
    // Get Perfana URL for deeplinks, fallback to localhost
    this.perfanaUrl = this.configService.get<string>('PERFANA_URL')
      || this.configService.get<string>('NEXT_PUBLIC_APP_URL')
      || 'http://localhost:4001';

    this.slackBuilder = new SlackMessageBuilder(this.perfanaUrl);
    this.teamsBuilder = new TeamsMessageBuilder(this.perfanaUrl);
  }

  /**
   * Find all notification channels for a system
   *
   * @param systemId - The system under test ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: NotificationChannel entity does not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async findBySystemId(
    systemId: string,
    userId: string,
    _roles: string[],
  ): Promise<NotificationChannel[]> {
    try {
      this.logger.debug(`findBySystemId: systemId=${systemId}, userId=${userId}`);

      // NOTE: Org filtering will be added here when NotificationChannel entity has organization_id
      // For now, all notification channels for the system are returned (treated as legacy data)

      return await this.notificationChannelRepository.find({
        where: { systemUnderTestId: systemId },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error('Failed to find notification channels:', error);
      throw new DatabaseException('Failed to retrieve notification channels', error);
    }
  }

  /**
   * Find a single notification channel by ID
   *
   * @param id - The notification channel ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: NotificationChannel entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findOne(
    id: string,
    userId: string,
    _roles: string[],
  ): Promise<NotificationChannel> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}`);

      const channel = await this.notificationChannelRepository.findOne({
        where: { id },
      });

      if (!channel) {
        throw new ResourceNotFoundException('Notification channel', id);
      }

      // NOTE: Access permission check will be added here when NotificationChannel entity has organization_id
      // For now, all notification channels are accessible (treated as legacy data)

      return channel;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find notification channel:', error);
      throw new DatabaseException('Failed to retrieve notification channel', error);
    }
  }

  /**
   * Create a new notification channel
   *
   * @param dto - The create notification channel DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: NotificationChannel entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async create(
    dto: CreateNotificationChannelDto,
    userId: string,
    _roles: string[],
  ): Promise<NotificationChannel> {
    try {
      this.logger.debug(`create: userId=${userId}`);

      this.logger.log(
        `Creating notification channel "${dto.name}" for system ${dto.systemUnderTestId} by user ${userId}`
      );

      // NOTE: Permission check will be added here when NotificationChannel entity has organization_id
      // For now, all users can create notification channels (treated as legacy data)

      // Validate webhook URL to prevent SSRF attacks
      const urlValidation = validateWebhookUrl(dto.webhookUrl);
      if (!urlValidation.isValid) {
        throw new BadRequestException(`Invalid webhook URL: ${urlValidation.error}`);
      }

      // Inherit org/team from the parent SUT — NotificationChannel.organization_id
      // is NOT NULL and the camelCase property key is required.
      const system = await this.systemUnderTestRepository.findOne({
        where: { id: dto.systemUnderTestId },
      });
      if (!system) {
        throw new BadRequestException(`System under test not found: ${dto.systemUnderTestId}`);
      }

      const channel = this.notificationChannelRepository.create({
        systemUnderTestId: dto.systemUnderTestId,
        type: dto.type,
        name: dto.name,
        webhookUrl: dto.webhookUrl,
        notifyOnFinished: dto.notifyOnFinished ?? true,
        notifyOnFailedOnly: dto.notifyOnFailedOnly ?? false,
        enabled: dto.enabled ?? true,
        createdBy: userId,
        updatedBy: userId,
        organizationId: system.organization_id,
        teamId: system.team_id,
      });

      return await this.notificationChannelRepository.save(channel);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Failed to create notification channel:', error);
      throw new DatabaseException('Failed to create notification channel', error);
    }
  }

  /**
   * Update an existing notification channel
   *
   * @param id - The notification channel ID
   * @param dto - The update notification channel DTO
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: NotificationChannel entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async update(
    id: string,
    dto: UpdateNotificationChannelDto,
    userId: string,
    roles: string[],
  ): Promise<NotificationChannel> {
    try {
      this.logger.debug(`update: id=${id}, userId=${userId}`);

      const channel = await this.findOne(id, userId, roles);

      // NOTE: Modify permission check will be added here when NotificationChannel entity has organization_id
      // For now, all notification channels are modifiable (treated as legacy data)

      // Validate webhook URL if provided to prevent SSRF attacks
      if (dto.webhookUrl !== undefined) {
        const urlValidation = validateWebhookUrl(dto.webhookUrl);
        if (!urlValidation.isValid) {
          throw new BadRequestException(`Invalid webhook URL: ${urlValidation.error}`);
        }
      }

      // Update only provided fields
      if (dto.type !== undefined) channel.type = dto.type;
      if (dto.name !== undefined) channel.name = dto.name;
      if (dto.webhookUrl !== undefined) channel.webhookUrl = dto.webhookUrl;
      if (dto.notifyOnFinished !== undefined) channel.notifyOnFinished = dto.notifyOnFinished;
      if (dto.notifyOnFailedOnly !== undefined) channel.notifyOnFailedOnly = dto.notifyOnFailedOnly;
      if (dto.enabled !== undefined) channel.enabled = dto.enabled;
      channel.updatedBy = userId;

      this.logger.log(`Updating notification channel ${id} by user ${userId}`);

      return await this.notificationChannelRepository.save(channel);
    } catch (error) {
      if (error instanceof ResourceNotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Failed to update notification channel:', error);
      throw new DatabaseException('Failed to update notification channel', error);
    }
  }

  /**
   * Delete a notification channel
   *
   * @param id - The notification channel ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: NotificationChannel entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async delete(
    id: string,
    userId: string,
    roles: string[],
  ): Promise<void> {
    try {
      this.logger.debug(`delete: id=${id}, userId=${userId}`);

      const channel = await this.findOne(id, userId, roles);

      // NOTE: Delete permission check will be added here when NotificationChannel entity has organization_id
      // For now, all notification channels are deletable (treated as legacy data)

      this.logger.log(`Deleting notification channel ${id} by user ${userId}`);

      await this.notificationChannelRepository.remove(channel);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete notification channel:', error);
      throw new DatabaseException('Failed to delete notification channel', error);
    }
  }

  /**
   * Send a test notification to verify the channel configuration
   *
   * @param id - The notification channel ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   */
  async testChannel(
    id: string,
    userId: string,
    roles: string[],
  ): Promise<{ success: boolean; message: string }> {
    this.logger.debug(`testChannel: id=${id}, userId=${userId}`);

    const channel = await this.findOne(id, userId, roles);

    // Get system name for the message
    const system = await this.systemUnderTestRepository.findOne({
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
        default:
          throw new Error(`Unsupported notification type: ${channel.type}`);
      }

      await this.sendWebhook(channel.webhookUrl, message);

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
      const channels = await this.notificationChannelRepository.find({
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
      const system = await this.systemUnderTestRepository.findOne({
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
      default:
        throw new Error(`Unsupported notification type: ${channel.type}`);
    }

    await this.sendWebhook(channel.webhookUrl, message);
  }

  /**
   * Send a message to a webhook URL
   */
  private async sendWebhook(url: string, message: unknown): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Webhook request failed with status ${response.status}: ${errorText}`);
    }
  }
}
