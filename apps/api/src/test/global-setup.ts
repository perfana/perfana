import { DataSource, EntitySchema } from 'typeorm';

// Import all entities (both API-specific and shared) from the test entities barrel
// This ensures all entities are loaded as classes, allowing TypeORM to properly resolve relationships
const allEntities = require('./test-entities');

type EntityType = Function | string | EntitySchema;

/**
 * Global setup for Jest integration tests
 * This runs ONCE before all test suites
 * Initializes the test database schema using synchronize (not migrations)
 *
 * For tests, we use synchronize:true to auto-create tables from entities
 * This is faster and avoids complex migration SQL parsing issues
 */
export default async (): Promise<void> => {
  console.log('\n🔧 Setting up test database...');

  // Get all entity classes as an array
  const entityClasses = Object.values(allEntities).filter(
    (value) => typeof value === 'function' && value.prototype
  );

  const entities: EntityType[] = entityClasses as EntityType[];

  console.log(`  Found ${entities.length} total entities`);

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || 'perfana_test',
    entities: entities,
    synchronize: true, // Auto-create schema from entities for tests
    dropSchema: true, // Drop existing schema first for clean state
    logging: false,
  });

  try {
    // Initialize the data source (this will auto-create tables)
    await dataSource.initialize();
    console.log('  ✓ Connected to database');
    console.log('  ✓ Database schema synchronized from entities');

    // Close the connection
    await dataSource.destroy();
    console.log('  ✓ Database setup complete\n');
  } catch (error) {
    console.error('❌ Failed to set up test database:', error);
    throw error;
  }
};
