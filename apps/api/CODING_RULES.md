# NestJS & Claude Code: Best-in-Class Coding Rules

## 🎯 Core Principles

```yaml
core_principles:
  type_safety_first: "Always use TypeScript with strict mode enabled"
  dependency_injection: "Leverage NestJS DI container for all services"
  modular_architecture: "Design with clear module boundaries and separation of concerns"
  testing_pyramid: "Unit tests > Integration tests > E2E tests"
  api_first_design: "OpenAPI/Swagger documentation for all endpoints"
  security_by_default: "Implement authentication, authorization, and input validation"
  observability: "Structured logging, metrics, and health checks"
  database_safety: "Use TypeORM migrations and proper transaction handling"
```

## 📁 Project Structure

```yaml
project_structure:
  src:
    main_ts: "Application bootstrap and configuration"
    app_module_ts: "Root application module"
    modules:
      feature_modules: "Business domain modules (users, auth, orders, etc.)"
      shared_modules: "Cross-cutting concerns (database, config, etc.)"
    common:
      decorators: "Custom decorators"
      dto: "Data Transfer Objects"
      entities: "Database entities"
      enums: "Enumeration types"
      exceptions: "Custom exception classes"
      filters: "Exception filters"
      guards: "Authentication and authorization guards"
      interceptors: "Request/response interceptors"
      interfaces: "TypeScript interfaces"
      middleware: "Custom middleware"
      pipes: "Validation and transformation pipes"
      utils: "Utility functions"
    config: "Configuration management"
    database:
      migrations: "Database migration files"
      seeds: "Database seeding"
    test:
      e2e: "End-to-end tests"
      unit: "Unit test utilities"
      integration: "Integration test utilities"
```

## 🔧 TypeScript Configuration

```yaml
typescript_config:
  tsconfig_requirements:
    strict: true
    strictNullChecks: true
    noImplicitAny: true
    noImplicitReturns: true
    noImplicitThis: true
    noUnusedLocals: true
    noUnusedParameters: true
    exactOptionalPropertyTypes: true
    noUncheckedIndexedAccess: true
    experimentalDecorators: true
    emitDecoratorMetadata: true
    resolveJsonModule: true
    esModuleInterop: true
    allowSyntheticDefaultImports: true

  type_definition_rules:
    - "Define explicit return types for all methods"
    - "Use proper generic constraints"
    - "Create dedicated DTOs for request/response objects"
    - "Use TypeORM entity typing properly"
    - "Implement proper error typing with custom exceptions"

  decorator_usage:
    - "Use appropriate NestJS decorators (@Injectable, @Controller, etc.)"
    - "Implement custom decorators for cross-cutting concerns"
    - "Use validation decorators from class-validator"
    - "Implement OpenAPI decorators for documentation"
```

## 🏗️ NestJS Architecture Patterns

```yaml
nestjs_patterns:
  module_structure:
    feature_modules: |
      @Module({
        imports: [TypeOrmModule.forFeature([UserEntity])],
        controllers: [UserController],
        providers: [UserService, UserRepository],
        exports: [UserService],
      })
      export class UserModule {}

  service_layer:
    business_logic: "Implement core business logic in services"
    dependency_injection: "Use constructor injection for all dependencies"
    interface_segregation: "Define interfaces for external dependencies"
    single_responsibility: "Each service should have one clear purpose"

  controller_layer:
    route_handling: "Handle HTTP requests and responses only"
    validation: "Use DTOs with class-validator for input validation"
    error_handling: "Let exception filters handle errors"
    documentation: "Use Swagger decorators for API documentation"

  repository_pattern:
    data_access: "Abstract database operations behind repositories"
    query_builder: "Use TypeORM QueryBuilder for complex queries"
    transactions: "Implement proper transaction handling"
    entity_relationships: "Define proper entity relationships"
```

## 🛡️ Security Implementation

```yaml
security_implementation:
  authentication:
    jwt_strategy: "Use Passport JWT strategy for token validation"
    guards: "Implement JwtAuthGuard for protected routes"
    refresh_tokens: "Implement refresh token rotation"
    password_hashing: "Use bcrypt for password hashing"

  authorization:
    rbac: "Role-Based Access Control implementation"
    guards: "Custom authorization guards for different permission levels"
    decorators: "Custom decorators for role checking (@Roles, @Permissions)"

  input_validation:
    class_validator: "Use class-validator for DTO validation"
    sanitization: "Sanitize user input to prevent injection attacks"
    rate_limiting: "Implement rate limiting for API endpoints"
    cors: "Proper CORS configuration"

  data_protection:
    - "Never log sensitive information"
    - "Use environment variables for secrets"
    - "Implement proper session management"
    - "Use HTTPS in production"
    - "Implement CSRF protection where needed"
```

