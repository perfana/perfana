import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { createDatabaseConfig } from './config/database.config';
import { envValidationOptions } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { TeamsModule } from './modules/teams/teams.module';
import { SystemsUnderTestModule } from './modules/systems-under-test/systems-under-test.module';
import { TestRunsModule } from './modules/test-runs/test-runs.module';
import { BenchmarksModule } from './modules/benchmarks/benchmarks.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { GrafanaModule } from './modules/grafana/grafana.module';
import { PyroscopeModule } from './modules/pyroscope/pyroscope.module';
import { DeepLinksModule } from './modules/deep-links/deep-links.module';
import { ComparePresetsModule } from './modules/compare-presets/compare-presets.module';
import { TrendsPresetsModule } from './modules/trends-presets/trends-presets.module';
import { GraphPresetsModule } from './modules/graph-presets/graph-presets.module';
import { TracingServicesModule } from './modules/tracing-services/tracing-services.module';
import { TracingInstancesModule } from './modules/tracing-instances/tracing-instances.module';
import { AdaptModule } from './modules/adapt/adapt.module';
import { AwrModule } from './modules/awr/awr.module';
import { DataScienceModule } from './modules/data-science/data-science.module';
import { DynatraceModule } from './modules/dynatrace/dynatrace.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { EventsModule } from './modules/events/events.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './modules/health/health.module';
import { QueueModule } from './modules/queue/queue.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { TempoModule } from './modules/tempo/tempo.module';
import { TraceAnalysisModule } from './modules/trace-analysis/trace-analysis.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { MetricsSourcesModule } from './modules/metrics-sources/metrics-sources.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { KeycloakEnhancedAuthGuard } from './guards/keycloak-enhanced-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { EnhancedThrottlerGuard } from './guards/enhanced-throttler.guard';
import { ThrottlerStorageRedisService } from './guards/throttler-storage-redis.service';
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
import { RlsTransactionInterceptor } from './common/interceptors/rls-transaction.interceptor';
import { RequestContextModule } from './common/context/request-context.module';
import { CommonModule } from './common/common.module';
import IORedis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      ...envValidationOptions,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => createDatabaseConfig(configService),
    }),
    // Rate limiting with Redis storage
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, QueueModule],
      inject: [ConfigService, 'REDIS_CLIENT'],
      useFactory: async (configService: ConfigService, redisClient: IORedis) => {
        const storageService = new ThrottlerStorageRedisService(redisClient);
        return {
          throttlers: [
            {
              name: 'default',
              ttl: configService.get('THROTTLE_TTL', 60000), // 60 seconds default
              limit: configService.get('THROTTLE_LIMIT', 100), // 100 requests default
            },
          ],
          storage: storageService,
          // Custom error message
          errorMessage: 'Too many requests. Please try again later.',
          // Skip if behind a reverse proxy that handles rate limiting
          skipIf: () => configService.get('SKIP_RATE_LIMITING', 'false') === 'true',
        };
      },
    }),
    QueueModule, // Provides REDIS_CLIENT
    CommonModule,
    RequestContextModule,
    AuthModule,
    OrganizationsModule,
    TeamsModule,
    SystemsUnderTestModule,
    TestRunsModule,
    BenchmarksModule,
    MetricsModule,
    ReportsModule,
    ApiKeysModule,
    GrafanaModule,
    PyroscopeModule,
    DeepLinksModule,
    ComparePresetsModule,
    TrendsPresetsModule,
    GraphPresetsModule,
    TracingServicesModule,
    TracingInstancesModule,
    AdaptModule,
    AwrModule,
    DataScienceModule,
    DynatraceModule,
    AlertsModule,
    EventsModule,
    RealtimeModule,
    HealthModule,
    ProfilesModule,
    TempoModule,
    TraceAnalysisModule,
    NotificationsModule,
    AuditModule,
    UsersModule,
    ProvisioningModule,
    MetricsSourcesModule,
    ProxyModule,
  ],
  controllers: [],
  providers: [
    // Authentication guard (runs first)
    {
      provide: APP_GUARD,
      useClass: KeycloakEnhancedAuthGuard,
    },
    // Role-based access control guard (runs second, after authentication)
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Rate limiting guard (runs third, after authorization)
    {
      provide: APP_GUARD,
      useClass: EnhancedThrottlerGuard,
    },
    // Global audit context interceptor (populates CLS store; service-layer logs)
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditContextInterceptor,
    },
    // Phase 5b: per-request RLS transaction wrapper. Runs after AuditContext
    // so REQ_CTX is populated; gated on DB_ENABLE_RLS_ROLE=true.
    {
      provide: APP_INTERCEPTOR,
      useClass: RlsTransactionInterceptor,
    },
  ],
})
export class AppModule {}