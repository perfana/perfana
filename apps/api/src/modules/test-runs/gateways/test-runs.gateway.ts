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
import { TestRunEvent, TestRunRooms } from '../types/realtime-events.types';
import { AuthenticatedSocket } from '../guards/websocket-auth.guard';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * WebSocket Gateway for Test Run realtime updates
 *
 * Architecture:
 * - Uses Socket.IO with Redis adapter for horizontal scalability
 * - Authenticates connections using dual auth (API Key or Keycloak JWT)
 * - Automatically joins users to appropriate rooms based on their identity
 * - Emits test run events (created, updated, deleted, status changed)
 *
 * Namespaces:
 * - /test-runs - Main namespace for test run updates
 *
 * Rooms:
 * - user:{userId} - User-specific updates
 * - org:{organizationId} - Organization-specific updates
 * - team:{teamId} - Team-specific updates
 * - test-run:{testRunId} - Specific test run updates (opt-in via subscribe)
 * - global - All updates (admin monitoring)
 *
 * Events:
 * - test-run:created - New test run created
 * - test-run:updated - Test run updated
 * - test-run:deleted - Test run deleted
 * - test-run:status-changed - Test run status changed
 *
 * Authentication is handled by WebSocketAuthGuard at the connection level
 */
@WebSocketGateway({
  namespace: '/test-runs',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4001',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class TestRunsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TestRunsGateway.name);
  private redisInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly apiKeysService: ApiKeysService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Initialize the gateway and setup Redis adapter for horizontal scaling
   */
  async afterInit(server: Server) {
    this.logger.log('TestRunsGateway initialized');

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
  }

  /**
   * Setup Redis adapter for Socket.IO
   * Enables horizontal scaling across multiple NestJS instances
   * Uses ioredis for consistency with BullMQ and other Redis operations
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
      // Use this.server instead of the parameter to ensure proper initialization
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
   * Handle new client connections
   * Authentication is already validated by middleware at this point
   */
  async handleConnection(@ConnectedSocket() client: AuthenticatedSocket) {
    this.logger.log(`Client connecting: ${client.id}`);

    // Verify authentication (should already be set by middleware)
    if (!client.userId) {
      this.logger.warn(`Client ${client.id} not authenticated, disconnecting`);
      client.disconnect();
      return;
    }

    // Join user-specific room (always)
    const userRoom = TestRunRooms.user(client.userId);
    await client.join(userRoom);
    this.logger.log(`Client ${client.id} joined room: ${userRoom}`);

    // Join organization rooms — look up DB memberships because Keycloak JWTs
    // don't carry Perfana organization_id/team_id claims.
    const memberOrgIds = await this.lookupMemberOrganizationIds(client.userId);

    for (const organizationId of memberOrgIds) {
      const orgRoom = TestRunRooms.organization(organizationId);
      await client.join(orgRoom);
      this.logger.debug(`Client ${client.id} joined room: ${orgRoom}`);
    }

    // Also honour JWT claim if present (e.g. API-key auth paths that do carry it)
    if (client.organizationId && !memberOrgIds.includes(client.organizationId)) {
      const orgRoom = TestRunRooms.organization(client.organizationId);
      await client.join(orgRoom);
      this.logger.debug(`Client ${client.id} joined room (from JWT): ${orgRoom}`);
    }

    // Join team room if available (JWT claim — team memberships are less critical
    // since org room already covers test run updates)
    if (client.teamId) {
      const teamRoom = TestRunRooms.team(client.teamId);
      await client.join(teamRoom);
      this.logger.debug(`Client ${client.id} joined room: ${teamRoom}`);
    }

    // Join global room if user has admin role
    if (this.isAdmin(client)) {
      const globalRoom = TestRunRooms.global();
      await client.join(globalRoom);
      this.logger.log(`Client ${client.id} joined room: ${globalRoom} (admin)`);
    }

    // Send connection acknowledgment
    client.emit('connected', {
      message: 'Successfully connected to test-runs updates',
      userId: client.userId,
      authType: client.authType,
      rooms: Array.from(client.rooms),
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
   * Allow clients to subscribe to specific test run updates
   * This is opt-in for detailed monitoring of specific test runs
   */
  @SubscribeMessage('subscribe:test-run')
  async handleSubscribeToTestRun(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { testRunId: string },
  ) {
    if (!data?.testRunId) {
      return { success: false, error: 'testRunId is required' };
    }

    // Verify user has access to this test run's organization
    if (!this.isAdmin(client) && !(await this.mayReadTestRun(client, data.testRunId))) {
      this.logger.warn(
        `Client ${client.id} denied access to test run ${data.testRunId} (not a member of its organization)`,
      );
      return { success: false, error: 'Access denied to this test run' };
    }

    const room = TestRunRooms.testRun(data.testRunId);
    await client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
    return { success: true, room, testRunId: data.testRunId };
  }

  /**
   * Allow clients to unsubscribe from specific test run updates
   */
  @SubscribeMessage('unsubscribe:test-run')
  async handleUnsubscribeFromTestRun(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { testRunId: string },
  ) {
    if (!data?.testRunId) {
      return { success: false, error: 'testRunId is required' };
    }

    const room = TestRunRooms.testRun(data.testRunId);
    await client.leave(room);
    this.logger.log(`Client ${client.id} unsubscribed from ${room}`);
    return { success: true, room, testRunId: data.testRunId };
  }

  /**
   * Emit test run event to all relevant clients
   * This is called by the service layer when test runs change
   *
   * @param event - The event to emit
   * @param targetRooms - Optional array of specific rooms to emit to. Empty array means broadcast to all.
   */
  emitTestRunEvent(event: TestRunEvent, targetRooms?: string[]) {
    this.logger.debug(`Emitting event: ${event.eventType}`);

    // Log the testRun object keys before serialization
    if ('testRun' in event) {
      this.logger.debug(`TestRun keys before serialization: ${Object.keys(event.testRun).join(', ')}`);
    }

    // Ensure the event is properly serialized by converting to plain object
    // This prevents Socket.IO from stripping fields during serialization
    const serializedEvent = JSON.parse(JSON.stringify(event));

    // Log the testRun object keys after serialization
    if ('testRun' in serializedEvent) {
      this.logger.debug(`TestRun keys after serialization: ${Object.keys(serializedEvent.testRun).join(', ')}`);
    }

    // Unresolved targeting is a failure, never a broadcast: this gateway serves
    // every tenant on one namespace, so a server-wide emit crosses the
    // organization boundary. Fall back to the event's own ids, then give up.
    const rooms =
      targetRooms && targetRooms.length > 0
        ? targetRooms
        : this.determineTargetRooms(event.userId, event.organizationId, event.teamId);

    if (rooms.length === 0) {
      this.logger.error(
        `Dropping ${event.eventType}: no rooms could be resolved for it. ` +
        'Refusing to broadcast a test run event to every connected client.',
      );
      return;
    }

    rooms.forEach((room) => {
      this.server.to(room).emit(event.eventType, serializedEvent);
    });
    this.logger.log(`Event ${event.eventType} emitted to rooms: ${rooms.join(', ')}`);
  }

  /**
   * Emit test run created event
   * Determines target rooms based on user, org, and team information
   */
  emitTestRunCreated(
    event: TestRunEvent,
    userId?: string,
    orgId?: string,
    teamId?: string,
  ) {
    const rooms = this.determineTargetRooms(userId, orgId, teamId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Emit test run updated event
   */
  emitTestRunUpdated(
    event: TestRunEvent,
    userId?: string,
    orgId?: string,
    teamId?: string,
  ) {
    const rooms = this.determineTargetRooms(userId, orgId, teamId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Emit test run deleted event
   */
  emitTestRunDeleted(
    event: TestRunEvent,
    userId?: string,
    orgId?: string,
    teamId?: string,
  ) {
    const rooms = this.determineTargetRooms(userId, orgId, teamId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Emit test run status changed event
   */
  emitTestRunStatusChanged(
    event: TestRunEvent,
    userId?: string,
    orgId?: string,
    teamId?: string,
  ) {
    const rooms = this.determineTargetRooms(userId, orgId, teamId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Organization ids this socket's identity is actually a member of.
   *
   * This is the only authority for tenant identity on this gateway. Do NOT key
   * an authorization decision on `client.organizationId`: that is an optional
   * Keycloak custom claim, and handleConnection resolves memberships from
   * `organization_members` precisely because Keycloak JWTs do not carry it. A
   * check gated on an absent claim does not run at all.
   *
   * Returns an empty list on failure, so every caller fails closed.
   */
  private async lookupMemberOrganizationIds(userId: string): Promise<string[]> {
    try {
      const rows = await this.dataSource.query<{ organization_id: string }[]>(
        `SELECT organization_id FROM organization_members WHERE user_id = $1`,
        [userId],
      );
      return rows.map((row) => row.organization_id).filter(Boolean);
    } catch (error) {
      this.logger.error(
        `Failed to resolve organization membership for ${userId}: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Whether this socket may observe a specific test run.
   *
   * Fails closed on every uncertainty: an unknown test run, a run whose
   * organization_id is NULL, a caller with no membership rows, and any error in
   * either lookup all deny. Admins are handled by the caller.
   */
  private async mayReadTestRun(
    client: AuthenticatedSocket,
    testRunId: string,
  ): Promise<boolean> {
    if (!client.userId) {
      return false;
    }

    let organizationId: string | null | undefined;
    try {
      const rows = await this.dataSource.query<{ organization_id: string | null }[]>(
        `SELECT organization_id FROM test_runs WHERE id::text = $1 OR test_run_id = $1 LIMIT 1`,
        [testRunId],
      );
      organizationId = rows[0]?.organization_id;
    } catch (error) {
      this.logger.error(
        `Failed to verify test run access: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return false;
    }

    if (!organizationId) {
      return false;
    }

    const memberOrgIds = await this.lookupMemberOrganizationIds(client.userId);
    return memberOrgIds.includes(organizationId);
  }

  /**
   * Determine which rooms should receive the event
   * Strategy: send to the user, org and team rooms that were resolved, plus the
   * global room for admin monitoring. Missing targeting is NOT a broadcast — see
   * emitTestRunEvent.
   */
  private determineTargetRooms(
    userId?: string,
    orgId?: string,
    teamId?: string,
  ): string[] {
    const rooms: string[] = [];

    if (userId) {
      rooms.push(TestRunRooms.user(userId));
    }

    if (orgId) {
      rooms.push(TestRunRooms.organization(orgId));
    }

    if (teamId) {
      rooms.push(TestRunRooms.team(teamId));
    }

    // Global room is admin monitoring only; it is never a stand-in for tenant
    // targeting, and reaching it alone must not widen delivery to everyone.
    rooms.push(TestRunRooms.global());

    if (rooms.length === 1) {
      this.logger.error(
        'Test run event has no user/org/team targeting; delivering to the global (admin) room only. ' +
        'The caller must pass the test run\'s organization.'
      );
    }

    return rooms;
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
        // Store API key roles for proper authorization checks
        socket.roles = apiKey.roles || [];
        this.logger.debug(`WebSocket API Key authentication successful with roles: ${socket.roles.join(', ') || 'none'}`);
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
        socket.userId = (keycloakUser.sub as string) || (keycloakUser.preferred_username as string);
        socket.email = keycloakUser.email as string | undefined;
        const realmAccess = keycloakUser.realm_access as Record<string, unknown> | undefined;
        socket.roles = (keycloakUser.roles as string[]) || (realmAccess?.roles as string[]) || [];

        // Extract organization and team from token if available
        socket.organizationId = keycloakUser.organization_id as string | undefined;
        socket.teamId = keycloakUser.team_id as string | undefined;

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
  private async validateKeycloakToken(token: string): Promise<Record<string, unknown> | null> {
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

      // Validate audience so a token minted for another Keycloak client in the
      // same realm cannot authenticate here. No client id configured means no
      // audience check is possible, so refuse the token rather than skip it.
      const clientId = this.configService.get<string>('KEYCLOAK_CLIENT_ID');
      if (!clientId) {
        this.logger.error(
          'KEYCLOAK_CLIENT_ID is not configured; refusing a WebSocket JWT that cannot be audience-checked',
        );
        return null;
      }

      const { payload } = await jwtVerify(token, JWKS, {
        issuer: acceptedIssuers,
        audience: clientId,
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
    // Check roles regardless of auth type - both API keys and Keycloak JWTs
    // store their roles in socket.roles
    if (socket.roles && socket.roles.length > 0) {
      return socket.roles.includes('perfana-admin') || socket.roles.includes('admin');
    }

    return false;
  }

  /**
   * Get current connection statistics
   * Useful for monitoring and health checks
   */
  getConnectionStats() {
    return {
      totalConnections: this.server.sockets.sockets.size,
      redisEnabled: this.redisInitialized,
      namespace: '/test-runs',
    };
  }
}