## 🗄️ Database & TypeORM Patterns

```yaml
database_patterns:
  entity_design:
    base_entity: "Use abstract base entity with common fields"
    relationships: "Define bidirectional relationships properly"
    constraints: "Use database constraints for data integrity"
    indexes: "Add appropriate database indexes"
    example: |
      @Entity('users')
      export class UserEntity extends BaseEntity {
        @PrimaryGeneratedColumn('uuid')
        id: string;

        @Column({ unique: true })
        @Index()
        email: string;

        @Column()
        password: string;

        @CreateDateColumn()
        createdAt: Date;

        @UpdateDateColumn()
        updatedAt: Date;

        @OneToMany(() => OrderEntity, order => order.user)
        orders: OrderEntity[];
      }

  migration_management:
    - "Always use migrations for schema changes"
    - "Never modify existing migrations"
    - "Test migrations in development first"
    - "Provide rollback strategies"
    - "Use descriptive migration names"

  repository_pattern:
    custom_repositories: "Extend TypeORM Repository for complex queries"
    query_optimization: "Use proper joins and indexing"
    transaction_handling: "Use @Transaction decorator for atomicity"
    soft_deletes: "Implement soft deletes where appropriate"
```

## 🧪 Testing Standards

```yaml
testing_standards:
  testing_pyramid:
    unit_tests: "70% - Test individual components in isolation"
    integration_tests: "20% - Test component interactions"
    e2e_tests: "10% - Test complete user journeys"

  unit_testing:
    framework: "Jest with NestJS testing utilities"
    mocking: "Mock external dependencies and services"
    coverage: "Maintain minimum 80% code coverage"
    structure: |
      describe('UserService', () => {
        let service: UserService;
        let repository: Repository<UserEntity>;

        beforeEach(async () => {
          const module: TestingModule = await Test.createTestingModule({
            providers: [
              UserService,
              {
                provide: getRepositoryToken(UserEntity),
                useClass: Repository,
              },
            ],
          }).compile();

          service = module.get<UserService>(UserService);
          repository = module.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
        });

        it('should create a user', async () => {
          const userData = { email: 'test@example.com', password: 'password' };
          const savedUser = { id: '1', ...userData };
          
          jest.spyOn(repository, 'save').mockResolvedValue(savedUser as UserEntity);
          
          const result = await service.createUser(userData);
          expect(result).toEqual(savedUser);
        });
      });

  integration_testing:
    database: "Use test database or in-memory database"
    modules: "Test module integration with TestingModule"
    repositories: "Test repository methods with real database"

  e2e_testing:
    framework: "Jest with Supertest"
    test_app: "Use NestJS testing app instance"
    database_state: "Reset database state between tests"
    authentication: "Test authentication flows"
```

## 📝 API Design & Documentation

```yaml
api_design:
  rest_principles:
    - "Use appropriate HTTP methods (GET, POST, PUT, DELETE, PATCH)"
    - "Return proper HTTP status codes"
    - "Use consistent URL naming conventions"
    - "Implement proper pagination for collections"
    - "Use appropriate HTTP headers"

  dto_patterns:
    request_dtos: "Validate and type incoming requests"
    response_dtos: "Shape outgoing responses consistently"
    validation: "Use class-validator decorators"
    transformation: "Use class-transformer for serialization"
    example: |
      export class CreateUserDto {
        @IsEmail()
        @ApiProperty({ description: 'User email address' })
        email: string;

        @IsString()
        @MinLength(8)
        @ApiProperty({ description: 'User password', minLength: 8 })
        password: string;

        @IsOptional()
        @IsString()
        @ApiProperty({ description: 'User display name', required: false })
        name?: string;
      }

  swagger_documentation:
    - "Document all endpoints with @ApiOperation"
    - "Define response schemas with @ApiResponse"
    - "Use @ApiProperty for DTO properties"
    - "Group endpoints with @ApiTags"
    - "Provide examples for complex objects"

  error_responses:
    consistent_format: "Use consistent error response structure"
    error_codes: "Implement custom error codes for different scenarios"
    validation_errors: "Return detailed validation error messages"
    example: |
      {
        "statusCode": 400,
        "message": "Validation failed",
        "error": "Bad Request",
        "details": [
          {
            "field": "email",
            "message": "Invalid email format"
          }
        ],
        "timestamp": "2024-01-01T00:00:00.000Z",
        "path": "/users"
      }
```

## 🔄 Exception Handling & Logging

