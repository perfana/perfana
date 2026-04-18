// Polyfill crypto for distroless Node.js environment
// Must be before any other imports that might use crypto
import * as nodeCrypto from 'crypto';
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as Record<string, unknown>).crypto = nodeCrypto.webcrypto;
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ValidationException } from './common/exceptions/business.exception';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';

/**
 * Custom Socket.IO adapter with CORS configuration
 * Extends the default IoAdapter to configure Socket.IO server options
 */
class SocketIOAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private configService: ConfigService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    // Support multiple frontend origins for development
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

    return super.createIOServer(port, serverOptions);
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Configure logger based on LOG_LEVEL environment variable
  const logLevel = process.env.LOG_LEVEL || 'info';
  const logLevels: Record<string, Array<'log' | 'error' | 'warn' | 'debug' | 'verbose'>> = {
    error: ['error'],
    warn: ['error', 'warn'],
    info: ['error', 'warn', 'log'],
    debug: ['error', 'warn', 'log', 'debug', 'verbose'],
  };

  const app = await NestFactory.create(AppModule, {
    logger: logLevels[logLevel] || logLevels.info,
  });

  // Get ConfigService for Socket.IO adapter
  const configService = app.get(ConfigService);

  // Configure Socket.IO adapter with CORS
  app.useWebSocketAdapter(new SocketIOAdapter(app, configService));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Do not forbid non-whitelisted properties for query parameters
      // Only request bodies (POST/PUT/PATCH) with DTOs will be strictly validated
      forbidNonWhitelisted: false,
      transform: true,
      // Transform query parameters to correct types
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors) => {
        // Log field names and constraints only — never log raw values (may contain credentials)
        errors.forEach(err => {
          logger.error(`Validation failed on field: ${err.property}, Constraints:`, err.constraints);
        });
        const message = `Validation failed: ${errors.map(e => `${e.property}: ${Object.values(e.constraints || {}).join(', ')}`).join('; ')}`;
        return new ValidationException(message, errors);
      },
    })
  );

  // Security headers (Helmet)
  app.use(helmet({
    contentSecurityPolicy: false, // Disabled for Swagger UI compatibility; tighten in production
  }));

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CORS configuration (for HTTP endpoints)
  // Support multiple frontend origins for development
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [process.env.FRONTEND_URL || 'http://localhost:4001', 'http://localhost:4002'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger documentation (enabled in non-production or when SWAGGER_ENABLED=true)
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('Perfana API')
      .setDescription('Performance analysis and observability platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`Perfana API running on http://localhost:${port}`);
  logger.log(`API documentation: http://localhost:${port}/api/docs`);

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Handle termination signals for graceful shutdown
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, closing application gracefully...`);
      try {
        await app.close();
        logger.log('Application closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });
  });
}

bootstrap();