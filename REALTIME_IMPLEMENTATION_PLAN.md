# Realtime Updates Implementation Plan for Perfana

## Executive Summary

This document provides a comprehensive, step-by-step plan for implementing realtime updates in the Perfana performance analysis platform. The implementation uses Socket.IO with Redis adapter for horizontal scalability, integrating seamlessly with the existing dual authentication system (Keycloak JWT + API Keys).

**Key Technologies:**
- Socket.IO v4.8.1 (already in package.json)
- @nestjs/platform-socket.io v10.4.20 (already in package.json)
- @nestjs/websockets v10.4.20 (already in package.json)
- ioredis v5.8.1 (already in package.json)
- @socket.io/redis-adapter (needs to be added)

**Goal:** When test run records are created, updated, or deleted, all connected frontend clients receive realtime updates automatically.

---

## Table of Contents

1. [Architecture Design](#1-architecture-design)
2. [Backend Implementation](#2-backend-implementation)
3. [Database Integration](#3-database-integration)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [Frontend Integration](#5-frontend-integration)
6. [Testing Strategy](#6-testing-strategy)
7. [Deployment Considerations](#7-deployment-considerations)
8. [Implementation Checklist](#8-implementation-checklist)

---

## 1. Architecture Design

### 1.1 Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend Clients                         │
│  (Next.js with Socket.IO Client + Authentication Headers)       │
└───────────────┬──────────────────┬──────────────────┬───────────┘
                │                  │                  │
                │ WebSocket        │ WebSocket        │ WebSocket
                │ (with JWT/API)   │ (with JWT/API)   │ (with JWT/API)
                │                  │                  │
┌───────────────▼──────────────────▼──────────────────▼───────────┐
│                      NestJS API Instances                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │          Socket.IO Gateway (TestRunsGateway)           │     │
│  │  - Authentication Middleware (JWT/API Key)             │     │
│  │  - Room Management (user-specific, org-specific)       │     │
│  │  - Event Handlers (subscribe/unsubscribe)              │     │
│  └────────────────────────────────────────────────────────┘     │
│  ┌────────────────────────────────────────────────────────┐     │
│  │           TestRunsMutationService                      │     │
│  │  - Create/Update/Delete Test Runs                      │     │
│  │  - Emit realtime events via EventEmitter               │     │
│  └────────────────────────────────────────────────────────┘     │
└───────────────┬──────────────────┬──────────────────┬───────────┘
                │                  │                  │
                │ Pub/Sub          │ Pub/Sub          │ Pub/Sub
                │                  │                  │
┌───────────────▼──────────────────▼──────────────────▼───────────┐
│                    Redis Adapter Layer                           │
│  - Synchronizes events across all NestJS instances              │
│  - Manages distributed room membership                          │
│  - Handles socket.io-redis-adapter pub/sub                      │
└──────────────────────────────────────────────────────────────────┘
                                │
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│                      PostgreSQL Database                          │
│  - Test Runs table (source of truth)                             │
│  - TypeORM entities and repositories                             │
└───────────────────────────────────────────────────────────────────┘
```

### 1.2 Event Flow Diagram

```
Database Change → Service Layer → Event Emission → Gateway → Redis Pub/Sub → All Instances → Frontend Clients

Detailed Flow:

1. Client Action (Create/Update/Delete Test Run)
   ↓
2. REST API Endpoint (TestRunsController)
   ↓
3. Service Layer (TestRunsMutationService)
   ↓
4. Database Operation (TypeORM Repository)
   ↓
5. Event Emission (EventEmitter2 or direct gateway call)
   ↓
6. Gateway Event Handler (TestRunsGateway)
   ↓
7. Socket.IO Server (with Redis Adapter)
   ↓
8. Redis Pub/Sub (distributes to all instances)
   ↓
9. All Connected Clients in Relevant Rooms
   ↓
10. Frontend Updates UI (React state update)
```

### 1.3 Scaling Considerations

**Horizontal Scaling with Redis Adapter:**
- Multiple NestJS instances can run behind a load balancer
- Redis adapter synchronizes Socket.IO events across all instances
- WebSocket connections can be distributed across instances
- Room membership is synchronized via Redis
- No sticky sessions required

**Performance Optimizations:**
- Use Redis for session store and adapter (single Redis instance)
- Implement connection pooling for Redis
- Use namespaces to segment different types of events
- Implement rate limiting for event emissions
- Use Redis pub/sub for efficient broadcasting

**Resource Management:**
- Monitor active WebSocket connections
- Implement connection limits per user
- Graceful shutdown handling for instances
- Health checks for Redis connectivity

---

## 2. Backend Implementation

### 2.1 Package Installation

**Add the Redis Adapter:**
```bash
npm install @socket.io/redis-adapter --workspace=@perfana/api
```

**Already Installed (verify in package.json):**
- socket.io v4.8.1
- @nestjs/platform-socket.io v10.4.20
- @nestjs/websockets v10.4.20
- ioredis v5.8.1

### 2.2 File Structure

Create the following files in `apps/api/src/modules/test-runs/`:

```
apps/api/src/modules/test-runs/
├── gateways/
│   ├── test-runs.gateway.ts          # Main WebSocket gateway
│   ├── test-runs.gateway.spec.ts     # Unit tests for gateway
│   └── ws-auth.adapter.ts            # Custom WebSocket authentication adapter
├── events/
│   ├── test-run.events.ts            # Event type definitions
│   └── test-run-event-emitter.service.ts  # Event emission service
├── services/
│   ├── test-runs-mutation.service.ts # (existing - modify to emit events)
│   └── ... (other existing services)
└── test-runs.module.ts               # (existing - modify to include gateway)
```

### 2.3 Type Definitions (Event Types)

**File: `apps/api/src/modules/test-runs/events/test-run.events.ts`**

```typescript
import { TestRun } from '../test-runs.service';

/**
 * Enum for test run event types
 */
export enum TestRunEventType {
  CREATED = 'test-run:created',
  UPDATED = 'test-run:updated',
  DELETED = 'test-run:deleted',
  STATUS_CHANGED = 'test-run:status-changed',
}

/**
 * Base event payload structure
 */
export interface TestRunEventPayload {
  eventType: TestRunEventType;
  timestamp: string;
  testRun: TestRun;
  userId?: string; // User who triggered the change
}

/**
 * Created event payload
 */
export interface TestRunCreatedEvent extends TestRunEventPayload {
  eventType: TestRunEventType.CREATED;
}

/**
 * Updated event payload
 */
export interface TestRunUpdatedEvent extends TestRunEventPayload {
  eventType: TestRunEventType.UPDATED;
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
}

/**
 * Deleted event payload
 */
export interface TestRunDeletedEvent {
  eventType: TestRunEventType.DELETED;
  timestamp: string;
  testRunId: string;
  id: string; // UUID
  userId?: string;
}

/**
 * Status changed event payload
 */
export interface TestRunStatusChangedEvent extends TestRunEventPayload {
  eventType: TestRunEventType.STATUS_CHANGED;
  oldStatus?: string;
  newStatus: string;
}

/**
 * Union type for all event payloads
 */
export type TestRunEvent =
  | TestRunCreatedEvent
  | TestRunUpdatedEvent
  | TestRunDeletedEvent
  | TestRunStatusChangedEvent;
```

### 2.4 WebSocket Gateway with Authentication

**File: `apps/api/src/modules/test-runs/gateways/test-runs.gateway.ts`**

```typescript
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
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { TestRunEvent, TestRunEventType } from '../events/test-run.events';
import { WsAuthGuard } from './ws-auth.guard';

/**
 * Extended Socket interface with authentication data
 */
interface AuthenticatedSocket extends Socket {
  userId?: string;
  authType?: 'api-key' | 'keycloak-jwt';
  email?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * WebSocket Gateway for Test Run realtime updates
 *
 * Endpoints:
 * - Connection: /test-runs (namespace)
 * - Events: test-run:created, test-run:updated, test-run:deleted
 *
 * Rooms:
 * - user:{userId} - User-specific updates
 * - org:{organizationId} - Organization-specific updates
 * - team:{teamId} - Team-specific updates
 * - global - All updates (admin only)
 */
@WebSocketGateway({
  namespace: '/test-runs',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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

  constructor(private configService: ConfigService) {}

  /**
   * Initialize the gateway and setup Redis adapter
   */
  async afterInit(server: Server) {
    this.logger.log('TestRunsGateway initialized');

    // Setup Redis adapter for horizontal scaling
    await this.setupRedisAdapter(server);

    this.logger.log('Redis adapter configured for multi-instance support');
  }

  /**
   * Setup Redis adapter for Socket.IO
   */
  private async setupRedisAdapter(server: Server) {
    try {
      const redisHost = this.configService.get('REDIS_HOST') || 'localhost';
      const redisPort = this.configService.get('REDIS_PORT') || 6379;
      const redisPassword = this.configService.get('REDIS_PASSWORD');

      const pubClient = createClient({
        socket: {
          host: redisHost,
          port: redisPort,
        },
        password: redisPassword,
      });

      const subClient = pubClient.duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      server.adapter(createAdapter(pubClient, subClient));

      this.redisInitialized = true;
      this.logger.log(`Redis adapter connected to ${redisHost}:${redisPort}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize Redis adapter: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      this.logger.warn('Socket.IO will work in single-instance mode without Redis');
    }
  }

  /**
   * Handle new client connections
   */
  async handleConnection(@ConnectedSocket() client: AuthenticatedSocket) {
    this.logger.log(`Client connecting: ${client.id}`);

    // Authentication is handled by middleware (see ws-auth.adapter.ts)
    // At this point, the socket should have userId and authType set

    if (!client.userId) {
      this.logger.warn(`Client ${client.id} not authenticated, disconnecting`);
      client.disconnect();
      return;
    }

    // Join user-specific room
    await client.join(`user:${client.userId}`);
    this.logger.log(`Client ${client.id} joined room: user:${client.userId}`);

    // Join organization room if available
    if (client.organizationId) {
      await client.join(`org:${client.organizationId}`);
      this.logger.log(`Client ${client.id} joined room: org:${client.organizationId}`);
    }

    // Join team room if available
    if (client.teamId) {
      await client.join(`team:${client.teamId}`);
      this.logger.log(`Client ${client.id} joined room: team:${client.teamId}`);
    }

    // Send connection acknowledgment
    client.emit('connected', {
      message: 'Successfully connected to test-runs updates',
      userId: client.userId,
      rooms: Array.from(client.rooms),
    });

    this.logger.log(
      `Client ${client.id} (user: ${client.userId}) connected successfully`,
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
   */
  @SubscribeMessage('subscribe:test-run')
  async handleSubscribeToTestRun(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { testRunId: string },
  ) {
    const room = `test-run:${data.testRunId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} subscribed to ${room}`);
    return { success: true, room };
  }

  /**
   * Allow clients to unsubscribe from specific test run updates
   */
  @SubscribeMessage('unsubscribe:test-run')
  async handleUnsubscribeFromTestRun(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { testRunId: string },
  ) {
    const room = `test-run:${data.testRunId}`;
    await client.leave(room);
    this.logger.log(`Client ${client.id} unsubscribed from ${room}`);
    return { success: true, room };
  }

  /**
   * Emit test run event to all relevant clients
   * This method is called by the service layer when test runs change
   */
  emitTestRunEvent(event: TestRunEvent, targetRooms?: string[]) {
    this.logger.debug(`Emitting event: ${event.eventType}`);

    if (targetRooms && targetRooms.length > 0) {
      // Emit to specific rooms
      targetRooms.forEach((room) => {
        this.server.to(room).emit(event.eventType, event);
      });
    } else {
      // Emit to all connected clients (use sparingly)
      this.server.emit(event.eventType, event);
    }

    this.logger.log(
      `Event ${event.eventType} emitted to ${targetRooms ? targetRooms.join(', ') : 'all clients'}`,
    );
  }

  /**
   * Emit test run created event
   */
  emitTestRunCreated(event: TestRunEvent, userId?: string, orgId?: string) {
    const rooms = this.determineTargetRooms(userId, orgId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Emit test run updated event
   */
  emitTestRunUpdated(event: TestRunEvent, userId?: string, orgId?: string) {
    const rooms = this.determineTargetRooms(userId, orgId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Emit test run deleted event
   */
  emitTestRunDeleted(event: TestRunEvent, userId?: string, orgId?: string) {
    const rooms = this.determineTargetRooms(userId, orgId);
    this.emitTestRunEvent(event, rooms);
  }

  /**
   * Determine which rooms should receive the event
   */
  private determineTargetRooms(userId?: string, orgId?: string): string[] {
    const rooms: string[] = [];

    if (userId) {
      rooms.push(`user:${userId}`);
    }

    if (orgId) {
      rooms.push(`org:${orgId}`);
    }

    // Always broadcast to the global namespace
    // Clients filter events on their side based on permissions
    if (rooms.length === 0) {
      rooms.push('global');
    }

    return rooms;
  }
}
```

### 2.5 WebSocket Authentication Guard

**File: `apps/api/src/modules/test-runs/gateways/ws-auth.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../../api-keys/api-keys.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  authType?: 'api-key' | 'keycloak-jwt';
  email?: string;
  organizationId?: string;
  teamId?: string;
}

/**
 * WebSocket Authentication Guard
 * Validates JWT or API Key tokens for WebSocket connections
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(
    private configService: ConfigService,
    private apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: AuthenticatedSocket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`WebSocket connection without token: ${client.id}`);
      throw new WsException('Missing authentication token');
    }

    // Try authentication methods
    const authResult = await this.tryAuthentication(token, client);

    if (!authResult.success) {
      this.logger.warn(`WebSocket authentication failed for client: ${client.id}`);
      throw new WsException('Invalid or expired token');
    }

    this.logger.debug(
      `WebSocket authentication successful: ${authResult.authType} for client ${client.id}`,
    );
    return true;
  }

  private extractToken(client: AuthenticatedSocket): string | null {
    // Token can come from:
    // 1. Handshake auth object (preferred)
    // 2. Query parameters (fallback for some clients)
    // 3. Headers (for HTTP long-polling)

    const auth = client.handshake.auth?.token;
    if (auth) {
      return auth;
    }

    const queryToken = client.handshake.query?.token as string;
    if (queryToken) {
      return queryToken;
    }

    const headerAuth = client.handshake.headers?.authorization;
    if (headerAuth && typeof headerAuth === 'string') {
      const [type, token] = headerAuth.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }

  private async tryAuthentication(
    token: string,
    client: AuthenticatedSocket,
  ): Promise<{
    success: boolean;
    authType?: 'api-key' | 'keycloak-jwt';
  }> {
    // 1. Try API Key authentication
    try {
      const isValidApiKey = await this.apiKeysService.validateApiKey(token);
      if (isValidApiKey) {
        client.authType = 'api-key';
        client.userId = 'api-key-user';
        this.logger.debug('WebSocket API Key authentication successful');
        return { success: true, authType: 'api-key' };
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
        client.authType = 'keycloak-jwt';
        client.userId = keycloakUser.sub || keycloakUser.preferred_username;
        client.email = keycloakUser.email;
        // Extract organization and team from token if available
        client.organizationId = keycloakUser.organization_id;
        client.teamId = keycloakUser.team_id;

        this.logger.debug(
          `WebSocket Keycloak JWT authentication successful for user: ${client.userId}`,
        );
        return { success: true, authType: 'keycloak-jwt' };
      }
    } catch (error) {
      this.logger.debug(
        `WebSocket Keycloak JWT authentication failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }

    return { success: false };
  }

  private async validateKeycloakToken(token: string): Promise<any | null> {
    try {
      const keycloakUrl = this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
      const realm = this.configService.get('KEYCLOAK_REALM') || 'perfana-prod';
      const jwksUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));

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

      const { payload } = await jwtVerify(token, JWKS, {
        issuer: acceptedIssuers,
        audience: this.configService.get('KEYCLOAK_CLIENT_ID') || 'perfana-api',
      });

      return payload;
    } catch (error) {
      this.logger.debug(
        `Keycloak JWT validation failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return null;
    }
  }
}
```

### 2.6 WebSocket Authentication Adapter (IoAdapter Extension)

**File: `apps/api/src/modules/test-runs/gateways/ws-auth.adapter.ts`**

```typescript
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * Custom WebSocket adapter that adds authentication middleware
 * This adapter extends the default Socket.IO adapter to validate tokens
 * before allowing WebSocket connections
 */
export class WsAuthAdapter extends IoAdapter {
  private readonly logger = new Logger(WsAuthAdapter.name);

  constructor(
    app: any,
    private configService: ConfigService,
    private apiKeysService: ApiKeysService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.configService.get('FRONTEND_URL') || 'http://localhost:3000',
        credentials: true,
      },
    });

    // Add authentication middleware
    server.use(async (socket, next) => {
      try {
        const token = this.extractToken(socket);

        if (!token) {
          this.logger.warn('WebSocket connection without token');
          return next(new Error('Authentication error: Missing token'));
        }

        const authResult = await this.tryAuthentication(token, socket);

        if (!authResult.success) {
          this.logger.warn('WebSocket authentication failed');
          return next(new Error('Authentication error: Invalid token'));
        }

        this.logger.log(
          `WebSocket authenticated: ${authResult.authType} for ${socket.id}`,
        );
        next();
      } catch (error) {
        this.logger.error(
          `WebSocket authentication error: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
        );
        next(new Error('Authentication error'));
      }
    });

    return server;
  }

  private extractToken(socket: any): string | null {
    const auth = socket.handshake.auth?.token;
    if (auth) return auth;

    const queryToken = socket.handshake.query?.token;
    if (queryToken && typeof queryToken === 'string') return queryToken;

    const headerAuth = socket.handshake.headers?.authorization;
    if (headerAuth && typeof headerAuth === 'string') {
      const [type, token] = headerAuth.split(' ');
      if (type === 'Bearer' && token) return token;
    }

    return null;
  }

  private async tryAuthentication(
    token: string,
    socket: any,
  ): Promise<{ success: boolean; authType?: string }> {
    // Try API Key
    try {
      const isValidApiKey = await this.apiKeysService.validateApiKey(token);
      if (isValidApiKey) {
        socket.userId = 'api-key-user';
        socket.authType = 'api-key';
        return { success: true, authType: 'api-key' };
      }
    } catch (error) {
      // Continue to next auth method
    }

    // Try Keycloak JWT
    try {
      const keycloakUser = await this.validateKeycloakToken(token);
      if (keycloakUser) {
        socket.userId = keycloakUser.sub || keycloakUser.preferred_username;
        socket.authType = 'keycloak-jwt';
        socket.email = keycloakUser.email;
        socket.organizationId = keycloakUser.organization_id;
        socket.teamId = keycloakUser.team_id;
        return { success: true, authType: 'keycloak-jwt' };
      }
    } catch (error) {
      // Continue
    }

    return { success: false };
  }

  private async validateKeycloakToken(token: string): Promise<any | null> {
    try {
      const keycloakUrl =
        this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
      const realm = this.configService.get('KEYCLOAK_REALM') || 'perfana-prod';
      const jwksUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));

      const acceptedIssuersEnv = this.configService.get('KEYCLOAK_ACCEPTED_ISSUERS');
      let acceptedIssuers: string[];

      if (acceptedIssuersEnv) {
        acceptedIssuers = acceptedIssuersEnv
          .split(',')
          .map((iss: string) => iss.trim());
      } else {
        acceptedIssuers = [
          `${keycloakUrl}/realms/${realm}`,
          `http://localhost:8080/realms/${realm}`,
        ];
      }

      const { payload } = await jwtVerify(token, JWKS, {
        issuer: acceptedIssuers,
        audience: this.configService.get('KEYCLOAK_CLIENT_ID') || 'perfana-api',
      });

      return payload;
    } catch (error) {
      return null;
    }
  }
}
```

---

## 3. Database Integration

### 3.1 Event Emission Points

Modify `TestRunsMutationService` to emit events after database operations:

**File: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts`**

Add the following imports and inject the gateway:

```typescript
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../events/test-run.events';

@Injectable()
export class TestRunsMutationService {
  constructor(
    // ... existing dependencies
    private testRunsGateway: TestRunsGateway, // Add this
  ) {}

  async updateRunningTest(updateDto: UpdateRunningTestDto): Promise<TestRun> {
    // ... existing logic to create/update test run
    const testRun = await this.repository.save(newTestRun);

    // Emit realtime event
    this.testRunsGateway.emitTestRunCreated(
      {
        eventType: TestRunEventType.CREATED,
        timestamp: new Date().toISOString(),
        testRun,
      },
      undefined, // userId (extract from context if available)
      testRun.organization_id, // if you have this field
    );

    return testRun;
  }

  async deleteTestRun(id: string): Promise<void> {
    const testRun = await this.repository.findOne({ where: { id } });

    if (!testRun) {
      throw new NotFoundException(`Test run with ID ${id} not found`);
    }

    await this.repository.delete(id);

    // Emit realtime event
    this.testRunsGateway.emitTestRunDeleted(
      {
        eventType: TestRunEventType.DELETED,
        timestamp: new Date().toISOString(),
        testRunId: testRun.test_run_id,
        id: testRun.id,
      },
      undefined,
      testRun.organization_id,
    );
  }

  // Similar patterns for update operations
}
```

### 3.2 Alternative: Database Triggers (Advanced)

For a more decoupled approach, you could use PostgreSQL triggers with LISTEN/NOTIFY:

**Pros:**
- Completely decoupled from application logic
- Captures ALL database changes (even from external tools)
- Guaranteed consistency

**Cons:**
- More complex setup
- Harder to test
- Limited payload size

**Implementation (if desired):**
```sql
-- Create notification function
CREATE OR REPLACE FUNCTION notify_test_run_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('test_run_changes', json_build_object(
      'operation', 'INSERT',
      'record', row_to_json(NEW)
    )::text);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM pg_notify('test_run_changes', json_build_object(
      'operation', 'UPDATE',
      'record', row_to_json(NEW)
    )::text);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('test_run_changes', json_build_object(
      'operation', 'DELETE',
      'record', row_to_json(OLD)
    )::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER test_run_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON test_runs
FOR EACH ROW EXECUTE FUNCTION notify_test_run_change();
```

Then listen in NestJS:
```typescript
// In gateway or service
this.pool.on('notification', (msg) => {
  if (msg.channel === 'test_run_changes') {
    const payload = JSON.parse(msg.payload);
    this.handleDatabaseChange(payload);
  }
});

await this.pool.query('LISTEN test_run_changes');
```

**Recommendation:** Start with application-level events (simpler), migrate to database triggers later if needed.

---

## 4. Authentication & Authorization

### 4.1 Integration with KeycloakEnhancedAuthGuard

The WebSocket authentication mirrors your existing HTTP authentication:

**Authentication Flow:**
1. Client connects with token (JWT or API Key)
2. WsAuthAdapter middleware validates token
3. Socket object is enriched with user data
4. User is joined to appropriate rooms
5. Events are filtered by room membership

**Token Passing Methods:**
```typescript
// Frontend Socket.IO client
const socket = io('http://localhost:3001/test-runs', {
  auth: {
    token: getAuthToken(), // Preferred method
  },
  // OR
  query: {
    token: getAuthToken(), // Fallback method
  },
  // OR for HTTP long-polling
  extraHeaders: {
    Authorization: `Bearer ${getAuthToken()}`,
  },
});
```

### 4.2 Room-Based Authorization

**Room Strategy:**
- `user:{userId}` - User's own test runs
- `org:{organizationId}` - Organization-wide test runs
- `team:{teamId}` - Team-specific test runs
- `test-run:{testRunId}` - Specific test run updates
- `global` - All updates (admin only, or filtered client-side)

**Authorization Rules:**
```typescript
// Example: Only emit to user's own test runs
if (testRun.created_by === userId) {
  rooms.push(`user:${userId}`);
}

// Example: Emit to organization members
if (testRun.organization_id) {
  rooms.push(`org:${testRun.organization_id}`);
}
```

### 4.3 Security Considerations

**Token Expiration:**
- Handle token refresh on frontend
- Disconnect and reconnect with new token
- Implement graceful degradation

**Rate Limiting:**
```typescript
// In gateway
@UseGuards(ThrottlerGuard)
@SubscribeMessage('subscribe:test-run')
async handleSubscribe() {
  // ...
}
```

**Input Validation:**
```typescript
import { IsString } from 'class-validator';

class SubscribeDto {
  @IsString()
  testRunId: string;
}

@SubscribeMessage('subscribe:test-run')
async handleSubscribe(
  @MessageBody(ValidationPipe) data: SubscribeDto,
) {
  // ...
}
```

---

## 5. Frontend Integration

### 5.1 Socket.IO Client Setup

**File: `apps/web/lib/socket.ts`**

```typescript
import { io, Socket } from 'socket.io-client';
import keycloakAuth from './keycloak-auth';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = keycloakAuth.getToken();

    if (!token) {
      throw new Error('No authentication token available');
    }

    socket = io(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/test-runs`, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    // Connection handlers
    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);

      // Attempt to reconnect with fresh token if auth failed
      if (reason === 'io server disconnect') {
        const newToken = keycloakAuth.getToken();
        if (newToken) {
          socket?.auth = { token: newToken };
          socket?.connect();
        }
      }
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);

      // If token expired, try to refresh
      if (error.message.includes('Authentication')) {
        keycloakAuth.updateToken(30).then(() => {
          const newToken = keycloakAuth.getToken();
          if (newToken && socket) {
            socket.auth = { token: newToken };
            socket.connect();
          }
        });
      }
    });

    socket.on('connected', (data) => {
      console.log('Successfully connected to test-runs namespace:', data);
    });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export default getSocket;
