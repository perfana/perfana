# Grafana Sync Service: Coding Rules

## 🎯 Core Principles

```yaml
core_principles:
  scheduled_tasks_first: "Design around scheduled cron jobs and background processing"
  resilience_by_default: "Implement retry logic, graceful degradation, and error recovery"
  configuration_driven: "Make all behavior configurable via environment variables"
  observability_always: "Comprehensive logging, metrics, and health checks"
  type_safety_first: "TypeScript strict mode with proper entity typing"
  testability: "Design for testability with proper mocking and dependency injection"
```

## 📁 Project Structure

```yaml
project_structure:
  src:
    main_ts: "Application bootstrap and NestJS configuration"
    app_module_ts: "Root module with imports of all feature modules"
    config:
      app_config_ts: "Application-wide configuration"
      database_config_ts: "Database connection configuration"
      grafana_sync_config_ts: "Grafana sync settings"
      auto_config_ts: "Auto-configuration detection settings"
      sanity_checker_config_ts: "Sanity checker settings"
    modules:
      grafana_sync: "Dashboard synchronization from Grafana instances"
      auto_config: "Automatic configuration detection and updates"
      sanity_checker: "Dashboard validation and sanity checks"
      grafana_api: "Grafana API client and utilities"
    test:
      helpers_ts: "Shared test utilities and mock factories"
```

## 🔧 TypeScript Configuration

```yaml
typescript_config:
  compiler_options:
    target: "ES2021"
    module: "commonjs"
    strict: false  # Note: Relaxed for legacy code compatibility
    experimentalDecorators: true
    emitDecoratorMetadata: true
    skipLibCheck: true

  path_aliases:
    "@perfana/shared": "Reference shared entities and services"
    "@perfana/shared/entities": "Import TypeORM entities"
    "@perfana/shared/services/grafana": "Import GrafanaClient"

  include_patterns:
    - "src/**/*"  # All source files
    - "test/**/*"  # Test helpers and utilities
```

## 🏗️ NestJS Scheduled Tasks Pattern

```yaml
scheduled_tasks:
  cron_decorators:
    pattern: "Use @nestjs/schedule decorators for scheduled tasks"
    example: |
      import { Cron, CronExpression } from '@nestjs/schedule';

      @Injectable()
      export class GrafanaSyncService {
        private readonly logger = new Logger(GrafanaSyncService.name);

        @Cron(CronExpression.EVERY_HOUR)
        async handleDashboardSync() {
          if (!this.configService.get<boolean>('GRAFANA_SYNC_ENABLED')) {
            return;
          }

          this.logger.log('Starting scheduled dashboard sync');
          try {
            await this.syncDashboards();
            this.logger.log('Dashboard sync completed successfully');
          } catch (error) {
            this.logger.error('Dashboard sync failed', error.stack);
          }
        }
      }

  configuration_checks:
    - "Always check if feature is enabled via config before executing"
    - "Log start and completion of scheduled tasks"
    - "Catch and log all errors - never let scheduled tasks crash"
    - "Use appropriate log levels (info for normal, warn for issues, error for failures)"

  interval_configuration:
    environment_based: "Read intervals from environment variables"
    validation: "Validate intervals at startup"
    example: |
      // In configuration file
      export default registerAs('grafanaSync', () => ({
        enabled: process.env.GRAFANA_SYNC_ENABLED === 'true',
        intervalMinutes: parseInt(process.env.GRAFANA_SYNC_INTERVAL_MINUTES || '60', 10),
        runOnStartup: process.env.GRAFANA_SYNC_ON_STARTUP === 'true',
      }));
```

## 🔄 Retry Logic & Error Handling

```yaml
retry_patterns:
  exponential_backoff:
    purpose: "Handle transient failures in external API calls"
    implementation: |
      async retryWithBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        initialDelayMs: number = 1000,
      ): Promise<T> {
        let lastError: Error;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await operation();
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
              const delay = initialDelayMs * Math.pow(2, attempt);
              this.logger.warn(
                `Attempt ${attempt + 1} failed, retrying in ${delay}ms`,
                error.message,
              );
              await this.sleep(delay);
            }
          }
        }

        throw lastError;
      }

  batch_processing:
    pattern: "Process items in batches with individual error handling"
    example: |
      async processDashboardsBatch(dashboards: Dashboard[]): Promise<void> {
        const results = await Promise.allSettled(
          dashboards.map(dashboard => this.processDashboard(dashboard)),
        );

        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
          this.logger.warn(
            `Batch processing completed with ${failures.length} failures`,
            failures.map(f => f.reason),
          );
        }
      }

  graceful_degradation:
    - "Log errors but continue processing remaining items"
    - "Track success/failure metrics for monitoring"
    - "Don't let one failure stop entire batch"
    - "Provide summary statistics in logs"
```

## 🔌 External API Integration

