import { faker } from '@faker-js/faker';

export interface TestUserData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  passwordHash?: string;
  isActive?: boolean;
  emailVerified?: boolean;
}

export interface TestTestRunData {
  testRunId: string;
  applicationName: string;
  environment: string;
  version: string;
  buildNumber?: string;
  branchName?: string;
  commitHash?: string;
  tags?: Record<string, any>;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  resultStatus?: 'success' | 'failure' | 'unstable';
  startTime?: Date;
  endTime?: Date;
  durationMs?: number;
  notes?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
}

export interface TestApiKeyData {
  key: string;
  description: string;
  isActive?: boolean;
  expiresAt?: Date;
  createdBy?: string;
}

export interface TestConfigData {
  testRunId?: string;
  key: string;
  value: string;
  category?: string;
  isSensitive?: boolean;
}

export class TestDataFactory {
  static createUser(overrides: Partial<TestUserData> = {}): TestUserData {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();

    return {
      email,
      password: 'TestPassword123!',
      firstName,
      lastName,
      isActive: true,
      emailVerified: false,
      ...overrides,
    };
  }

  static createMultipleUsers(count: number, overrides: Partial<TestUserData> = {}): TestUserData[] {
    return Array.from({ length: count }, () => this.createUser(overrides));
  }

  static createTestRun(overrides: Partial<TestTestRunData> = {}): TestTestRunData {
    const appName = faker.company.name().toLowerCase().replace(/\s+/g, '-');
    const environment = faker.helpers.arrayElement(['dev', 'test', 'staging', 'prod']);
    const version = faker.system.semver();

    return {
      testRunId: `${appName}-${environment}-${faker.string.uuid()}`,
      applicationName: appName,
      environment,
      version,
      buildNumber: faker.number.int({ min: 1000, max: 9999 }).toString(),
      branchName: faker.helpers.arrayElement(['main', 'develop', 'feature/test', 'hotfix/bug']),
      commitHash: faker.git.commitSha(),
      tags: {
        team: faker.helpers.arrayElement(['backend', 'frontend', 'qa', 'devops']),
        priority: faker.helpers.arrayElement(['high', 'medium', 'low']),
      },
      status: faker.helpers.arrayElement(['running', 'completed', 'failed', 'cancelled']),
      resultStatus: faker.helpers.arrayElement(['success', 'failure', 'unstable']),
      startTime: faker.date.recent({ days: 7 }),
      endTime: faker.date.recent({ days: 1 }),
      durationMs: faker.number.int({ min: 60000, max: 3600000 }), // 1 min to 1 hour
      notes: faker.lorem.sentence(),
      metadata: {
        triggeredBy: faker.helpers.arrayElement(['schedule', 'manual', 'webhook']),
        platform: faker.helpers.arrayElement(['linux', 'windows', 'macos']),
      },
      ...overrides,
    };
  }

  static createMultipleTestRuns(count: number, overrides: Partial<TestTestRunData> = {}): TestTestRunData[] {
    return Array.from({ length: count }, () => this.createTestRun(overrides));
  }

  static createApiKey(overrides: Partial<TestApiKeyData> = {}): TestApiKeyData {
    const description = faker.lorem.words(3);
    const uuid = faker.string.uuid();
    const key = Buffer.from(`${description}#${uuid}`).toString('base64');

    return {
      key,
      description: `Test API Key - ${description}`,
      isActive: true,
      expiresAt: faker.date.future({ years: 1 }),
      ...overrides,
    };
  }

  static createMultipleApiKeys(count: number, overrides: Partial<TestApiKeyData> = {}): TestApiKeyData[] {
    return Array.from({ length: count }, () => this.createApiKey(overrides));
  }

  static createConfiguration(overrides: Partial<TestConfigData> = {}): TestConfigData {
    const categories = ['system', 'database', 'security', 'performance', 'logging'];
    const keyPrefix = faker.helpers.arrayElement(['app', 'db', 'auth', 'cache', 'api']);
    const keySuffix = faker.helpers.arrayElement(['url', 'timeout', 'enabled', 'size', 'limit']);

    return {
      key: `${keyPrefix}.${keySuffix}`,
      value: this.generateConfigValue(),
      category: faker.helpers.arrayElement(categories),
      isSensitive: faker.datatype.boolean(0.2), // 20% chance of being sensitive
      ...overrides,
    };
  }