```

### 5.2 React Hook for Realtime Updates

**File: `apps/web/hooks/useTestRunRealtime.ts`**

```typescript
import { useEffect, useState, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import { TestRun } from '@/types';

export enum TestRunEventType {
  CREATED = 'test-run:created',
  UPDATED = 'test-run:updated',
  DELETED = 'test-run:deleted',
  STATUS_CHANGED = 'test-run:status-changed',
}

interface TestRunEvent {
  eventType: TestRunEventType;
  timestamp: string;
  testRun?: TestRun;
  testRunId?: string;
  id?: string;
}

interface UseTestRunRealtimeOptions {
  onCreated?: (testRun: TestRun) => void;
  onUpdated?: (testRun: TestRun) => void;
  onDeleted?: (testRunId: string, id: string) => void;
  onStatusChanged?: (testRun: TestRun) => void;
  enabled?: boolean;
}

export function useTestRunRealtime(options: UseTestRunRealtimeOptions = {}) {
  const {
    onCreated,
    onUpdated,
    onDeleted,
    onStatusChanged,
    enabled = true,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<TestRunEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let socket: ReturnType<typeof getSocket> | null = null;

    try {
      socket = getSocket();

      // Connection status handlers
      const handleConnect = () => {
        setIsConnected(true);
      };

      const handleDisconnect = () => {
        setIsConnected(false);
      };

      // Event handlers
      const handleCreated = (event: TestRunEvent) => {
        setLastEvent(event);
        if (event.testRun && onCreated) {
          onCreated(event.testRun);
        }
      };

      const handleUpdated = (event: TestRunEvent) => {
        setLastEvent(event);
        if (event.testRun && onUpdated) {
          onUpdated(event.testRun);
        }
      };

      const handleDeleted = (event: TestRunEvent) => {
        setLastEvent(event);
        if (event.testRunId && event.id && onDeleted) {
          onDeleted(event.testRunId, event.id);
        }
      };

      const handleStatusChanged = (event: TestRunEvent) => {
        setLastEvent(event);
        if (event.testRun && onStatusChanged) {
          onStatusChanged(event.testRun);
        }
      };

      // Register listeners
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.on(TestRunEventType.CREATED, handleCreated);
      socket.on(TestRunEventType.UPDATED, handleUpdated);
      socket.on(TestRunEventType.DELETED, handleDeleted);
      socket.on(TestRunEventType.STATUS_CHANGED, handleStatusChanged);

      setIsConnected(socket.connected);

      // Cleanup
      return () => {
        if (socket) {
          socket.off('connect', handleConnect);
          socket.off('disconnect', handleDisconnect);
          socket.off(TestRunEventType.CREATED, handleCreated);
          socket.off(TestRunEventType.UPDATED, handleUpdated);
          socket.off(TestRunEventType.DELETED, handleDeleted);
          socket.off(TestRunEventType.STATUS_CHANGED, handleStatusChanged);
        }
      };
    } catch (error) {
      console.error('Failed to initialize Socket.IO:', error);
    }
  }, [enabled, onCreated, onUpdated, onDeleted, onStatusChanged]);

  const subscribeToTestRun = useCallback((testRunId: string) => {
    const socket = getSocket();
    socket.emit('subscribe:test-run', { testRunId });
  }, []);

  const unsubscribeFromTestRun = useCallback((testRunId: string) => {
    const socket = getSocket();
    socket.emit('unsubscribe:test-run', { testRunId });
  }, []);

  return {
    isConnected,
    lastEvent,
    subscribeToTestRun,
    unsubscribeFromTestRun,
  };
}
```

### 5.3 Usage in Components

**Example: Test Runs List Page**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useTestRunRealtime } from '@/hooks/useTestRunRealtime';
import { TestRun } from '@/types';

export default function TestRunsPage() {
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);

  // Fetch initial data
  useEffect(() => {
    fetchTestRuns().then(setTestRuns);
  }, []);

  // Setup realtime updates
  const { isConnected } = useTestRunRealtime({
    onCreated: (newTestRun) => {
      setTestRuns((prev) => [newTestRun, ...prev]);
    },
    onUpdated: (updatedTestRun) => {
      setTestRuns((prev) =>
        prev.map((tr) => (tr.id === updatedTestRun.id ? updatedTestRun : tr))
      );
    },
    onDeleted: (testRunId, id) => {
      setTestRuns((prev) => prev.filter((tr) => tr.id !== id));
    },
  });

  return (
    <div>
      <h1>Test Runs</h1>
      {isConnected && <span className="badge">Live Updates Active</span>}

      {testRuns.map((testRun) => (
        <TestRunCard key={testRun.id} testRun={testRun} />
      ))}
    </div>
  );
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Test the Gateway:**
```typescript
// test-runs.gateway.spec.ts
describe('TestRunsGateway', () => {
  let gateway: TestRunsGateway;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TestRunsGateway,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    gateway = module.get<TestRunsGateway>(TestRunsGateway);
  });

  it('should emit test run created event', () => {
    const event = {
      eventType: TestRunEventType.CREATED,
      timestamp: new Date().toISOString(),
      testRun: mockTestRun,
    };

    const emitSpy = jest.spyOn(gateway.server, 'emit');
    gateway.emitTestRunCreated(event);

    expect(emitSpy).toHaveBeenCalledWith(TestRunEventType.CREATED, event);
  });
});
```

### 6.2 Integration Tests

**Test End-to-End Flow:**
```typescript
describe('Realtime Test Run Updates (e2e)', () => {
  let app: INestApplication;
  let socket: Socket;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    await app.listen(3001);
  });

  beforeEach(() => {
    socket = io('http://localhost:3001/test-runs', {
      auth: { token: validTestToken },
    });
  });

  afterEach(() => {
    socket.close();
  });

  it('should receive test run created event', (done) => {
    socket.on(TestRunEventType.CREATED, (event) => {
      expect(event.testRun).toBeDefined();
      expect(event.eventType).toBe(TestRunEventType.CREATED);
      done();
    });

    // Trigger test run creation via REST API
    request(app.getHttpServer())
      .post('/test')
      .set('Authorization', `Bearer ${validTestToken}`)
      .send(createTestRunDto)
      .expect(201);
  });
});
```

### 6.3 Load Testing

Use Artillery or k6 to test WebSocket performance:

```yaml
# artillery-websocket-load.yml
config:
  target: "ws://localhost:3001"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Sustained load"
  socketio:
    transports: ["websocket"]