```yaml
exception_handling:
  custom_exceptions:
    - "Create domain-specific exception classes"
    - "Extend NestJS built-in exceptions where appropriate"
    - "Include relevant context in exception messages"
    - "Use proper HTTP status codes"

  exception_filters:
    global_filter: "Implement global exception filter for consistent error responses"
    logging: "Log errors with appropriate levels"
    sanitization: "Sanitize error messages before sending to client"
    example: |
      @Catch()
      export class GlobalExceptionFilter implements ExceptionFilter {
        private readonly logger = new Logger(GlobalExceptionFilter.name);

        catch(exception: unknown, host: ArgumentsHost) {
          const ctx = host.switchToHttp();
          const response = ctx.getResponse<Response>();
          const request = ctx.getRequest<Request>();

          let status: number;
          let message: string;
          let error: string;

          if (exception instanceof HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();
            message = typeof exceptionResponse === 'string' 
              ? exceptionResponse 
              : (exceptionResponse as any).message;
            error = exception.name;
          } else {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
            message = 'Internal server error';
            error = 'InternalServerError';
            this.logger.error(`Unexpected error: ${exception}`, (exception as Error).stack);
          }

          response.status(status).json({
            statusCode: status,
            message,
            error,
            timestamp: new Date().toISOString(),
            path: request.url,
          });
        }
      }

  logging_strategy:
    structured_logging: "Use structured logging with Winston or similar"
    log_levels: "Use appropriate log levels (error, warn, info, debug)"
    correlation_ids: "Implement request correlation IDs"
    sensitive_data: "Never log passwords or sensitive information"
```

## ⚡ Performance & Optimization

```yaml
performance_optimization:
  database_optimization:
    - "Use database indexes appropriately"
    - "Implement query optimization"
    - "Use lazy loading for relationships"
    - "Implement proper pagination"
    - "Use connection pooling"

  caching_strategies:
    redis_cache: "Use Redis for distributed caching"
    cache_invalidation: "Implement proper cache invalidation strategies"
    decorators: "Use @CacheKey and @CacheTTL decorators"
    example: |
      @Injectable()
      export class UserService {
        @CacheKey('user')
        @CacheTTL(300) // 5 minutes
        async getUserById(id: string): Promise<UserEntity> {
          return this.userRepository.findOne({ where: { id } });
        }
      }

  async_processing:
    queues: "Use Bull or similar for job queues"
    background_tasks: "Implement background task processing"
    event_handling: "Use event-driven architecture where appropriate"

  monitoring:
    health_checks: "Implement health check endpoints"
    metrics: "Collect application metrics"
    performance_monitoring: "Monitor response times and database queries"
```

## 🔒 Configuration Management

```yaml
configuration_management:
  environment_variables:
    validation: "Validate all environment variables at startup"
    types: "Use proper types for configuration values"
    schema: "Define configuration schema with Joi or class-validator"
    example: |
      @Injectable()
      export class ConfigValidation {
        @IsString()
        @IsNotEmpty()
        DATABASE_URL: string;

        @IsNumber()
        @Min(1)
        @Max(65535)
        PORT: number;

        @IsString()
        @IsNotEmpty()
        JWT_SECRET: string;

        @IsOptional()
        @IsIn(['development', 'production', 'test'])
        NODE_ENV: string = 'development';
      }

  configuration_service:
    centralized: "Use NestJS ConfigService for all configuration access"
    type_safety: "Provide type-safe configuration getters"
    defaults: "Define sensible default values"
    secrets: "Keep secrets separate from regular config"

  feature_flags:
    - "Implement feature toggles for gradual rollouts"
    - "Use environment-based feature flags"
    - "Document all feature flags and their purposes"
```

## 🔍 Observability & Monitoring

```yaml
observability:
  logging:
    structured: "Use structured logging (JSON format)"
    context: "Include request context in logs"
    correlation: "Implement correlation IDs for request tracing"
    levels: "Use appropriate log levels"

  metrics:
    application_metrics: "Track application-specific metrics"
    business_metrics: "Monitor business KPIs"
    system_metrics: "Monitor system resource usage"
    custom_metrics: "Implement custom Prometheus metrics"

  tracing:
    distributed_tracing: "Implement distributed tracing with OpenTelemetry"
    request_tracing: "Trace requests through the application"
    database_tracing: "Monitor database query performance"

  health_checks:
    liveness: "Implement liveness probes"
    readiness: "Implement readiness probes"
    dependencies: "Check external dependency health"
    example: |
      @Controller('health')
      export class HealthController {
        constructor(
          private health: HealthCheckService,
          private db: TypeOrmHealthIndicator,
          private redis: RedisHealthIndicator,
        ) {}

        @Get()
        @HealthCheck()
        check() {
          return this.health.check([
            () => this.db.pingCheck('database'),
            () => this.redis.checkHealth('redis'),
          ]);
        }
      }
```