  static createMultipleConfigurations(count: number, overrides: Partial<TestConfigData> = {}): TestConfigData[] {
    return Array.from({ length: count }, () => this.createConfiguration(overrides));
  }

  private static generateConfigValue(): string {
    const valueTypes = [
      () => faker.internet.url(),
      () => faker.number.int({ min: 1, max: 10000 }).toString(),
      () => faker.datatype.boolean().toString(),
      () => faker.lorem.word(),
      () => faker.system.filePath(),
      () => faker.internet.ipv4(),
      () => faker.string.uuid(),
    ];

    return faker.helpers.arrayElement(valueTypes)();
  }

  // Utility methods for creating related data sets
  static createUserWithTestRuns(userOverrides: Partial<TestUserData> = {}, testRunCount = 3): {
    user: TestUserData;
    testRuns: TestTestRunData[];
  } {
    const user = this.createUser(userOverrides);
    const testRuns = this.createMultipleTestRuns(testRunCount, {
      // Will be set after user creation when we have the actual user ID
    });

    return { user, testRuns };
  }

  static createTestRunWithConfigurations(
    testRunOverrides: Partial<TestTestRunData> = {},
    configCount = 5
  ): {
    testRun: TestTestRunData;
    configurations: TestConfigData[];
  } {
    const testRun = this.createTestRun(testRunOverrides);
    const configurations = this.createMultipleConfigurations(configCount, {
      // Will be set after test run creation when we have the actual test run ID
    });

    return { testRun, configurations };
  }

  static createUserWithApiKeys(userOverrides: Partial<TestUserData> = {}, apiKeyCount = 2): {
    user: TestUserData;
    apiKeys: TestApiKeyData[];
  } {
    const user = this.createUser(userOverrides);
    const apiKeys = this.createMultipleApiKeys(apiKeyCount, {
      // Will be set after user creation when we have the actual user ID
    });

    return { user, apiKeys };
  }

  // Deterministic data for regression tests
  static createDeterministicUser(suffix = ''): TestUserData {
    return {
      email: `test.user${suffix}@regression.test`,
      password: 'RegressionTest123!',
      firstName: 'Test',
      lastName: `User${suffix}`,
      isActive: true,
      emailVerified: false,
    };
  }

  static createDeterministicTestRun(suffix = ''): TestTestRunData {
    return {
      testRunId: `regression-test-run${suffix}`,
      applicationName: `regression-app${suffix}`,
      environment: 'test',
      version: '1.0.0',
      buildNumber: '1001',
      branchName: 'main',
      commitHash: 'abc123def456',
      tags: {
        type: 'regression',
        automated: true,
      },
      status: 'completed',
      resultStatus: 'success',
      startTime: new Date('2024-01-01T10:00:00Z'),
      endTime: new Date('2024-01-01T11:00:00Z'),
      durationMs: 3600000,
      notes: 'Regression test run',
      metadata: {
        triggeredBy: 'automation',
        platform: 'linux',
      },
    };
  }

  static createDeterministicApiKey(suffix = ''): TestApiKeyData {
    const description = `regression-key${suffix}`;
    const uuid = `00000000-0000-0000-0000-00000000000${suffix.padStart(1, '0')}`;
    const key = Buffer.from(`${description}#${uuid}`).toString('base64');

    return {
      key,
      description: `Regression API Key ${suffix}`,
      isActive: true,
      expiresAt: new Date('2025-01-01T00:00:00Z'),
    };
  }

  static createDeterministicConfiguration(key: string, value: string): TestConfigData {
    return {
      key,
      value,
      category: 'system',
      isSensitive: false,
    };
  }

  // Data validation helpers
  static validateUser(user: any): boolean {
    return !!(
      user &&
      user.email &&
      user.firstName &&
      user.lastName &&
      typeof user.isActive === 'boolean'
    );
  }

  static validateTestRun(testRun: any): boolean {
    return !!(
      testRun &&
      testRun.testRunId &&
      testRun.applicationName &&
      testRun.environment &&
      testRun.status &&
      ['running', 'completed', 'failed', 'cancelled'].includes(testRun.status)
    );
  }

  static validateApiKey(apiKey: any): boolean {
    return !!(
      apiKey &&
      apiKey.key &&
      apiKey.description &&
      typeof apiKey.isActive === 'boolean'
    );
  }

  static validateConfiguration(config: any): boolean {
    return !!(
      config &&
      config.key &&
      config.value &&
      typeof config.isSensitive === 'boolean'
    );
  }
}