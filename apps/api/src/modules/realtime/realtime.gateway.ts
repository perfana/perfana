import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { KeycloakJwtService } from '../auth/keycloak-jwt.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4001',
    credentials: true,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private realtimeService: RealtimeService,
    private keycloakJwtService: KeycloakJwtService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket server initialized');
    this.realtimeService.setServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];

      if (token) {
        const keycloakUser = await this.keycloakJwtService.validateToken(token);
        client.data.user = {
          id: keycloakUser.sub,
          email: keycloakUser.email,
          firstName: keycloakUser.given_name,
          lastName: keycloakUser.family_name,
        };
        this.logger.debug(`User ${keycloakUser.email} connected with socket ${client.id}`);
      } else {
        this.logger.warn(`Rejecting unauthenticated WebSocket connection: ${client.id}`);
        client.emit('auth_error', { message: 'Authentication required' });
        client.disconnect();
        return;
      }

      client.emit('connection_established', {
        socketId: client.id,
        timestamp: new Date(),
        authenticated: !!client.data.user,
      });
    } catch (error) {
      this.logger.warn(`Authentication failed for socket ${client.id}: ${error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error"}`);
      client.emit('auth_error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (user) {
      this.logger.debug(`User ${user.email} disconnected (socket ${client.id})`);
    } else {
      this.logger.debug(`Anonymous user disconnected (socket ${client.id})`);
    }
  }

  @SubscribeMessage('subscribe_test_runs')
  async handleSubscribeTestRuns(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { filters?: Record<string, unknown> },
  ) {
    try {
      const room = this.realtimeService.getTestRunsRoom(data.filters);
      await client.join(room);

      this.logger.debug(`Client ${client.id} subscribed to ${room}`);

      // Send initial data
      const testRuns = await this.realtimeService.getInitialTestRuns(data.filters);
      client.emit('test_runs_initial', {
        data: testRuns,
        room,
        timestamp: new Date(),
      });

      client.emit('subscription_confirmed', {
        room,
        filters: data.filters,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to subscribe to test runs: ${error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error"}`);
      client.emit('subscription_error', {
        message: 'Failed to subscribe to test runs',
        error: error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error",
      });
    }
  }

  @SubscribeMessage('unsubscribe_test_runs')
  async handleUnsubscribeTestRuns(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { filters?: Record<string, unknown> },
  ) {
    try {
      const room = this.realtimeService.getTestRunsRoom(data.filters);
      await client.leave(room);

      this.logger.debug(`Client ${client.id} unsubscribed from ${room}`);

      client.emit('unsubscription_confirmed', {
        room,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from test runs: ${error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error"}`);
      client.emit('unsubscription_error', {
        message: 'Failed to unsubscribe from test runs',
        error: error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error",
      });
    }
  }

  @SubscribeMessage('subscribe_test_run')
  async handleSubscribeTestRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { testRunId: string },
  ) {
    try {
      const room = `test_run:${data.testRunId}`;
      await client.join(room);

      this.logger.debug(`Client ${client.id} subscribed to ${room}`);

      // Send initial test run data
      const testRun = await this.realtimeService.getTestRunDetails(data.testRunId);
      if (testRun) {
        client.emit('test_run_initial', {
          data: testRun,
          room,
          timestamp: new Date(),
        });
      }

      client.emit('subscription_confirmed', {
        room,
        testRunId: data.testRunId,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to subscribe to test run: ${error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error"}`);
      client.emit('subscription_error', {
        message: 'Failed to subscribe to test run',
        error: error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error",
      });
    }
  }

  @SubscribeMessage('unsubscribe_test_run')
  async handleUnsubscribeTestRun(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { testRunId: string },
  ) {
    try {
      const room = `test_run:${data.testRunId}`;
      await client.leave(room);

      this.logger.debug(`Client ${client.id} unsubscribed from ${room}`);

      client.emit('unsubscription_confirmed', {
        room,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from test run: ${error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error"}`);
      client.emit('unsubscription_error', {
        message: 'Failed to unsubscribe from test run',
        error: error && typeof error === "object" && "message" in error ? (error as Error).message : "Unknown error",
      });
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', {
      timestamp: new Date(),
      socketId: client.id,
    });
  }

  @SubscribeMessage('get_connection_info')
  handleGetConnectionInfo(@ConnectedSocket() client: Socket) {
    const user = client.data.user;
    client.emit('connection_info', {
      socketId: client.id,
      authenticated: !!user,
      user: user ? {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      } : null,
      rooms: Array.from(client.rooms),
      timestamp: new Date(),
    });
  }
}