```yaml
grafana_client_usage:
  import_pattern: "Always use GrafanaClient from @perfana/shared"
  example: |
    import { GrafanaClient } from '@perfana/shared/services/grafana';

    @Injectable()
    export class GrafanaApiService {
      private clients: Map<string, GrafanaClient> = new Map();

      async getClient(instance: GrafanaInstance): Promise<GrafanaClient> {
        const key = instance.id;

        if (!this.clients.has(key)) {
          const client = new GrafanaClient({
            url: instance.url,
            apiKey: instance.apiKey,
            timeout: 30000,
          });
          this.clients.set(key, client);
        }

        return this.clients.get(key);
      }
    }

  error_handling:
    - "Wrap all external API calls in try-catch"
    - "Log request details for debugging"
    - "Handle rate limiting with backoff"
    - "Validate response structure before processing"

  timeouts:
    default: "30 seconds for most operations"
    bulk_operations: "60 seconds for bulk fetches"
    configuration: "Make timeouts configurable"
```

## 🗄️ Database Access Patterns

```yaml
database_patterns:
  entity_imports:
    source: "Always import entities from @perfana/shared"
    example: |
      import {
        GrafanaInstance,
        GrafanaDashboard,
        ApplicationDashboard,
        TestRun,
      } from '@perfana/shared/entities';

  repository_pattern:
    injection: "Inject TypeORM repositories via @InjectRepository"
    example: |
      import { InjectRepository } from '@nestjs/typeorm';
      import { Repository } from 'typeorm';
      import { GrafanaInstance } from '@perfana/shared/entities';

      @Injectable()
      export class GrafanaSyncService {
        constructor(
          @InjectRepository(GrafanaInstance)
          private readonly instanceRepo: Repository<GrafanaInstance>,
        ) {}
      }

  query_optimization:
    - "Use select queries to fetch only needed fields"
    - "Implement pagination for large result sets"
    - "Use proper indexes (defined in entities)"
    - "Avoid N+1 queries with proper joins"

  transactions:
    pattern: "Use transactions for related updates"
    example: |
      await this.dataSource.transaction(async (manager) => {
        await manager.save(GrafanaDashboard, dashboards);
        await manager.save(ApplicationDashboard, configs);
      });
```

## 🧪 Testing Standards

```yaml
testing_standards:
  test_utilities:
    location: "test/helpers.ts for shared test utilities"
    mock_factories: "Provide factory functions for creating test entities"
    example: |
      export function createMockGrafanaInstance(
        overrides?: Partial<GrafanaInstance>,
      ): GrafanaInstance {
        return {
          id: 'test-instance-id',
          name: 'Test Grafana',
          url: 'http://localhost:3000',
          apiKey: 'test-api-key',
          enabled: true,
          ...overrides,
        } as GrafanaInstance;
      }

  unit_testing:
    framework: "Jest with NestJS testing utilities"
    mocking: "Mock all external dependencies (database, Grafana API, config)"
    structure: |
      describe('GrafanaSyncService', () => {
        let service: GrafanaSyncService;
        let instanceRepo: Repository<GrafanaInstance>;
        let grafanaApiService: GrafanaApiService;

        beforeEach(async () => {
          const module: TestingModule = await Test.createTestingModule({
            providers: [
              GrafanaSyncService,
              {
                provide: getRepositoryToken(GrafanaInstance),
                useValue: mockRepository,
              },
              {
                provide: GrafanaApiService,
                useValue: mockGrafanaApiService,
              },
            ],
          }).compile();

          service = module.get<GrafanaSyncService>(GrafanaSyncService);
        });

        it('should sync dashboards from enabled instances', async () => {
          // Arrange
          const mockInstances = [createMockGrafanaInstance()];
          jest.spyOn(instanceRepo, 'find').mockResolvedValue(mockInstances);

          // Act
          await service.syncDashboards();

          // Assert
          expect(grafanaApiService.fetchDashboards).toHaveBeenCalled();
        });
      });

  coverage_requirements:
    minimum: "80% code coverage for core services"
    focus_areas:
      - "Scheduled task logic"
      - "Retry and error handling"
      - "Configuration detection algorithms"
      - "Batch processing logic"
```

## 📝 Configuration Management

```yaml
configuration_management:
  structure:
    separate_files: "One config file per feature module"
    validation: "Use Joi for environment variable validation"
    defaults: "Provide sensible defaults for all optional settings"

  environment_variables:
    naming_convention: "SCREAMING_SNAKE_CASE with feature prefix"
    examples:
      - "GRAFANA_SYNC_ENABLED"
      - "AUTO_CONFIG_CONFIDENCE_THRESHOLD"
      - "SANITY_CHECK_INTERVAL_MINUTES"

  joi_validation:
    example: |
      import * as Joi from 'joi';

      export const grafanaSyncValidationSchema = Joi.object({
        GRAFANA_SYNC_ENABLED: Joi.boolean().default(true),
        GRAFANA_SYNC_INTERVAL_MINUTES: Joi.number().min(1).max(1440).default(60),
        GRAFANA_SYNC_BATCH_SIZE: Joi.number().min(1).max(100).default(10),
        GRAFANA_SYNC_CONCURRENT_REQUESTS: Joi.number().min(1).max(20).default(5),
      });

  configuration_usage:
    injection: "Inject ConfigService to access configuration"
    type_safety: "Use generics for type-safe config access"
    example: |
      constructor(private readonly configService: ConfigService) {}

      getSyncInterval(): number {
        return this.configService.get<number>('GRAFANA_SYNC_INTERVAL_MINUTES', 60);
      }
```

