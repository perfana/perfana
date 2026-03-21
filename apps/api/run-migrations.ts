import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as path from 'path';

/**
 * Standalone migration runner script
 * Run with: npx ts-node -r tsconfig-paths/register run-migrations.ts
 */
async function runMigrations() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || 'perfana_native',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities: [],
    migrations: [path.resolve(__dirname, '../../packages/shared/dist/database/migrations/*.js')],
    synchronize: false,
    logging: ['error', 'warn', 'migration', 'schema'],
  });

  try {
    console.log('📦 Initializing database connection...');
    await dataSource.initialize();
    console.log('✅ Connected to database:', process.env.DB_NAME || 'perfana_native');

    console.log('\n🔍 Checking pending migrations...');
    const pendingMigrations = await dataSource.showMigrations();

    if (pendingMigrations) {
      console.log('⚠️  Pending migrations found');
      console.log('\n🚀 Running migrations...');
      const migrations = await dataSource.runMigrations({ transaction: 'each' });

      if (migrations.length === 0) {
        console.log('✅ No migrations to run (already up to date)');
      } else {
        console.log(`✅ Successfully ran ${migrations.length} migration(s):`);
        migrations.forEach((migration) => {
          console.log(`   - ${migration.name}`);
        });
      }
    } else {
      console.log('✅ Database is up to date');
    }

    await dataSource.destroy();
    console.log('\n✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    process.exit(1);
  }
}

runMigrations();
