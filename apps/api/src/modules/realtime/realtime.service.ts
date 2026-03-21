import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { TestRunRepository } from '../../repositories/test-run.repository';
import { TestRun } from '@perfana/shared/entities';
import { RealtimePublisherService } from '@perfana/shared/realtime';
import { TestRunsMutationService } from '../test-runs/services/test-runs-mutation.service';
import { TestRunsQueryService } from '../test-runs/services/test-runs-query.service';
import { TestRunsGateway } from '../test-runs/gateways/test-runs.gateway';
import { TestRunEventType } from '../test-runs/types/realtime-events.types';
import { NotificationsService } from '../notifications/notifications.service';

type DatabaseEvent = TestRun | { testRunId: string };

interface TestRunFilters {
  testEnvironment?: string;
  workload?: string;
  systemUnderTestId?: string;
  completed?: boolean;
  [key: string]: unknown;
}

// TestRun with computed fields for real-time broadcasting
interface TestRunWithComputedFields extends ReturnType<TestRunsMutationService['mapEntityToTestRun']> {
  is_changepoint: boolean;
  is_control_group: boolean;
}

@Injectable()
export class RealtimeService extends RealtimePublisherService {
  private readonly apiLogger = new Logger(RealtimeService.name);
  private server!: Server;
  private subscriberRedis!: Redis;

  // Track test runs that have already had notifications sent
  private notificationsSent = new Set<string>();

  constructor(
    configService: ConfigService,
    private testRunRepository: TestRunRepository,
    private testRunsMutationService: TestRunsMutationService,
    private testRunsQueryService: TestRunsQueryService,
    @Inject(forwardRef(() => TestRunsGateway))
    private testRunsGateway: TestRunsGateway,
    private notificationsService: NotificationsService,
  ) {
    const redisUrl = configService.get<string>('REDIS_URL', 'redis://localhost:6380');
    const redisPassword = configService.get<string>('REDIS_PASSWORD', 'redis_dev_password');

    // Initialize parent publisher service
    super(redisUrl, redisPassword);

    // Initialize subscriber connection
    this.initializeSubscriber(redisUrl, redisPassword);
  }

  private initializeSubscriber(redisUrl: string, redisPassword?: string) {
    this.subscriberRedis = new Redis(redisUrl, {
      password: redisPassword,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });

    this.subscriberRedis.on('connect', () => {
      this.apiLogger.log('Connected to Redis for subscribing');
    });

    this.subscriberRedis.on('error', (error) => {
      this.apiLogger.error('Redis subscriber error:', error);
    });

    // Set up Redis subscriptions for database events
    this.setupRedisSubscriptions();
  }

  setServer(server: Server) {
    this.server = server;
    this.apiLogger.log('Socket.IO server set for realtime service');
  }

  private setupRedisSubscriptions() {
    // Subscribe to database change events
    this.subscriberRedis.subscribe('test_run:created', 'test_run:updated', 'test_run:deleted');

    this.subscriberRedis.on('message', (channel, message) => {
      try {
        const data = JSON.parse(message);
        this.handleDatabaseEvent(channel, data);
      } catch (error) {
        this.apiLogger.error(`Failed to process Redis message on ${channel}:`, error);
      }
    });
  }

  private isTestRun(data: DatabaseEvent): data is TestRun {
    return 'id' in data && 'systemUnderTestId' in data;
  }

  private handleDatabaseEvent(channel: string, data: DatabaseEvent) {
    switch (channel) {
      case 'test_run:created':
        if (this.isTestRun(data)) {
          this.broadcastTestRunCreated(data);
        }
        break;
      case 'test_run:updated':
        if (this.isTestRun(data)) {
          this.broadcastTestRunUpdated(data);
        }
        break;
      case 'test_run:deleted':
        if ('testRunId' in data && typeof data.testRunId === 'string') {
          this.broadcastTestRunDeleted(data.testRunId);
        }
        break;
      default:
        this.apiLogger.warn(`Unknown database event channel: ${channel}`);
    }
  }