scenarios:
  - engine: socketio
    flow:
      - emit:
          channel: "subscribe:test-run"
          data:
            testRunId: "test-001"
      - think: 30
```

---

## 7. Deployment Considerations

### 7.1 Environment Variables

Add to `.env` files:

```bash
# Redis Configuration (for Socket.IO adapter)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=  # Optional

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000

# Keycloak settings (already exist)
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=perfana-prod
KEYCLOAK_CLIENT_ID=perfana-api
KEYCLOAK_ACCEPTED_ISSUERS=http://localhost:8080/realms/perfana-prod,http://keycloak:8080/realms/perfana-prod
```

### 7.2 Redis Setup

**Docker Compose (Development):**
```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

volumes:
  redis-data:
```

**Production:**
- Use managed Redis service (AWS ElastiCache, Google Cloud Memorystore, etc.)
- Enable persistence (AOF or RDB)
- Setup replication for high availability
- Monitor memory usage and connections

### 7.3 CORS Configuration

Ensure CORS is properly configured for WebSocket connections:

```typescript
// In main.ts
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
});
```

### 7.4 Load Balancer Configuration

**Nginx Example:**
```nginx
upstream socket_nodes {
  ip_hash;  # Optional: sticky sessions (not required with Redis adapter)
  server 127.0.0.1:3001;
  server 127.0.0.1:3002;
  server 127.0.0.1:3003;
}

