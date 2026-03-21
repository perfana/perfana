export const testRunConfigFixtures = {
  // Single config DTO fixture
  singleConfig: {
    application: 'ecommerce-api',
    testEnvironment: 'staging',
    testType: 'load-test',
    testRunId: 'load-test-2024-01-15-14-30-001',
    tags: ['performance', 'regression', 'staging'],
    key: 'jvm.heap.max',
    value: '4096m',
  },

  // Multiple configs DTO fixture
  multipleConfigs: {
    application: 'payment-service',
    testEnvironment: 'production',
    testType: 'stress-test',
    testRunId: 'stress-test-2024-01-15-16-45-002',
    tags: ['stress', 'production', 'critical'],
    configItems: [
      { key: 'jvm.heap.initial', value: '1024m' },
      { key: 'jvm.heap.max', value: '2048m' },
      { key: 'jvm.gc.type', value: 'G1GC' },
      { key: 'database.connection.pool.min', value: '5' },
      { key: 'database.connection.pool.max', value: '20' },
      { key: 'database.connection.timeout', value: '30000' },
      { key: 'cache.redis.max.connections', value: '50' },
      { key: 'cache.redis.timeout', value: '5000' },
    ],
  },

  // JSON config DTO fixture
  jsonConfig: {
    application: 'user-service',
    testEnvironment: 'production',
    testType: 'endurance-test',
    testRunId: 'endurance-test-2024-01-15-20-00-003',
    tags: ['endurance', 'production', 'long-running'],
    includes: ['jvm.*', 'database.*', 'cache.*', 'server.*'],
    excludes: ['*.password', '*.secret', '*.key', '*.token'],
    json: {
      jvm: {
        heap: {
          initial: '2048m',
          max: '8192m',
          ratio: 0.75,
        },
        gc: {
          type: 'G1GC',
          threads: 8,
          maxPauseTime: 200,
          enabled: true,
        },
        metaspace: {
          size: '256m',
          maxSize: '512m',
        },
      },
      database: {
        primary: {
          host: 'db-primary.internal',
          port: 5432,
          pool: {
            min: 10,
            max: 50,
            idle: 30000,
            acquire: 60000,
          },
          ssl: true,
          password: 'secret123', // Should be excluded
        },
        replica: {
          host: 'db-replica.internal',
          port: 5432,
          readOnly: true,
          pool: {
            min: 5,
            max: 25,
          },
        },
      },
      cache: {
        redis: {
          cluster: {
            nodes: ['redis1:6379', 'redis2:6379', 'redis3:6379'],
            maxConnections: 100,
            retryDelayOnFailover: 1000,
          },
          keyPrefix: 'userservice:',
          ttl: {
            session: 3600,
            userProfile: 1800,
            permissions: 300,
          },
          auth: {
            password: 'redis-secret', // Should be excluded
          },
        },
      },
      server: {
        http: {
          port: 8080,
          maxConnections: 1000,
          keepAlive: true,
          timeout: 120000,
        },
        metrics: {
          enabled: true,
          port: 9090,
          path: '/metrics',
        },
        logging: {
          level: 'info',
          format: 'json',
          maxFiles: 10,
          maxSize: '100MB',
        },
      },
      security: {
        jwt: {
          secret: 'jwt-secret-key', // Should be excluded
          expiresIn: '24h',
        },
        apiKey: 'super-secret-api-key', // Should be excluded
      },
    },
  },

  // Edge case: Empty config items
  emptyConfigs: {
    application: 'minimal-service',
    testEnvironment: 'development',
    testType: 'unit-test',
    testRunId: 'unit-test-2024-01-15-10-00-004',
    tags: ['unit', 'development'],
    configItems: [],
  },

  // Edge case: Malicious regex patterns
  maliciousRegexConfig: {
    application: 'test-service',
    testEnvironment: 'security-test',
    testType: 'security-test',
    testRunId: 'security-test-2024-01-15-22-00-005',
    tags: ['security', 'test'],
    includes: ['(a+)+$'], // ReDoS vulnerability pattern
    excludes: ['safe.*'],
    json: {
      test: {
        value: 'should not be processed',
      },
    },
  },

  // Edge case: Complex nested JSON
  deepNestedConfig: {
    application: 'complex-service',
    testEnvironment: 'integration',
    testType: 'integration-test',
    testRunId: 'integration-test-2024-01-15-18-30-006',
    tags: ['integration', 'complex'],
    includes: ['level.*'],
    excludes: ['level3.secret.*'],
    json: {
      level1: {
        level2: {
          level3: {
            config: 'value',
            secret: 'hidden', // Should be excluded
            nested: {
              level4: {
                config: 'deep-value',
                array: [1, 2, 3],
                boolean: true,
                null_value: null,
                undefined_value: undefined,
              },
            },
          },
          other: 'value',
        },
        direct: 'config',
      },
    },
  },

  // Expected flattened results for testing
  expectedFlattenedResults: {
    jsonConfig: {
      'jvm.heap.initial': '2048m',
      'jvm.heap.max': '8192m',
      'jvm.heap.ratio': '0.75',
      'jvm.gc.type': 'G1GC',
      'jvm.gc.threads': '8',
      'jvm.gc.maxPauseTime': '200',
      'jvm.gc.enabled': 'true',
      'jvm.metaspace.size': '256m',
      'jvm.metaspace.maxSize': '512m',
      'database.primary.host': 'db-primary.internal',
      'database.primary.port': '5432',
      'database.primary.pool.min': '10',
      'database.primary.pool.max': '50',
      'database.primary.pool.idle': '30000',
      'database.primary.pool.acquire': '60000',
      'database.primary.ssl': 'true',
      'database.replica.host': 'db-replica.internal',
      'database.replica.port': '5432',
      'database.replica.readOnly': 'true',
      'database.replica.pool.min': '5',
      'database.replica.pool.max': '25',
      'cache.redis.cluster.maxConnections': '100',
      'cache.redis.cluster.retryDelayOnFailover': '1000',
      'cache.redis.keyPrefix': 'userservice:',
      'cache.redis.ttl.session': '3600',
      'cache.redis.ttl.userProfile': '1800',
      'cache.redis.ttl.permissions': '300',
      'server.http.port': '8080',
      'server.http.maxConnections': '1000',
      'server.http.keepAlive': 'true',
      'server.http.timeout': '120000',
      'server.metrics.enabled': 'true',
      'server.metrics.port': '9090',
      'server.metrics.path': '/metrics',
      'server.logging.level': 'info',
      'server.logging.format': 'json',
      'server.logging.maxFiles': '10',
      'server.logging.maxSize': '100MB',
    },
  },

  // Invalid DTO fixtures for validation testing
  invalidDtos: {
    missingApplication: {
      testEnvironment: 'production',
      testType: 'load-test',
      testRunId: 'test-001',
      tags: ['test'],
      key: 'config.key',
      value: 'config.value',
    },
    invalidTags: {
      application: 'test-app',
      testEnvironment: 'production',
      testType: 'load-test',
      testRunId: 'test-001',
      tags: 'not-an-array', // Should be array
      key: 'config.key',
      value: 'config.value',
    },
    emptyConfigItems: {
      application: 'test-app',
      testEnvironment: 'production',
      testType: 'load-test',
      testRunId: 'test-001',
      tags: ['test'],
      configItems: [], // Should have at least one item
    },
    nonObjectJson: {
      application: 'test-app',
      testEnvironment: 'production',
      testType: 'load-test',
      testRunId: 'test-001',
      tags: ['test'],
      includes: ['*'],
      excludes: [],
      json: 'not-an-object', // Should be object
    },
  },
};

export const databaseFixtures = {
  // Expected database record structure
  expectedConfigRecord: {
    application: 'ecommerce-api',
    test_environment: 'staging',
    test_type: 'load-test',
    test_run_id: 'load-test-2024-01-15-14-30-001',
    tags: ['performance', 'regression', 'staging'],
    key: 'jvm.heap.max',
    value: '4096m',
    created_at: expect.any(String),
    updated_at: expect.any(String),
  },

  // Multiple expected records
  expectedMultipleRecords: [
    {
      application: 'payment-service',
      test_environment: 'production',
      test_type: 'stress-test',
      test_run_id: 'stress-test-2024-01-15-16-45-002',
      tags: ['stress', 'production', 'critical'],
      key: 'jvm.heap.initial',
      value: '1024m',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    },
    {
      application: 'payment-service',
      test_environment: 'production',
      test_type: 'stress-test',
      test_run_id: 'stress-test-2024-01-15-16-45-002',
      tags: ['stress', 'production', 'critical'],
      key: 'jvm.heap.max',
      value: '2048m',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    },
  ],
};