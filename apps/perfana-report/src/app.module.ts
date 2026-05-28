import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createSystemDataSource } from '@perfana/shared/database/data-source-system';

// Import all entities from shared package to ensure complete entity graph
import * as sharedEntities from '@perfana/shared/entities';

import { PdfModule } from './modules/pdf/pdf.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Get all shared entity classes to ensure complete entity graph for TypeORM
        // Filter out enums (like TracingUI) and keep only entity classes
        const sharedEntityClasses = Object.entries(sharedEntities)
          .filter(
            ([key, value]) =>
              typeof value === 'function' &&
              value.prototype &&
              key !== 'TracingUI' // Exclude the TracingUI enum
          )
          .map(([, value]) => value) as Array<new (...args: any[]) => any>;

        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST'),
          port: configService.get<number>('DB_PORT'),
          username: configService.get<string>('DB_USERNAME'),
          password: configService.get<string>('DB_PASSWORD'),
          database: configService.get<string>('DB_NAME'),
          entities: sharedEntityClasses,
          synchronize: false, // Never auto-sync schema - use migrations instead
          logging: configService.get<string>('DB_LOGGING') === 'true',
        };
      },
      dataSourceFactory: async opts => {
        if (!opts) throw new Error('perfana-report: typeorm options missing');
        return createSystemDataSource('perfana-report', opts);
      },
    }),

    // Feature modules
    PdfModule,
    HealthModule,
  ],
})
export class AppModule {}