server {
  listen 80;

  location /socket.io/ {
    proxy_pass http://socket_nodes;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### 7.5 Monitoring and Observability

**Metrics to Track:**
- Active WebSocket connections
- Events emitted per second
- Redis pub/sub latency
- Authentication failures
- Connection errors

**Logging:**
```typescript
// Add structured logging
this.logger.log({
  event: 'websocket_connection',
  userId: client.userId,
  authType: client.authType,
  timestamp: new Date().toISOString(),
});
```

**Health Checks:**
```typescript
// In health check endpoint
@Get('health/websocket')
async checkWebSocket() {
  return {
    status: 'ok',
    activeConnections: this.gateway.server.sockets.sockets.size,
    redisConnected: this.gateway.redisInitialized,
  };
}
```

---

## 8. Implementation Checklist

### Phase 1: Setup & Configuration
- [ ] Install `@socket.io/redis-adapter` package
- [ ] Add Redis environment variables
- [ ] Setup Redis in Docker Compose (development)
- [ ] Verify existing Socket.IO packages

### Phase 2: Backend Core
- [ ] Create event type definitions (`events/test-run.events.ts`)
- [ ] Implement WebSocket gateway (`gateways/test-runs.gateway.ts`)
- [ ] Implement WebSocket auth guard (`gateways/ws-auth.guard.ts`)
- [ ] Implement WebSocket auth adapter (`gateways/ws-auth.adapter.ts`)
- [ ] Update test-runs module to include gateway

### Phase 3: Database Integration
- [ ] Modify `TestRunsMutationService` to emit events on create
- [ ] Add event emission on update operations
- [ ] Add event emission on delete operations
- [ ] Test event emission with unit tests

### Phase 4: Frontend Implementation
- [ ] Create Socket.IO client utility (`lib/socket.ts`)
- [ ] Create React hook for realtime updates (`hooks/useTestRunRealtime.ts`)
- [ ] Update test runs list page to use realtime hook
- [ ] Add connection status indicator in UI
- [ ] Handle reconnection and token refresh

### Phase 5: Testing
- [ ] Write unit tests for gateway
- [ ] Write integration tests for end-to-end flow
- [ ] Perform manual testing with multiple clients
- [ ] Load testing with Artillery/k6
- [ ] Test with multiple backend instances

### Phase 6: Production Readiness
- [ ] Configure Redis for production
- [ ] Setup load balancer (Nginx/HAProxy)
- [ ] Configure CORS properly
- [ ] Add monitoring and logging
- [ ] Create deployment documentation
- [ ] Security review (token handling, rate limiting)

### Phase 7: Optimization
- [ ] Implement room-based filtering optimization
- [ ] Add caching for frequently accessed data
- [ ] Optimize event payload size
- [ ] Add compression for large payloads
- [ ] Performance profiling and tuning

---

## Next Steps

1. **Start with Phase 1**: Install dependencies and setup Redis
2. **Implement Core Gateway**: Build the basic WebSocket gateway with authentication
3. **Test Authentication**: Verify JWT and API Key authentication works
4. **Add Event Emission**: Integrate with mutation service
5. **Build Frontend Hook**: Create the React hook for consumption
6. **Iterate and Test**: Test with real data and multiple clients

---

## References

- [NestJS WebSockets Documentation](https://docs.nestjs.com/websockets/gateways)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Socket.IO Redis Adapter](https://socket.io/docs/v4/redis-adapter/)
- [NestJS Platform Socket.IO](https://github.com/nestjs/platform-socket.io)
- [Keycloak JWT Validation](https://www.keycloak.org/docs/latest/securing_apps/)

---

## Appendix: Code Snippets

### Module Registration

Update `apps/api/src/modules/test-runs/test-runs.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TestRunsGateway } from './gateways/test-runs.gateway';
import { WsAuthGuard } from './gateways/ws-auth.guard';
// ... other imports

@Module({
  imports: [
    // ... existing imports
  ],
  controllers: [
    // ... existing controllers
  ],
  providers: [
    // ... existing providers
    TestRunsGateway,  // Add this
    WsAuthGuard,      // Add this
  ],
  exports: [
    // ... existing exports
    TestRunsGateway,  // Add this if other modules need it
  ],
})
export class TestRunsModule {}
```

### Main.ts Configuration

Update `apps/api/src/main.ts` to use the custom WebSocket adapter:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from './modules/api-keys/api-keys.service';
import { WsAuthAdapter } from './modules/test-runs/gateways/ws-auth.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get services for WebSocket adapter
  const configService = app.get(ConfigService);
  const apiKeysService = app.get(ApiKeysService);

  // Use custom WebSocket adapter with authentication
  app.useWebSocketAdapter(new WsAuthAdapter(app, configService, apiKeysService));

  // ... rest of bootstrap

  await app.listen(3001);
}
bootstrap();
```

---

**End of Implementation Plan**

This comprehensive plan provides all the necessary details to implement realtime updates for the Perfana test runs module. Follow the implementation checklist phase by phase, and refer to the detailed code examples for each component.
