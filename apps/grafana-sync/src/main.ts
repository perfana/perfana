import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  // Determine log levels from environment variable
  // Note: 'info' and 'log' are treated as equivalent
  const logLevel = process.env.LOG_LEVEL || 'info';
  const logLevels: string[] = [];

  // Build log level array based on configuration
  // Order: error < warn < log/info < debug < verbose
  if (['error', 'warn', 'log', 'info', 'debug', 'verbose'].includes(logLevel)) {
    logLevels.push('error');
    if (['warn', 'log', 'info', 'debug', 'verbose'].includes(logLevel)) {
      logLevels.push('warn');
    }
    if (['log', 'info', 'debug', 'verbose'].includes(logLevel)) {
      logLevels.push('log');
    }
    if (['debug', 'verbose'].includes(logLevel)) {
      logLevels.push('debug');
    }
    if (logLevel === 'verbose') {
      logLevels.push('verbose');
    }
  } else {
    // Default to info level if invalid
    logLevels.push('error', 'warn', 'log');
  }

  const app = await NestFactory.create(AppModule, {
    logger: logLevels as any,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('grafanaSync.port', 3002);
  const logger = new Logger('GrafanaSync');

  await app.listen(port);

  logger.log(`Grafana Sync Service started on port ${port}`);
  logger.log(`Environment: ${configService.get('NODE_ENV')}`);
  logger.log(`Log Level: ${configService.get('LOG_LEVEL')}`);
  logger.log(`Sync Interval: ${configService.get('grafanaSync.syncInterval')}ms`);

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Handle termination signals for graceful shutdown
  const signals = ['SIGTERM', 'SIGINT'];
  signals.forEach((signal) => {
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
