import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createSystemDataSource } from '@perfana/shared/database/data-source-system';
import { ScheduleModule } from '@nestjs/schedule';
import grafanaSyncConfig from './config/grafana-sync.config';
import { validationSchema } from './config/validation.schema';
import { GrafanaSyncModule } from './modules/grafana-sync/grafana-sync.module';
import { AutoConfigModule } from './modules/auto-config/auto-config.module';
import { SanityCheckerModule } from './modules/sanity-checker/sanity-checker.module';
import { GrafanaApiModule } from './modules/grafana-api/grafana-api.module';

// Import all entities from shared package
// Note: We need to import ALL entities because of TypeORM relation dependencies
import {
  GrafanaInstance,
  GrafanaDashboard,
  ApplicationDashboard,
  TestRun,
  Benchmark,
  SystemUnderTest,
  TestRunConfiguration,
  Organization,
  Team,
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  PyroscopeInstance,
  MetricsSource,
  AuditLog,
} from '@perfana/shared/entities';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [grafanaSyncConfig],
      validationSchema,
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_NAME'),
        entities: [
          // Foundation entities (no dependencies - must come first)
          Organization,
          Team,
          PyroscopeInstance,
          // Grafana entities
          GrafanaInstance,
          GrafanaDashboard,
          ApplicationDashboard,
          MetricsSource,
          // Core entities (depend on foundation entities)
          SystemUnderTest, // depends on Team, PyroscopeInstance
          TestRun,
          TestRunConfiguration,
          Benchmark,
          // Auto-config entities
          Profile,
          ProfileGrafanaDashboard,
          ProfileBenchmark,
          // Audit logging
          AuditLog,
        ],
        synchronize: false, // Never auto-sync schema - use migrations instead
        logging: configService.get('DB_LOGGING') === 'true',
      }),
      dataSourceFactory: async (opts) => {
        if (!opts) throw new Error('grafana-sync: typeorm options missing');
        return createSystemDataSource('grafana-sync', opts);
      },
    }),

    // Feature modules
    GrafanaSyncModule,
    AutoConfigModule,
    SanityCheckerModule,
    GrafanaApiModule,
  ],
})
export class AppModule {}
