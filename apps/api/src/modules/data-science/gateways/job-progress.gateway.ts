import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { JobProgress, JobCompletedEvent, JobFailedEvent, JobStuckEvent, JobBlockedInfo } from '@perfana/shared/types';
import { AuthenticatedSocket } from '../../test-runs/guards/websocket-auth.guard';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { JobProgressService } from '../services/job-progress.service';

/**
 * WebSocket Gateway for Job Progress real-time updates
 *
 * Architecture:
 * - Uses Socket.IO with Redis adapter for horizontal scalability
 * - Authenticates connections using dual auth (API Key or Keycloak JWT)
 * - Provides real-time updates on job progress, completion, and failures
 * - Supports room-based subscriptions for filtering by scope
 *
 * Namespace: /job-progress
 *
 * Events emitted:
 * - job:progress - Progress update for a running job
 * - job:completed - Job completed successfully
 * - job:failed - Job failed with error
 * - job:stuck - Job detected as stuck
 * - job:blocked - Attempted job was blocked by another running job
 *
 * Rooms:
 * - job:scope:{systemUnderTestId}:{testEnvironment}:{workload} - Scope-specific updates
 * - job:all - All job updates (admin monitoring)
 *
 * Authentication is handled by WebSocketAuthGuard at the connection level
 */