## 📊 Logging Standards

```yaml
logging_standards:
  logger_instance:
    pattern: "Create logger instance per service/module"
    example: |
      import { Logger } from '@nestjs/common';

      @Injectable()
      export class GrafanaSyncService {
        private readonly logger = new Logger(GrafanaSyncService.name);
      }

  log_levels:
    debug: "Detailed execution flow, variable values"
    log: "Normal operations, scheduled task execution"
    warn: "Recoverable errors, degraded functionality"
    error: "Unrecoverable errors, task failures"

  structured_logging:
    context: "Include relevant context in log messages"
    example: |
      this.logger.log(`Starting dashboard sync for instance: ${instance.name}`);
      this.logger.warn(
        `Failed to sync dashboard ${dashboard.uid} from ${instance.name}`,
        error.message,
      );
      this.logger.error(
        `Dashboard sync failed for instance ${instance.name}`,
        error.stack,
      );

  sensitive_data:
    - "Never log API keys or credentials"
    - "Redact sensitive configuration values"
    - "Use object IDs instead of full objects in logs"
```

## 🏥 Health Checks & Monitoring

```yaml
health_checks:
  implementation:
    pattern: "Implement health check endpoint for container orchestration"
    example: |
      @Controller('health')
      export class HealthController {
        @Get()
        check() {
          return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            service: 'grafana-sync',
          };
        }
      }

  monitoring_metrics:
    track:
      - "Dashboard sync success/failure counts"
      - "Auto-config detection accuracy"
      - "Sanity check findings"
      - "API call latencies"
      - "Batch processing times"

  alerting:
    - "Alert on consecutive sync failures"
    - "Alert on high sanity check error counts"
    - "Alert on service health check failures"
```

## 🔒 Security Considerations

```yaml
security:
  api_credentials:
    storage: "Store Grafana API keys in database, never in code"
    access: "Encrypt sensitive configuration in database"
    rotation: "Support API key rotation without downtime"

  input_validation:
    - "Validate all data from external APIs"
    - "Sanitize dashboard names and descriptions"
    - "Validate JSON structure before parsing"

  error_messages:
    - "Don't expose internal paths in error messages"
    - "Sanitize error messages before logging"
    - "Don't leak credentials in stack traces"
```

## 📋 Code Review Checklist

```yaml
code_review_checklist:
  scheduled_tasks:
    - "Feature enable/disable check at task start"
    - "Comprehensive error handling with try-catch"
    - "Appropriate logging at start and completion"
    - "No uncaught exceptions that could crash service"

  configuration:
    - "All settings configurable via environment variables"
    - "Sensible defaults provided"
    - "Configuration validated at startup"
    - "Settings documented in README"

  error_handling:
    - "Retry logic for transient failures"
    - "Graceful degradation on errors"
    - "Detailed error logging with context"
    - "Metrics tracked for monitoring"

  database_access:
    - "Entities imported from @perfana/shared"
    - "Repositories properly injected"
    - "Queries optimized with proper indexes"
    - "Transactions used for related updates"

  testing:
    - "Unit tests for core logic"
    - "Mocks for external dependencies"
    - "Test coverage above 80%"
    - "Test utilities used for consistency"

  logging:
    - "Appropriate log levels used"
    - "No sensitive data in logs"
    - "Sufficient context provided"
    - "Error stack traces included"
```

## 🤖 Claude Code Specific Instructions

```yaml
claude_code_instructions:
  scheduled_task_development:
    - "Always implement configuration checks before task execution"
    - "Use try-catch blocks around entire task logic"
    - "Log task start, completion, and any errors"
    - "Design for graceful degradation on failures"

  configuration_first:
    - "Make all behavior configurable"
    - "Provide sensible defaults"
    - "Validate configuration at startup"
    - "Document all environment variables"

  resilience_patterns:
    - "Implement retry logic for external API calls"
    - "Use batch processing with individual error handling"
    - "Track metrics for monitoring"
    - "Never let one failure stop entire process"

  shared_package_usage:
    - "Always import entities from @perfana/shared"
    - "Use GrafanaClient from @perfana/shared/services/grafana"
    - "Never duplicate entity definitions"
    - "Keep shared code in shared package"

  testing_approach:
    - "Write tests alongside implementation"
    - "Use test helpers from test/helpers.ts"
    - "Mock all external dependencies"
    - "Maintain high test coverage"
```

## 🎯 Quality Gates

```yaml
quality_gates:
  before_commit:
    - "All TypeScript compilation passes"
    - "All unit tests passing"
    - "ESLint checks passing"
    - "No console.log statements"
    - "Configuration documented"

  before_deployment:
    - "Health check endpoint responds"
    - "All environment variables validated"
    - "Database migrations tested"
    - "Scheduled tasks execute without errors"
    - "Monitoring and alerting configured"
```

---

**Remember**: This service runs in the background performing scheduled tasks. Reliability, observability, and resilience are paramount. Always design for failure scenarios, implement comprehensive logging, and make everything configurable.
