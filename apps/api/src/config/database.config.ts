import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { createTypeOrmConfig, parseSslConfig } from '@perfana/shared/config';

/**
 * Creates database configuration for the API application
 * Uses shared TypeORM configuration factory from @perfana/shared
 */
export const createDatabaseConfig = (configService: ConfigService): TypeOrmModuleOptions => {
  // Parse SSL configuration from environment variable
  const dbSslValue = configService.get<string>('DB_SSL', 'false');
  const sslConfig = parseSslConfig(dbSslValue);

  // Create configuration using shared factory
  return createTypeOrmConfig({
    host: configService.get<string>('DB_HOST', 'localhost'),
    port: configService.get<number>('DB_PORT', 5432),
    username: configService.get<string>('DB_USERNAME', 'perfana'),
    password: configService.get<string>('DB_PASSWORD', 'perfana_dev_password'),
    database: configService.get<string>('DB_NAME', 'perfana'),
    ssl: sslConfig,
    nodeEnv: configService.get<string>('NODE_ENV'),
    poolSize: configService.get<number>('DB_POOL_SIZE'),
  });
};