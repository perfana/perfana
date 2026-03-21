import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3003);
  const logger = new Logger('PerfanaReport');

  await app.listen(port);

  logger.log(`Perfana Report Service started on port ${port}`);
  logger.log(`Environment: ${configService.get('NODE_ENV')}`);
  logger.log(`Log Level: ${configService.get('LOG_LEVEL')}`);
  logger.log(`Browser Pool Size: ${configService.get('BROWSER_POOL_SIZE', 3)}`);
  logger.log(`Queue Concurrency: ${configService.get('QUEUE_CONCURRENCY', 2)}`);

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
