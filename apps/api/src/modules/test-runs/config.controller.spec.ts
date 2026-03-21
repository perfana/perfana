import { Test, TestingModule } from '@nestjs/testing';
import { ConfigController } from './controllers/config.controller';
import { TestRunsService } from './test-runs.service';
import {
  AddTestRunConfigDto,
  AddTestRunConfigsDto,
  AddTestRunConfigJsonDto,
} from './dto/test-run-config.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('ConfigController', () => {
  let controller: ConfigController;
  let service: jest.Mocked<TestRunsService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  const mockSystemsSummary = [
    {
      id: 'sys-1',
      name: 'PaymentService',
      environments: [
        {
          environment: 'production',
          workloads: ['loadTest', 'stressTest'],
        },
        {
          environment: 'staging',
          workloads: ['smokeTest'],
        },
      ],
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      id: 'sys-2',
      name: 'OrderService',
      environments: [
        {
          environment: 'production',
          workloads: ['loadTest'],
        },
      ],
      created_at: '2024-01-14T10:00:00Z',
    },
  ];

  const mockServiceFactory = () => ({
    getSystemsSummary: jest.fn(),
    addTestRunConfig: jest.fn(),
    addTestRunConfigs: jest.fn(),
    addTestRunConfigJson: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        {
          provide: TestRunsService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<ConfigController>(ConfigController);
    service = module.get(TestRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - Systems Summary', () => {
    describe('getSystemsSummary', () => {
      it('should return all systems with environments and workloads', async () => {
        // Arrange
        service.getSystemsSummary.mockResolvedValue(mockSystemsSummary);

        // Act
        const result = await controller.getSystemsSummary(undefined, mockUserContext);

        // Assert
        expect(result).toEqual(mockSystemsSummary);
        expect(result).toHaveLength(2);
        expect(result[0]?.environments).toHaveLength(2);
        expect(result[0]?.environments[0]?.workloads).toHaveLength(2);
        expect(service.getSystemsSummary).toHaveBeenCalledWith(mockUserContext.userId, mockUserContext.roles, undefined);
        expect(service.getSystemsSummary).toHaveBeenCalledTimes(1);
      });

      it('should return empty array when no systems exist', async () => {
        // Arrange
        service.getSystemsSummary.mockResolvedValue([]);

        // Act
        const result = await controller.getSystemsSummary(undefined, mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });

      it('should return system with no environments', async () => {
        // Arrange
        const systemWithNoEnvs = [
          {
            id: 'sys-1',
            name: 'NewService',
            environments: [],
            created_at: '2024-01-15T10:00:00Z',
          },
        ];
        service.getSystemsSummary.mockResolvedValue(systemWithNoEnvs);

        // Act
        const result = await controller.getSystemsSummary(undefined, mockUserContext);

        // Assert
        expect(result).toEqual(systemWithNoEnvs);
        expect(result[0]?.environments).toHaveLength(0);
      });
    });
  });

  describe('Happy Path - Add Single Configuration', () => {
    describe('addTestRunConfig', () => {
      it('should add a single configuration key-value pair', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance', 'production'],
          key: 'jvm.heap.size',
          value: '2048m',
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
        expect(service.addTestRunConfig).toHaveBeenCalledWith(configDto);
        expect(service.addTestRunConfig).toHaveBeenCalledTimes(1);
      });

      it('should add configuration with numeric value', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          key: 'database.pool.size',
          value: '50',
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
        expect(service.addTestRunConfig).toHaveBeenCalledWith(configDto);
      });

      it('should add configuration with boolean value', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['feature'],
          key: 'feature.newPaymentGateway.enabled',
          value: 'true',
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
      });

      it('should add configuration with empty value', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: [],
          key: 'optional.config',
          value: '',
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
      });

      it('should add configuration with nested key notation', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['database'],
          key: 'spring.datasource.hikari.maximum-pool-size',
          value: '20',
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
      });
    });
  });

  describe('Happy Path - Add Multiple Configurations', () => {
    describe('addTestRunConfigs', () => {
      it('should add multiple configuration key-value pairs', async () => {
        // Arrange
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance', 'production'],
          configItems: [
            { key: 'jvm.heap.size', value: '2048m' },
            { key: 'database.pool.size', value: '50' },
            { key: 'cache.ttl', value: '3600' },
          ],
        };
        service.addTestRunConfigs.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigs(configsDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pairs added',
        });
        expect(service.addTestRunConfigs).toHaveBeenCalledWith(configsDto);
        expect(service.addTestRunConfigs).toHaveBeenCalledTimes(1);
        expect(configsDto.configItems).toHaveLength(3);
      });

      it('should add single configuration item in batch format', async () => {
        // Arrange
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          configItems: [{ key: 'jvm.heap.size', value: '2048m' }],
        };
        service.addTestRunConfigs.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigs(configsDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pairs added',
        });
        expect(configsDto.configItems).toHaveLength(1);
      });

      it('should add many configuration items (bulk update)', async () => {
        // Arrange
        const manyConfigs = Array.from({ length: 50 }, (_, i) => ({
          key: `config.key${i}`,
          value: `value${i}`,
        }));
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['bulk'],
          configItems: manyConfigs,
        };
        service.addTestRunConfigs.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigs(configsDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pairs added',
        });
        expect(configsDto.configItems).toHaveLength(50);
      });

      it('should add configurations with mixed value types', async () => {
        // Arrange
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['mixed'],
          configItems: [
            { key: 'jvm.heap.size', value: '2048m' },
            { key: 'database.pool.size', value: '50' },
            { key: 'feature.enabled', value: 'true' },
            { key: 'api.url', value: 'https://api.example.com' },
            { key: 'timeout', value: '30000' },
          ],
        };
        service.addTestRunConfigs.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigs(configsDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pairs added',
        });
        expect(configsDto.configItems).toHaveLength(5);
      });
    });
  });

  describe('Happy Path - Add Configuration from JSON', () => {
    describe('addTestRunConfigJson', () => {
      it('should add configuration from JSON with include patterns', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance', 'production'],
          includes: ['jvm.*', 'database.*'],
          excludes: ['*.password', '*.secret'],
          json: {
            jvm: {
              heap: { size: '2048m', type: 'G1GC' },
              gc: { threads: 4 },
            },
            database: {
              pool: { size: 50, timeout: 30 },
              url: 'jdbc:postgresql://localhost:5432/perfana',
              password: 'secret123',
            },
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
        expect(service.addTestRunConfigJson).toHaveBeenCalledWith(configJsonDto);
        expect(service.addTestRunConfigJson).toHaveBeenCalledTimes(1);
      });

      it('should add configuration with simple JSON structure', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['simple'],
          includes: ['*'],
          excludes: [],
          json: {
            heapSize: '2048m',
            poolSize: 50,
            enabled: true,
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
      });

      it('should add configuration with nested JSON structure', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['nested'],
          includes: ['*'],
          excludes: [],
          json: {
            application: {
              server: {
                port: 8080,
                ssl: {
                  enabled: true,
                  keyStore: '/path/to/keystore',
                },
              },
              database: {
                primary: {
                  host: 'db1.example.com',
                  port: 5432,
                },
                replica: {
                  host: 'db2.example.com',
                  port: 5432,
                },
              },
            },
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
      });

      it('should add configuration with include/exclude patterns', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['filtered'],
          includes: ['spring.*', 'server.*'],
          excludes: ['*.password', '*.secret', '*.key'],
          json: {
            spring: { profiles: { active: 'production' } },
            server: { port: 8080 },
            database: { password: 'secret', url: 'jdbc:...' },
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
        expect(configJsonDto.includes).toHaveLength(2);
        expect(configJsonDto.excludes).toHaveLength(3);
      });

      it('should add configuration with multiple include patterns', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['multi-pattern'],
          includes: ['jvm.*', 'spring.*', 'server.*', 'database.*', 'cache.*'],
          excludes: ['*.password'],
          json: {
            jvm: { heap: '2048m' },
            spring: { profiles: 'prod' },
            server: { port: 8080 },
            database: { pool: 50 },
            cache: { ttl: 3600 },
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
        expect(configJsonDto.includes).toHaveLength(5);
      });

      it('should add configuration with empty excludes', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['no-excludes'],
          includes: ['*'],
          excludes: [],
          json: { config: { key: 'value' } },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
        expect(configJsonDto.excludes).toHaveLength(0);
      });
    });
  });

  describe('Error Scenarios - Service Failures', () => {
    describe('getSystemsSummary', () => {
      it('should propagate service errors', async () => {
        // Arrange
        const serviceError = new Error('Database connection failed');
        service.getSystemsSummary.mockRejectedValue(serviceError);

        // Act & Assert
        await expect(controller.getSystemsSummary(undefined, mockUserContext)).rejects.toThrow(
          'Database connection failed',
        );
      });
    });

    describe('addTestRunConfig', () => {
      it('should propagate service errors', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          key: 'jvm.heap.size',
          value: '2048m',
        };
        const serviceError = new Error('Test run not found');
        service.addTestRunConfig.mockRejectedValue(serviceError);

        // Act & Assert
        await expect(controller.addTestRunConfig(configDto)).rejects.toThrow(
          'Test run not found',
        );
      });

      it('should propagate validation errors', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          key: 'invalid-key!',
          value: '2048m',
        };
        const validationError = new Error('Invalid configuration key format');
        service.addTestRunConfig.mockRejectedValue(validationError);

        // Act & Assert
        await expect(controller.addTestRunConfig(configDto)).rejects.toThrow(
          'Invalid configuration key format',
        );
      });
    });

    describe('addTestRunConfigs', () => {
      it('should propagate service errors for bulk operations', async () => {
        // Arrange
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          configItems: [
            { key: 'jvm.heap.size', value: '2048m' },
            { key: 'database.pool.size', value: '50' },
          ],
        };
        const serviceError = new Error('Database transaction failed');
        service.addTestRunConfigs.mockRejectedValue(serviceError);

        // Act & Assert
        await expect(controller.addTestRunConfigs(configsDto)).rejects.toThrow(
          'Database transaction failed',
        );
      });
    });

    describe('addTestRunConfigJson', () => {
      it('should propagate service errors for JSON import', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          includes: ['*'],
          excludes: [],
          json: { key: 'value' },
        };
        const serviceError = new Error('Invalid JSON structure');
        service.addTestRunConfigJson.mockRejectedValue(serviceError);

        // Act & Assert
        await expect(controller.addTestRunConfigJson(configJsonDto)).rejects.toThrow(
          'Invalid JSON structure',
        );
      });

      it('should propagate ReDoS validation errors', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['performance'],
          includes: ['(a+)+'],
          excludes: [],
          json: { key: 'value' },
        };
        const redosError = new Error('Malicious regex detected');
        service.addTestRunConfigJson.mockRejectedValue(redosError);

        // Act & Assert
        await expect(controller.addTestRunConfigJson(configJsonDto)).rejects.toThrow(
          'Malicious regex detected',
        );
      });
    });
  });

  describe('Edge Cases', () => {
    describe('getSystemsSummary', () => {
      it('should handle system with single environment', async () => {
        // Arrange
        const singleEnvSystem = [
          {
            id: 'sys-1',
            name: 'SimpleService',
            environments: [
              {
                environment: 'production',
                workloads: ['loadTest'],
              },
            ],
            created_at: '2024-01-15T10:00:00Z',
          },
        ];
        service.getSystemsSummary.mockResolvedValue(singleEnvSystem);

        // Act
        const result = await controller.getSystemsSummary(undefined, mockUserContext);

        // Assert
        expect(result).toEqual(singleEnvSystem);
        expect(result[0]?.environments).toHaveLength(1);
      });

      it('should handle environment with single workload', async () => {
        // Arrange
        const singleWorkloadSystem = [
          {
            id: 'sys-1',
            name: 'SimpleService',
            environments: [
              {
                environment: 'production',
                workloads: ['loadTest'],
              },
            ],
            created_at: '2024-01-15T10:00:00Z',
          },
        ];
        service.getSystemsSummary.mockResolvedValue(singleWorkloadSystem);

        // Act
        const result = await controller.getSystemsSummary(undefined, mockUserContext);

        // Assert
        expect(result[0]?.environments[0]?.workloads).toHaveLength(1);
      });
    });

    describe('addTestRunConfig', () => {
      it('should handle very long configuration value', async () => {
        // Arrange
        const longValue = 'A'.repeat(4000); // Very long value
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['long-value'],
          key: 'long.config',
          value: longValue,
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
        expect(configDto.value).toHaveLength(4000);
      });

      it('should handle configuration with special characters in value', async () => {
        // Arrange
        const configDto: AddTestRunConfigDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['special-chars'],
          key: 'connection.string',
          value: 'Server=tcp:db.example.com,1433;Initial Catalog=DB;User ID=admin;Password=P@ssw0rd!',
        };
        service.addTestRunConfig.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfig(configDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pair added',
        });
      });
    });

    describe('addTestRunConfigs', () => {
      it('should handle configuration with duplicate keys', async () => {
        // Arrange
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['duplicates'],
          configItems: [
            { key: 'jvm.heap.size', value: '2048m' },
            { key: 'jvm.heap.size', value: '4096m' }, // Duplicate key, different value
          ],
        };
        service.addTestRunConfigs.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigs(configsDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pairs added',
        });
        expect(configsDto.configItems).toHaveLength(2);
      });
    });

    describe('addTestRunConfigJson', () => {
      it('should handle JSON with array values', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['arrays'],
          includes: ['*'],
          excludes: [],
          json: {
            servers: ['server1.example.com', 'server2.example.com'],
            ports: [8080, 8081, 8082],
            features: ['payment', 'refund', 'subscription'],
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
      });

      it('should handle JSON with null values', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['nulls'],
          includes: ['*'],
          excludes: [],
          json: {
            optionalConfig: null,
            enabledFeature: true,
            disabledFeature: null,
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
      });

      it('should handle deeply nested JSON structure', async () => {
        // Arrange
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['deep-nested'],
          includes: ['*'],
          excludes: [],
          json: {
            level1: {
              level2: {
                level3: {
                  level4: {
                    level5: {
                      level6: {
                        level7: {
                          level8: {
                            level9: {
                              level10: {
                                deepValue: 'nested-config',
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
      });
    });
  });

  describe('Boundary Values', () => {
    describe('addTestRunConfigs', () => {
      it('should handle maximum configuration items (200)', async () => {
        // Arrange
        const maxConfigs = Array.from({ length: 200 }, (_, i) => ({
          key: `config.key.${i}`,
          value: `value${i}`,
        }));
        const configsDto: AddTestRunConfigsDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['max-configs'],
          configItems: maxConfigs,
        };
        service.addTestRunConfigs.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigs(configsDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config key value pairs added',
        });
        expect(configsDto.configItems).toHaveLength(200);
      });
    });

    describe('addTestRunConfigJson', () => {
      it('should handle maximum include patterns (20)', async () => {
        // Arrange
        const maxIncludes = Array.from({ length: 20 }, (_, i) => `pattern${i}.*`);
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['max-includes'],
          includes: maxIncludes,
          excludes: [],
          json: { config: 'value' },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
        expect(configJsonDto.includes).toHaveLength(20);
      });

      it('should handle maximum exclude patterns (20)', async () => {
        // Arrange
        const maxExcludes = Array.from({ length: 20 }, (_, i) => `*.exclude${i}`);
        const configJsonDto: AddTestRunConfigJsonDto = {
          application: 'PaymentService',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: 'PaymentService-production-loadTest-001',
          tags: ['max-excludes'],
          includes: ['*'],
          excludes: maxExcludes,
          json: { config: 'value' },
        };
        service.addTestRunConfigJson.mockResolvedValue(undefined);

        // Act
        const result = await controller.addTestRunConfigJson(configJsonDto);

        // Assert
        expect(result).toEqual({
          message: 'Test run config json added',
        });
        expect(configJsonDto.excludes).toHaveLength(20);
      });
    });
  });
});
