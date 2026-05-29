import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import { Server, ServerOptions } from 'socket.io';

/**
 * Custom Socket.IO adapter with CORS configuration.
 *
 * Extends IoAdapter to fix a Docker npm-hoisting issue: when a monorepo build
 * produces a duplicate @nestjs/core copy, the parent class sets this.httpServer
 * to the app object instead of the real http.Server. We bypass the parent's
 * instanceof check entirely for port === 0 by calling getHttpServer() directly.
 */
export class SocketIOAdapter extends IoAdapter {
  constructor(
    private readonly nestApp: INestApplication,
    private configService: ConfigService,
  ) {
    super(nestApp);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const corsAllowedOrigins = this.configService.get('CORS_ALLOWED_ORIGINS');
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:4001';

    const allowedOrigins = corsAllowedOrigins
      ? corsAllowedOrigins.split(',').map((o: string) => o.trim())
      : [frontendUrl, 'http://localhost:4002'];

    const serverOptions: Partial<ServerOptions> = {
      ...options,
      cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
    };

    // When port === 0, Socket.IO should share the existing HTTP server.
    // We call app.getHttpServer() directly rather than relying on this.httpServer
    // from the parent class, because the parent sets it via an `instanceof NestApplication`
    // check — which silently fails in Docker builds where monorepo npm hoisting produces
    // a duplicate @nestjs/core copy, leaving this.httpServer pointing at the app object
    // instead of the real http.Server and breaking Socket.IO attachment.
    if (port === 0) {
      return new Server(this.nestApp.getHttpServer(), serverOptions);
    }
    return super.createIOServer(port, serverOptions);
  }
}