@WebSocketGateway({
  namespace: '/job-progress',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4001',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class JobProgressGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(JobProgressGateway.name);
  private redisInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly apiKeysService: ApiKeysService,
    private readonly jobProgressService: JobProgressService,
  ) {}

  /**
   * Initialize the gateway and setup Redis adapter for horizontal scaling
   */
  async afterInit(server: Server) {
    this.logger.log('JobProgressGateway initialized');

    // Setup authentication middleware
    server.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = this.extractToken(socket);

        if (!token) {
          this.logger.warn(`WebSocket connection without token: ${socket.id}`);
          return next(new Error('Missing authentication token'));
        }

        // Try authentication
        const authResult = await this.authenticateSocket(socket, token);

        if (!authResult) {
          this.logger.warn(`WebSocket authentication failed for client: ${socket.id}`);
          return next(new Error('Authentication failed'));
        }

        this.logger.debug(`WebSocket authenticated: ${socket.authType} for ${socket.id}`);
        next();
      } catch (error) {
        this.logger.error(`WebSocket auth error: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
        next(new Error('Authentication error'));
      }
    });

    // Setup Redis adapter for multi-instance support
    await this.setupRedisAdapter(server);

    if (this.redisInitialized) {
      this.logger.log('Redis adapter configured - multi-instance support enabled');
    } else {
      this.logger.warn('Running in single-instance mode without Redis');
    }

    // Register event handlers from JobProgressService
    this.registerJobEventHandlers();
  }

  /**
   * Setup Redis adapter for Socket.IO
   * Enables horizontal scaling across multiple NestJS instances
   */
  private async setupRedisAdapter(_server: Server) {
    try {
      // Ensure the server is properly initialized
      if (!this.server || typeof this.server.adapter !== 'function') {
        this.logger.warn('Socket.IO server not fully initialized, skipping Redis adapter setup');
        this.redisInitialized = false;
        return;
      }

      const redisHost = this.configService.get('REDIS_HOST') || 'localhost';
      const redisPort = this.configService.get('REDIS_PORT') || 6379;
      const redisPassword = this.configService.get('REDIS_PASSWORD');

      // Create Redis clients for pub/sub using ioredis
      const pubClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      const subClient = pubClient.duplicate();

      // Create the Redis adapter
      const redisAdapter = createAdapter(pubClient, subClient);

      // Apply Redis adapter to Socket.IO server
      this.server.adapter(redisAdapter);

      this.redisInitialized = true;
      this.logger.log(`Redis adapter connected to ${redisHost}:${redisPort} (using ioredis)`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize Redis adapter: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      this.logger.warn('Socket.IO will work in single-instance mode without Redis');
      this.redisInitialized = false;
    }
  }

  /**
   * Register handlers for job events from JobProgressService
   */
  private registerJobEventHandlers() {
    // Progress updates
    this.jobProgressService.onProgress((progress: JobProgress) => {
      this.logger.log(`📡 Gateway received progress: ${progress.jobId} - ${progress.message}`);
      this.emitJobProgress(progress);
    });

    // Job completion
    this.jobProgressService.onCompleted((event: JobCompletedEvent['payload']) => {
      this.emitJobCompleted(event);
    });

    // Job failure
    this.jobProgressService.onFailed((event: JobFailedEvent['payload']) => {
      this.emitJobFailed(event);
    });

    // Stuck job detection
    this.jobProgressService.onStuck((event: JobStuckEvent['payload']) => {
      this.emitJobStuck(event);
    });

    this.logger.log('Job event handlers registered');
  }

  /**
   * Handle new client connections
   * Authentication is already validated by middleware at this point
   */
  async handleConnection(@ConnectedSocket() client: AuthenticatedSocket) {
    const totalClients = this.server?.sockets?.sockets?.size ?? 0;
    this.logger.log(`🔌 Client connecting: ${client.id} (total: ${totalClients + 1})`);

    // Verify authentication (should already be set by middleware)
    if (!client.userId) {
      this.logger.warn(`Client ${client.id} not authenticated, disconnecting`);
      client.disconnect();
      return;
    }

    // Admin users can join the global room for monitoring all jobs
    if (this.isAdmin(client)) {
      const globalRoom = 'job:all';
      await client.join(globalRoom);
      this.logger.log(`Client ${client.id} joined room: ${globalRoom} (admin)`);
    }

    // Send connection acknowledgment with current active jobs
    const activeJobs = this.jobProgressService.getAllActiveJobs();
    client.emit('connected', {
      message: 'Successfully connected to job-progress updates',
      userId: client.userId,
      authType: client.authType,
      rooms: Array.from(client.rooms),
      activeJobs: activeJobs,
    });

    this.logger.log(
      `Client ${client.id} (user: ${client.userId}, type: ${client.authType}) connected successfully`,
    );
  }

  /**
   * Handle client disconnections
   */
  handleDisconnect(@ConnectedSocket() client: AuthenticatedSocket) {
    this.logger.log(
      `Client disconnected: ${client.id} (user: ${client.userId || 'unknown'})`,
    );
  }

  /**
   * Allow clients to subscribe to specific scope updates
   * Scope is defined by systemUnderTestId:testEnvironment:workload
   */
  @SubscribeMessage('subscribe:scope')
  async handleSubscribeToScope(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { systemUnderTestId: string; testEnvironment: string; workload: string },
  ) {
    this.logger.log(`📥 subscribe:scope request from ${client.id}:`, JSON.stringify(data));

    if (!data?.systemUnderTestId || !data?.testEnvironment || !data?.workload) {
      this.logger.warn(`⚠️ Invalid subscribe:scope request - missing required fields`);
      return { success: false, error: 'systemUnderTestId, testEnvironment, and workload are required' };
    }

    const room = this.getScopeRoom(data.systemUnderTestId, data.testEnvironment, data.workload);
    await client.join(room);
    this.logger.log(`✅ Client ${client.id} subscribed to ${room}`);

    // Get current job for this scope if any
    const activeJob = await this.jobProgressService.getActiveJobForScope(
      data.systemUnderTestId,
      data.testEnvironment,
      data.workload
    );

    return {
      success: true,
      room,
      scope: data,
      activeJob: activeJob || null
    };
  }

  /**
   * Allow clients to unsubscribe from specific scope updates
   */
  @SubscribeMessage('unsubscribe:scope')
  async handleUnsubscribeFromScope(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { systemUnderTestId: string; testEnvironment: string; workload: string },
  ) {
    if (!data?.systemUnderTestId || !data?.testEnvironment || !data?.workload) {
      return { success: false, error: 'systemUnderTestId, testEnvironment, and workload are required' };
    }

    const room = this.getScopeRoom(data.systemUnderTestId, data.testEnvironment, data.workload);
    await client.leave(room);
    this.logger.log(`Client ${client.id} unsubscribed from ${room}`);
    return { success: true, room, scope: data };
  }

  /**
   * Allow clients to query job progress
   */
  @SubscribeMessage('query:job')
  async handleQueryJob(
    @ConnectedSocket() _client: AuthenticatedSocket,
    @MessageBody() data: { jobId: string },
  ) {
    if (!data?.jobId) {
      return { success: false, error: 'jobId is required' };
    }

    const progress = await this.jobProgressService.getJobProgress(data.jobId);
    return {
      success: true,
      jobId: data.jobId,
      progress: progress || null
    };
  }

  /**
   * Emit job progress update
   */
  private emitJobProgress(progress: JobProgress) {
    const scopeRoom = this.getScopeRoom(
      progress.systemUnderTestId,
      progress.testEnvironment,
      progress.workload
    );

    // Log connected clients for debugging
    const connectedClients = this.server?.sockets?.sockets?.size ?? 0;
    this.logger.log(`📤 Emitting job:progress to room ${scopeRoom} (${connectedClients} total connected clients)`);

    // Emit to scope-specific room
    this.server.to(scopeRoom).emit('job:progress', progress);

    // Emit to global room (admins)
    this.server.to('job:all').emit('job:progress', progress);

    this.logger.log(`✅ Emitted job:progress for ${progress.jobId} to ${scopeRoom} and job:all`);
  }

  /**
   * Emit job completed event
   */
  private emitJobCompleted(event: JobCompletedEvent['payload']) {
    const scopeRoom = this.getScopeRoom(
      event.systemUnderTestId,
      event.testEnvironment,
      event.workload
    );

    this.server.to(scopeRoom).emit('job:completed', event);
    this.server.to('job:all').emit('job:completed', event);

    this.logger.log(`Emitted job:completed for ${event.jobId} to ${scopeRoom}`);
  }

  /**
   * Emit job failed event
   */
  private emitJobFailed(event: JobFailedEvent['payload']) {
    const scopeRoom = this.getScopeRoom(
      event.systemUnderTestId,
      event.testEnvironment,
      event.workload
    );

    this.server.to(scopeRoom).emit('job:failed', event);
    this.server.to('job:all').emit('job:failed', event);

    this.logger.warn(`Emitted job:failed for ${event.jobId} to ${scopeRoom}: ${event.error}`);
  }

  /**
   * Emit stuck job detection event
   */
  private emitJobStuck(event: JobStuckEvent['payload']) {
    const scopeRoom = this.getScopeRoom(
      event.systemUnderTestId,
      event.testEnvironment,
      event.workload
    );

    this.server.to(scopeRoom).emit('job:stuck', event);
    this.server.to('job:all').emit('job:stuck', event);

    this.logger.warn(`Emitted job:stuck for ${event.jobId} to ${scopeRoom}`);
  }

  /**
   * Emit job blocked event (when job submission is rejected)
   */
  emitJobBlocked(
    blockedInfo: JobBlockedInfo,
    requestedTestRunId: string,
    requestedJobType: string
  ) {
    // Extract scope from the blocked info
    if (blockedInfo.existingJobProgress) {
      const progress = blockedInfo.existingJobProgress;
      const scopeRoom = this.getScopeRoom(
        progress.systemUnderTestId,
        progress.testEnvironment,
        progress.workload
      );

      const payload = {
        ...blockedInfo,
        requestedTestRunId,
        requestedJobType,
      };

      this.server.to(scopeRoom).emit('job:blocked', payload);
      this.server.to('job:all').emit('job:blocked', payload);

      this.logger.log(`Emitted job:blocked for ${requestedTestRunId} to ${scopeRoom}`);
    }
  }

  /**
   * Helper to generate scope room name
   */
  private getScopeRoom(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): string {
    return `job:scope:${systemUnderTestId}:${testEnvironment}:${workload}`;
  }

  /**
   * Extract token from WebSocket handshake
   */
  private extractToken(socket: AuthenticatedSocket): string | null {
    // Method 1: Auth object (preferred for Socket.IO v4+)
    const auth = socket.handshake.auth?.token;
    if (auth) {
      return auth;
    }

    // Method 2: Query parameters (fallback)
    const queryToken = socket.handshake.query?.token as string;
    if (queryToken) {
      return queryToken;
    }

    // Method 3: Authorization header (for HTTP long-polling)
    const headerAuth = socket.handshake.headers?.authorization;
    if (headerAuth && typeof headerAuth === 'string') {
      const [type, token] = headerAuth.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }

  /**
   * Authenticate socket connection
   */
  private async authenticateSocket(
    socket: AuthenticatedSocket,
    token: string,
  ): Promise<boolean> {
    // 1. Try API Key authentication (highest priority)
    try {
      const apiKey = await this.apiKeysService.validateApiKey(token);
      if (apiKey) {
        socket.authType = 'api-key';
        socket.userId = `api-key:${apiKey.id}`;
        // Store API key roles for authorization checks
        socket.roles = apiKey.roles || [];
        this.logger.debug(`WebSocket API Key authentication successful for key: ${apiKey.id}`);
        return true;
      }
    } catch (error) {
      this.logger.debug(
        `WebSocket API Key authentication failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }

    // 2. Try Keycloak JWT authentication
    try {
      const keycloakUser = await this.validateKeycloakToken(token);
      if (keycloakUser) {
        socket.authType = 'keycloak-jwt';
        socket.userId = keycloakUser.sub || keycloakUser.preferred_username;
        socket.email = keycloakUser.email;
        socket.roles = keycloakUser.roles || keycloakUser.realm_access?.roles || [];

        // Extract organization and team from token if available
        socket.organizationId = keycloakUser.organization_id;
        socket.teamId = keycloakUser.team_id;

        this.logger.debug(
          `WebSocket Keycloak JWT authentication successful for user: ${socket.userId}`,
        );
        return true;
      }
    } catch (error) {
      this.logger.debug(
        `WebSocket Keycloak JWT authentication failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }

    return false;
  }

  /**
   * Validate Keycloak JWT token
   */
  private async validateKeycloakToken(token: string): Promise<any | null> {
    try {
      const keycloakUrl = this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
      const realm = this.configService.get('KEYCLOAK_REALM') || 'perfana-prod';
      const jwksUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));

      // Support multiple issuers for Docker container vs localhost access
      const acceptedIssuersEnv = this.configService.get('KEYCLOAK_ACCEPTED_ISSUERS');
      let acceptedIssuers: string[];

      if (acceptedIssuersEnv) {
        acceptedIssuers = acceptedIssuersEnv.split(',').map((iss: string) => iss.trim());
      } else {
        acceptedIssuers = [
          `${keycloakUrl}/realms/${realm}`,
          `http://localhost:8080/realms/${realm}`,
        ];
      }

      // Match REST auth guard: validate issuer + signature only, skip audience
      // (Keycloak tokens may have frontend client as audience, not 'perfana-api')
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: acceptedIssuers,
        clockTolerance: 60,
      });

      return payload;
    } catch (error) {
      this.logger.debug(
        `Keycloak JWT validation failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Check if socket user has admin privileges
   * Mirrors the logic from KeycloakEnhancedAuthGuard.isAdmin
   */
  private isAdmin(socket: AuthenticatedSocket): boolean {
    if (!socket.roles) {
      return false;
    }

    // Check for admin role regardless of auth type (api-key or keycloak-jwt)
    return socket.roles.includes('perfana-admin') || socket.roles.includes('admin');
  }

  /**
   * Get current connection statistics
   * Useful for monitoring and health checks
   */
  getConnectionStats() {
    return {
      totalConnections: this.server?.sockets?.sockets?.size ?? 0,
      redisEnabled: this.redisInitialized,
      namespace: '/job-progress',
    };
  }
}