## 📋 Code Review Checklist

```yaml
code_review_checklist:
  architecture:
    - "Module boundaries are respected"
    - "Dependency injection is used properly"
    - "Single Responsibility Principle is followed"
    - "Interfaces are used for external dependencies"

  security:
    - "Input validation is implemented"
    - "Authentication and authorization are properly handled"
    - "Sensitive data is not logged"
    - "SQL injection prevention measures are in place"

  database:
    - "Database operations are properly abstracted"
    - "Transactions are used where appropriate"
    - "Migrations are properly structured"
    - "Entity relationships are defined correctly"

  testing:
    - "Unit tests cover business logic"
    - "Integration tests cover module interactions"
    - "E2E tests cover critical user journeys"
    - "Mocks are used appropriately"

  documentation:
    - "API endpoints are documented with Swagger"
    - "Complex business logic is commented"
    - "README files are updated"
    - "Configuration options are documented"

  performance:
    - "Database queries are optimized"
    - "Caching is implemented where appropriate"
    - "Memory leaks are prevented"
    - "Resource cleanup is implemented"

  error_handling:
    - "Errors are handled consistently"
    - "Error messages are user-friendly"
    - "Logging includes sufficient context"
    - "Exception filters are used properly"
```

## 🚀 Deployment & DevOps

```yaml
deployment_devops:
  docker_configuration:
    multi_stage: "Use multi-stage Docker builds"
    optimization: "Optimize image size and layers"
    security: "Run as non-root user"
    health_checks: "Include Docker health checks"

  environment_management:
    - "Separate configurations for different environments"
    - "Use container orchestration (Kubernetes/Docker Compose)"
    - "Implement proper secret management"
    - "Use environment-specific database configurations"

  ci_cd_pipeline:
    automated_testing: "Run all tests in CI pipeline"
    code_quality: "Include linting and formatting checks"
    security_scanning: "Implement security vulnerability scanning"
    deployment_automation: "Automate deployment processes"

  monitoring_production:
    - "Set up application performance monitoring"
    - "Implement error tracking and alerting"
    - "Monitor business metrics and KPIs"
    - "Set up log aggregation and analysis"
```

## 🤖 Claude Code Specific Instructions

```yaml
claude_code_instructions:
  development_workflow:
    - "Always start by understanding the module structure and dependencies"
    - "Follow NestJS architectural patterns consistently"
    - "Implement proper error handling and validation"
    - "Write tests for all new functionality"
    - "Use TypeScript strict mode without exceptions"

  api_development:
    - "Create DTOs for all request/response objects"
    - "Implement proper validation using class-validator"
    - "Document all endpoints with Swagger decorators"
    - "Handle errors consistently across all endpoints"
    - "Implement proper authentication and authorization"

  database_operations:
    - "Use TypeORM entities and repositories properly"
    - "Create migrations for all schema changes"
    - "Implement proper transaction handling"
    - "Optimize database queries and add appropriate indexes"
    - "Test database operations with integration tests"

  security_considerations:
    - "Validate and sanitize all user input"
    - "Implement proper authentication and authorization"
    - "Use environment variables for all secrets"
    - "Follow OWASP security guidelines"
    - "Never log sensitive information"

  quality_standards:
    - "Maintain high code coverage with meaningful tests"
    - "Follow consistent naming conventions"
    - "Implement proper logging and error handling"
    - "Use dependency injection appropriately"
    - "Document complex business logic"
```

## 🎯 Quality Gates

```yaml
quality_gates:
  before_commit:
    - "All TypeScript compilation errors resolved"
    - "All unit tests passing"
    - "ESLint/Prettier formatting applied"
    - "No console.log statements in production code"
    - "All environment variables validated"

  before_merge:
    - "Code review completed and approved"
    - "All tests passing (unit, integration, e2e)"
    - "Security vulnerabilities addressed"
    - "Documentation updated"
    - "Breaking changes documented"

  before_deployment:
    - "Health check endpoints respond correctly"
    - "Database migrations tested"
    - "Environment-specific configurations verified"
    - "Monitoring and alerting configured"
    - "Rollback plan documented"

  continuous_monitoring:
    - "Application performance within acceptable limits"
    - "Error rates below defined thresholds"
    - "Security scans passing"
    - "Dependencies up to date and secure"
    - "Database performance optimized"
```

---

**Remember**: Build scalable, maintainable, and secure APIs. Always prioritize type safety, proper error handling, and comprehensive testing. Quality over speed - it's better to build robust, well-tested features than quick, fragile implementations.