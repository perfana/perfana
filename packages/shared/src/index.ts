// Main barrel export for @perfana/shared

// Export entities (TypeORM)
export * from './entities';

// Export types
export * from './types';

// Export configuration
export * from './config';

// Export repositories
export * from './repositories';

// Export database utilities
export * from './database';

// Export realtime services
export * from './realtime';

// Export schemas
export * from './schemas';

// Export utilities
export * from './utils';

// Export security utilities (SSRF protection, URL validation)
export * from './security';

// Export constants
export * from './constants';

// Note: Services are NOT exported from the main barrel to avoid bundling
// server-only dependencies (like undici) in client builds.
// Use dedicated import paths instead:
//   - import { GrafanaClient } from '@perfana/shared/services/grafana'