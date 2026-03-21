import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Bootstrap script to create an initial admin API key
 * Run with: npx ts-node -r tsconfig-paths/register create-admin-api-key.ts
 */
async function createAdminApiKey() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana',
    database: process.env.DB_NAME || 'perfana_native',
    synchronize: false,
    logging: false,
  });

  try {
    console.log('📦 Connecting to database...');
    await dataSource.initialize();
    console.log('✅ Connected to database');

    // Generate UUID
    const id = crypto.randomUUID();
    const description = 'Bootstrap Admin API Key';

    // Create token in format: base64(description#uuid)
    const token = Buffer.from(`${description}#${id}`).toString('base64');

    // Hash the token using bcrypt (same as the service does)
    const hashedToken = await bcrypt.hash(token, 10);

    // Set validity for 1 year from now
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    // Insert the API key
    await dataSource.query(`
      INSERT INTO api_keys (
        id,
        description,
        api_key,
        roles,
        valid_until,
        created_at,
        last_used
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
    `, [id, description, hashedToken, ['perfana-admin'], validUntil]);

    console.log('\n✅ Admin API key created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 API Key Details:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`ID:          ${id}`);
    console.log(`Description: ${description}`);
    console.log(`Roles:       perfana-admin`);
    console.log(`Valid Until: ${validUntil.toISOString()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🔑 Bearer Token (use this in Authorization header):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`${token}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📝 Usage Example:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('curl -H "Authorization: Bearer ' + token + '" \\');
    console.log('     http://localhost:3001/api/api-keys');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n⚠️  IMPORTANT: Save this token now! It cannot be retrieved later.\n');

    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Failed to create admin API key:', error);
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    process.exit(1);
  }
}

createAdminApiKey();