  // Test run room management
  getTestRunsRoom(filters?: TestRunFilters): string {
    if (!filters || Object.keys(filters).length === 0) {
      return 'test_runs:all';
    }

    const filterString = Object.entries(filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(',');

    return `test_runs:${Buffer.from(filterString).toString('base64')}`;
  }

  // Get initial data for subscriptions
  async getInitialTestRuns(filters?: TestRunFilters): Promise<TestRun[]> {
    try {
      return await this.testRunRepository.findAllWithSystem(filters);
    } catch (error) {
      this.apiLogger.error('Failed to get initial test runs:', error);
      return [];
    }
  }

  async getTestRunDetails(testRunId: string): Promise<TestRun | null> {
    try {
      return await this.testRunRepository.findByTestRunId(testRunId);
    } catch (error) {
      this.apiLogger.error(`Failed to get test run details for ${testRunId}:`, error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error');
      return null;
    }
  }

  // Broadcasting methods
  async broadcastTestRunCreated(testRun: TestRun) {
    try {
      // Fetch full test run with relations from database
      const fullTestRun = await this.testRunRepository.findOne({
        where: { id: testRun.id },
        relations: ['systemUnderTest', 'systemUnderTest.team', 'systemUnderTest.pyroscopeInstance'],
      });

      if (!fullTestRun) {
        this.apiLogger.warn(`Test run not found for broadcast: ${testRun.testRunId}`);
        return;
      }

      // Transform to snake_case format with proper field mapping
      const transformedTestRun = this.testRunsMutationService.mapEntityToTestRun(fullTestRun) as TestRunWithComputedFields;

      // Add computed fields for ADAPT icons (reuse existing service methods)
      transformedTestRun.is_changepoint = await this.testRunsQueryService.isTestRunChangepoint(
        fullTestRun.systemUnderTestId,
        fullTestRun.testEnvironment,
        fullTestRun.workload,
        fullTestRun.testRunId
      );

      transformedTestRun.is_control_group = await this.testRunsQueryService.isTestRunInControlGroup(
        fullTestRun.systemUnderTestId,
        fullTestRun.testEnvironment,
        fullTestRun.workload,
        fullTestRun.testRunId
      );

      // Use TestRunsGateway to emit event in the proper format
      const orgId = fullTestRun.systemUnderTest?.team?.organization_id;
      const teamId = fullTestRun.systemUnderTest?.team_id;

      this.apiLogger.debug(
        `Broadcasting test run created to orgId: ${orgId}, teamId: ${teamId}`
      );

      this.testRunsGateway.emitTestRunCreated(
        {
          eventType: TestRunEventType.CREATED,
          timestamp: new Date().toISOString(),
          testRun: transformedTestRun,
          teamId: teamId,
        },
        undefined, // userId
        orgId,
        teamId
      );

      this.apiLogger.debug(
        `Broadcasted test run created: ${testRun.testRunId} ` +
        `(systems_under_test: ${transformedTestRun.systems_under_test ? 'YES' : 'NO'}, ` +
        `is_changepoint: ${transformedTestRun.is_changepoint}, ` +
        `is_control_group: ${transformedTestRun.is_control_group}, ` +
        `status: ${JSON.stringify(transformedTestRun.status)})`
      );
    } catch (error) {
      this.apiLogger.error('Failed to broadcast test run created:', error);
    }
  }

  async broadcastTestRunUpdated(testRun: TestRun) {
    try {
      // Fetch full test run with relations from database
      const fullTestRun = await this.testRunRepository.findOne({
        where: { id: testRun.id },
        relations: ['systemUnderTest', 'systemUnderTest.team', 'systemUnderTest.pyroscopeInstance'],
      });

      if (!fullTestRun) {
        this.apiLogger.warn(`Test run not found for broadcast: ${testRun.testRunId}`);
        return;
      }

      // Check if all analysis is complete and send notifications
      await this.checkAndSendNotification(fullTestRun);

      // Transform to snake_case format with proper field mapping
      const transformedTestRun = this.testRunsMutationService.mapEntityToTestRun(fullTestRun) as TestRunWithComputedFields;

      // Add computed fields for ADAPT icons (reuse existing service methods)
      transformedTestRun.is_changepoint = await this.testRunsQueryService.isTestRunChangepoint(
        fullTestRun.systemUnderTestId,
        fullTestRun.testEnvironment,
        fullTestRun.workload,
        fullTestRun.testRunId
      );

      transformedTestRun.is_control_group = await this.testRunsQueryService.isTestRunInControlGroup(
        fullTestRun.systemUnderTestId,
        fullTestRun.testEnvironment,
        fullTestRun.workload,
        fullTestRun.testRunId
      );

      // Use TestRunsGateway to emit event in the proper format
      const orgId = fullTestRun.systemUnderTest?.team?.organization_id;
      const teamId = fullTestRun.systemUnderTest?.team_id;

      this.apiLogger.debug(
        `Broadcasting test run updated to orgId: ${orgId}, teamId: ${teamId}`
      );

      this.testRunsGateway.emitTestRunUpdated(
        {
          eventType: TestRunEventType.UPDATED,
          timestamp: new Date().toISOString(),
          testRun: transformedTestRun,
          teamId: teamId,
        },
        undefined, // userId
        orgId,
        teamId
      );

      this.apiLogger.debug(
        `Broadcasted test run updated: ${testRun.testRunId} ` +
        `(systems_under_test: ${transformedTestRun.systems_under_test ? 'YES' : 'NO'}, ` +
        `is_changepoint: ${transformedTestRun.is_changepoint}, ` +
        `is_control_group: ${transformedTestRun.is_control_group}, ` +
        `status: ${JSON.stringify(transformedTestRun.status)})`
      );
    } catch (error) {
      this.apiLogger.error('Failed to broadcast test run updated:', error);
    }
  }

  /**
   * Check if all analysis is complete and send notifications
   * Only sends notification once per test run
   */
  private async checkAndSendNotification(testRun: TestRun): Promise<void> {
    try {
      // Check if we've already sent a notification for this test run
      if (this.notificationsSent.has(testRun.id)) {
        return;
      }

      // Check if all analysis is complete
      const status = testRun.status as { evaluatingAdapt?: string; evaluatingChecks?: string } | undefined;
      const isAdaptComplete = status?.evaluatingAdapt === 'COMPLETED';
      const isChecksComplete = status?.evaluatingChecks === 'COMPLETED';
      const isCompleted = testRun.completed === true;

      if (isCompleted && isAdaptComplete && isChecksComplete) {
        // Mark as sent before actually sending to prevent duplicates
        this.notificationsSent.add(testRun.id);

        this.apiLogger.log(`All analysis complete for test run ${testRun.testRunId} - sending notifications`);

        // Send notification (non-blocking)
        this.notificationsService.sendTestRunNotification(testRun).catch(err => {
          this.apiLogger.error(`Failed to send notification for test run ${testRun.testRunId}:`, err);
        });

        // Clean up old entries to prevent memory leaks (keep last 1000)
        if (this.notificationsSent.size > 1000) {
          const iterator = this.notificationsSent.values();
          for (let i = 0; i < 100; i++) {
            const value = iterator.next().value;
            if (value) {
              this.notificationsSent.delete(value);
            }
          }
        }
      }
    } catch (error) {
      this.apiLogger.error(`Error checking/sending notification for test run ${testRun.testRunId}:`, error);
    }
  }

  async broadcastTestRunDeleted(testRunId: string) {
    try {
      // Use TestRunsGateway to emit event in the proper format
      this.testRunsGateway.emitTestRunDeleted(
        {
          eventType: TestRunEventType.DELETED,
          timestamp: new Date().toISOString(),
          testRunId: testRunId,
          id: '', // ID not available in Redis event
        },
        undefined, // userId
        undefined, // orgId
        undefined  // teamId
      );

      this.apiLogger.debug(`Broadcasted test run deleted: ${testRunId}`);
    } catch (error) {
      this.apiLogger.error('Failed to broadcast test run deleted:', error);
    }
  }

  // Note: triggerTestRunCreated, triggerTestRunUpdated, triggerTestRunDeleted
  // are inherited from RealtimePublisherService

  // Extended health check with Socket.IO connection count
  async healthCheckWithConnections(): Promise<{ status: string; timestamp: Date; connections: number }> {
    try {
      const healthy = await super.healthCheck();

      if (!healthy) {
        throw new Error('Redis health check failed');
      }

      const connections = this.server ? this.server.sockets.sockets.size : 0;

      return {
        status: 'healthy',
        timestamp: new Date(),
        connections,
      };
    } catch (error) {
      this.apiLogger.error('Realtime service health check failed:', error);
      throw error;
    }
  }

  // Cleanup
  async onModuleDestroy() {
    this.apiLogger.log('Cleaning up realtime service...');

    // Close subscriber connection
    if (this.subscriberRedis) {
      await this.subscriberRedis.quit();
    }

    // Call parent cleanup to close publisher connection
    await super.onModuleDestroy();
  }
}