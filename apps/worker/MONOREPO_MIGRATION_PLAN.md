# Monorepo Migration Plan
**Project**: Perfana Next-Gen
**Date**: October 21, 2025
**Author**: Claude Code
**Estimated Total Time**: 2-3 days

## Executive Summary

Migrate `perfana-ds-worker` from standalone repository into the `perfana-next-gen` monorepo to enable code sharing, especially for TypeORM entities, types, and database configuration.

**Current State**:
```
/Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker/  # Standalone
/Users/daniel/workspace/perfana-next-gen/apps/api/              # Monorepo
```

**Target State**:
```
/Users/daniel/workspace/perfana-next-gen/
├── apps/
│   ├── api/          # Existing
│   └── worker/       # Migrated from perfana-ds-worker
└── packages/
    └── shared/       # New shared package
```

## Goals

1. ✅ Share TypeORM entities, types, and repositories
2. ✅ Maintain git history for both projects
3. ✅ Zero downtime (existing deployments continue working)
4. ✅ Preserve all functionality
5. ✅ Improve development velocity

## Prerequisites

### 1. Backup Current State
```bash
# Create backups
cd /Users/daniel/workspace
tar -czf perfana-ds-worker-backup-2025-10-21.tar.gz perfana-ds-next-gen/perfana-ds-worker
tar -czf perfana-next-gen-backup-2025-10-21.tar.gz perfana-next-gen

# Verify backups
ls -lh *.tar.gz
```

### 2. Commit All Pending Changes
```bash
# In worker repo
cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
git status  # Should be clean (already done - Phase 1 committed)
git log -1  # Verify latest commit

# In main repo
cd /Users/daniel/workspace/perfana-next-gen
git status
git add -A && git commit -m "Pre-monorepo migration checkpoint" || echo "Already clean"
```

### 3. Verify Current Structure
```bash
# Document current API entities
cd /Users/daniel/workspace/perfana-next-gen/apps/api
find src/entities -name "*.entity.ts" | wc -l

# Document current worker entities
cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
find src/entities -name "*.entity.ts" | wc -l

# Save file list
tree -L 3 -I node_modules > /tmp/worker-structure-before.txt
```

---

## Phase 1: Prepare Monorepo Infrastructure
**Estimated Time**: 4 hours
**Branch**: `monorepo-setup`

### Step 1.1: Create Workspace Configuration (30 min)

**In**: `/Users/daniel/workspace/perfana-next-gen`

```bash
cd /Users/daniel/workspace/perfana-next-gen
git checkout -b monorepo-setup
```

**Create** `package.json` at root (if doesn't exist):
```json
{
  "name": "perfana-next-gen",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "dev": "npm run dev --workspaces --if-present",
    "lint": "npm run lint --workspaces",
    "type-check": "npm run type-check --workspaces"
  },
  "devDependencies": {
    "typescript": "^5.2.2",
    "@typescript-eslint/eslint-plugin": "^6.9.1",
    "@typescript-eslint/parser": "^6.9.1",
    "eslint": "^8.52.0",
    "prettier": "^3.0.3",
    "vitest": "^0.34.6"
  },
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

**Create** `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,

    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,

    "baseUrl": ".",
    "paths": {
      "@perfana/shared": ["./packages/shared/src"],
      "@perfana/shared/*": ["./packages/shared/src/*"]
    }
  },
  "exclude": ["node_modules", "dist", "build"]
}
```

**Create** `.eslintrc.json` at root:
```json
{
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "no-console": "warn"
  },
  "ignorePatterns": ["dist", "node_modules", "coverage"]
}
```

**Verify**:
```bash
npm install  # Install root dependencies
```

### Step 1.2: Create Shared Package Structure (1 hour)

**Create directory structure**:
```bash
cd /Users/daniel/workspace/perfana-next-gen
mkdir -p packages/shared/src/{entities,types,config,database/migrations,repositories}
```

**Create** `packages/shared/package.json`:
```json
{
  "name": "@perfana/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./entities": "./dist/entities/index.js",
    "./types": "./dist/types/index.js",
    "./config": "./dist/config/index.js",
    "./repositories": "./dist/repositories/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^10.2.0",
    "@nestjs/typeorm": "^11.0.0",
    "typeorm": "^0.3.27",
    "pg": "^8.11.3",
    "reflect-metadata": "^0.1.13",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.8.7",
    "@types/pg": "^8.10.7",
    "typescript": "^5.2.2"
  }
}
```

**Create** `packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": []
}
```

**Create** `packages/shared/src/index.ts`:
```typescript
// Main barrel export
export * from './entities';
export * from './types';
export * from './config';
export * from './repositories';
```

**Create placeholder files**:
```bash
touch packages/shared/src/entities/index.ts
touch packages/shared/src/types/index.ts
touch packages/shared/src/config/index.ts
touch packages/shared/src/repositories/index.ts
```

**Verify**:
```bash
cd packages/shared
npm install
npm run build  # Should compile successfully (empty files)
```

### Step 1.3: Update API to Use Workspace (1 hour)

**Update** `apps/api/package.json`:
```json
{
  "name": "@perfana/api",
  "version": "1.0.0",
  "dependencies": {
    "@perfana/shared": "workspace:*",
    // ... existing dependencies
  }
}
```

**Update** `apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "references": [
    { "path": "../../packages/shared" }
  ],
  "include": ["src/**/*"]
}
```

**Verify API still works**:
```bash
cd /Users/daniel/workspace/perfana-next-gen
npm install  # Install all workspace dependencies
cd apps/api
npm run type-check
npm run build
```

### Step 1.4: Commit Workspace Setup (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen
git add .
git commit -m "Setup monorepo workspace infrastructure

- Add root package.json with npm workspaces
- Create tsconfig.base.json for shared TypeScript config
- Create packages/shared package structure
- Update apps/api to use workspace references
- Add root ESLint configuration

Preparation for migrating perfana-ds-worker into monorepo."
```

---

## Phase 2: Migrate Worker Code (with Git History)
**Estimated Time**: 4 hours
**Branch**: Continue `monorepo-setup`

### Step 2.1: Prepare Worker for Migration (30 min)

**In worker repo**:
```bash
cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker

# Ensure clean state
git status  # Should show clean (Phase 1 committed)

# Create migration preparation commit
git checkout -b prepare-for-monorepo

# Update paths to be monorepo-compatible
# (We'll do this after moving)
```

### Step 2.2: Move Worker with Git History (1 hour)

**Option A: Git Subtree Merge (Recommended - Preserves History)**

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Add worker repo as remote
git remote add worker-repo /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
git fetch worker-repo

# Merge worker history into a subdirectory
git merge -s ours --no-commit --allow-unrelated-histories worker-repo/type-orm

# Read worker files into apps/worker
git read-tree --prefix=apps/worker/ -u worker-repo/type-orm

# Commit the merge
git commit -m "Merge perfana-ds-worker into monorepo as apps/worker

This merge preserves the full git history of the worker application.

Source: /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
Branch: type-orm
Commit: $(cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker && git rev-parse HEAD)

All worker functionality is preserved. Worker will be updated to use
shared packages in subsequent commits."

# Clean up remote
git remote remove worker-repo
```

**Option B: Simple Copy (Faster, Less History)**

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Create apps/worker directory
mkdir -p apps/worker

# Copy worker files (excluding git, node_modules)
rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' \
  /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker/ \
  apps/worker/

# Commit
git add apps/worker
git commit -m "Add perfana-ds-worker as apps/worker

Copied from: /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
Source commit: $(cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker && git rev-parse HEAD)
Source branch: type-orm

Full history preserved in original repository."
```

**Recommended**: Use **Option A** (subtree merge) to preserve history.

### Step 2.3: Update Worker Package.json (1 hour)

**Update** `apps/worker/package.json`:

```json
{
  "name": "@perfana/worker",
  "version": "1.0.0",
  "type": "module",
  "description": "Perfana DS Next-Gen Worker Application - Pipeline Processing",
  "main": "dist/worker.js",
  "scripts": {
    "dev": "tsx watch src/worker.ts",
    "build": "tsc",
    "start": "node dist/worker.js",
    "test": "vitest run",
    "test:unit": "vitest run --reporter=verbose",
    "test:integration": "vitest --config vitest.integration.config.ts run",
    "type-check": "tsc --noEmit",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix"
  },
  "dependencies": {
    "@perfana/shared": "workspace:*",
    "@nestjs/common": "^10.2.0",
    "@nestjs/config": "^3.1.0",
    "@nestjs/core": "^10.2.0",
    "@nestjs/typeorm": "^11.0.0",
    "axios": "^1.6.0",
    "bullmq": "^4.18.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "date-fns": "^2.30.0",
    "dotenv": "^17.2.2",
    "ioredis": "^5.8.0",
    "pg": "^8.11.3",
    "pino": "^8.16.1",
    "pino-pretty": "^10.2.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.27",
    "undici": "^7.16.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.2.0",
    "@nestjs/testing": "^10.2.0",
    "@types/node": "^20.8.7",
    "@types/pg": "^8.10.7",
    "@vitest/ui": "^0.34.6",
    "husky": "^9.1.7",
    "lint-staged": "^15.5.2",
    "pg-mem": "^2.6.13",
    "prettier": "^3.0.3",
    "tsx": "^4.0.0",
    "typescript": "^5.2.2",
    "vitest": "^0.34.6"
  }
}
```

**Update** `apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "@perfana/shared": ["../../packages/shared/src"],
      "@perfana/shared/*": ["../../packages/shared/src/*"]
    }
  },
  "references": [
    { "path": "../../packages/shared" }
  ],
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### Step 2.4: Verify Worker Builds (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Install all workspace dependencies
npm install

# Build shared package first
cd packages/shared
npm run build

# Build worker
cd ../apps/worker
npm run type-check  # Should pass
npm run build       # Should compile
```

### Step 2.5: Commit Worker Addition (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen
git add apps/worker
git commit -m "Configure apps/worker for monorepo workspace

- Update package.json to use @perfana/shared workspace dependency
- Update tsconfig.json to reference shared package
- Configure TypeScript paths for monorepo
- Update build scripts

Worker application now builds successfully in monorepo."
```

---

## Phase 3: Extract Shared Entities
**Estimated Time**: 6 hours
**Branch**: Continue `monorepo-setup`

### Step 3.1: Identify Common Entities (1 hour)

**Analyze entities in both projects**:

```bash
# List API entities
cd /Users/daniel/workspace/perfana-next-gen/apps/api
find src/entities -name "*.entity.ts" | sort > /tmp/api-entities.txt

# List worker entities
cd ../worker
find src/entities -name "*.entity.ts" | sort > /tmp/worker-entities.txt

# Compare
diff /tmp/api-entities.txt /tmp/worker-entities.txt

# Create checklist
cat > /tmp/entity-migration-checklist.md << 'EOF'
# Entity Migration Checklist

## Entities to Move to packages/shared

- [ ] ds-metrics.entity.ts
- [ ] test-run.entity.ts
- [ ] benchmark.entity.ts
- [ ] dashboard.entity.ts
- [ ] panel.entity.ts
- [ ] ds-statistics.entity.ts
- [ ] ds-adapt.entity.ts
- [ ] ds-checks.entity.ts
- [ ] ds-control-groups.entity.ts
- [ ] dynatrace-*.entity.ts
- [ ] ... (add all 31 entities)

## Verification
- [ ] All entities compile in shared package
- [ ] API imports work
- [ ] Worker imports work
- [ ] No duplicate definitions
EOF

cat /tmp/entity-migration-checklist.md
```

**Decision criteria**:
- If entity is in **both** API and worker → Move to shared
- If entity is **only** in worker → Keep in worker (for now)
- If entity is **only** in API → Keep in API (for now)

### Step 3.2: Move Core Entities to Shared (2 hours)

**Move entities** (assuming they're in worker - adjust path as needed):

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Move entities from worker to shared
mv apps/worker/src/entities/*.entity.ts packages/shared/src/entities/

# Create barrel export
cat > packages/shared/src/entities/index.ts << 'EOF'
// Core entities
export * from './test-run.entity';
export * from './benchmark.entity';
export * from './dashboard.entity';

// Metrics entities
export * from './ds-metrics.entity';
export * from './ds-statistics.entity';
export * from './ds-adapt.entity';
export * from './ds-checks.entity';
export * from './ds-control-groups.entity';
export * from './ds-control-group-statistics.entity';

// Panel entities
export * from './ds-panels.entity';
export * from './ds-panel-metrics.entity';

// Dynatrace entities
export * from './dynatrace-dql.entity';
export * from './dynatrace-metrics.entity';

// Add all other entities...
EOF
```

**Alternative if entities are in API**:
```bash
# Move from API instead
mv apps/api/src/entities/*.entity.ts packages/shared/src/entities/
```

**Build shared package**:
```bash
cd packages/shared
npm run build

# Should compile all entities successfully
```

### Step 3.3: Update Worker Imports (1.5 hours)

**Find all entity imports in worker**:
```bash
cd /Users/daniel/workspace/perfana-next-gen/apps/worker

# Find all files importing entities
grep -r "from.*entities.*entity" src/ --include="*.ts" | cut -d: -f1 | sort -u
```

**Update imports** (example for MetricsPipeline.ts):

```typescript
// Before
import { DsMetrics } from '../entities/ds-metrics.entity';
import { TestRun } from '../entities/test-run.entity';

// After
import { DsMetrics, TestRun } from '@perfana/shared/entities';
```

**Automated replacement**:
```bash
cd apps/worker

# Replace entity imports
find src -name "*.ts" -type f -exec sed -i '' \
  "s|from ['\"].*entities/\(.*\)\.entity['\"]|from '@perfana/shared/entities'|g" {} \;

# Manual cleanup may be needed for specific imports
```

**Verify**:
```bash
npm run type-check
npm run build
```

### Step 3.4: Update API Imports (1.5 hours)

**Same process for API**:

```bash
cd /Users/daniel/workspace/perfana-next-gen/apps/api

# Update imports
find src -name "*.ts" -type f -exec sed -i '' \
  "s|from ['\"].*entities/\(.*\)\.entity['\"]|from '@perfana/shared/entities'|g" {} \;

# Verify
npm run type-check
npm run build
```

### Step 3.5: Commit Shared Entities (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen

git add packages/shared/src/entities
git add apps/worker/src
git add apps/api/src
git commit -m "Extract TypeORM entities to shared package

Move all entity definitions from apps to packages/shared:
- 31 entity files moved to @perfana/shared/entities
- Update all imports in worker to use @perfana/shared/entities
- Update all imports in API to use @perfana/shared/entities

Benefits:
- Single source of truth for database schema
- No duplication between API and worker
- Type safety guaranteed across applications
- Easier to maintain and evolve schema

Verified:
✅ Shared package builds successfully
✅ Worker builds successfully
✅ API builds successfully"
```

---

## Phase 4: Extract Shared Types
**Estimated Time**: 2 hours
**Branch**: Continue `monorepo-setup`

### Step 4.1: Move Type Definitions (1 hour)

**Identify shared types**:
```bash
cd /Users/daniel/workspace/perfana-next-gen

# Compare types in both apps
ls apps/api/src/types/
ls apps/worker/src/types/
```

**Move common types**:
```bash
# Move pipeline types
mv apps/worker/src/types/pipeline.ts packages/shared/src/types/

# Move other common types
mv apps/worker/src/types/common.ts packages/shared/src/types/ 2>/dev/null || true

# Create barrel export
cat > packages/shared/src/types/index.ts << 'EOF'
export * from './pipeline';
export * from './common';
// Add other type exports
EOF
```

### Step 4.2: Update Type Imports (45 min)

**Worker**:
```bash
cd apps/worker

# Update type imports
find src -name "*.ts" -type f -exec sed -i '' \
  "s|from ['\"].*types/pipeline['\"]|from '@perfana/shared/types'|g" {} \;

npm run type-check
```

**API**:
```bash
cd apps/api

# Update type imports (if applicable)
find src -name "*.ts" -type f -exec sed -i '' \
  "s|from ['\"].*types/pipeline['\"]|from '@perfana/shared/types'|g" {} \;

npm run type-check
```

### Step 4.3: Commit Shared Types (15 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen

git add packages/shared/src/types
git add apps/worker/src apps/api/src
git commit -m "Extract type definitions to shared package

Move common type definitions to @perfana/shared/types:
- Pipeline types
- Common types
- Update imports in worker and API

Type safety preserved across applications."
```

---

## Phase 5: Extract Shared Configuration
**Estimated Time**: 3 hours
**Branch**: Continue `monorepo-setup`

### Step 5.1: Move TypeORM Configuration (1 hour)

**Create shared TypeORM config**:

```bash
cd /Users/daniel/workspace/perfana-next-gen/packages/shared/src/config
```

**Create** `typeorm.config.ts`:
```typescript
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as entities from '../entities';

export interface DatabaseConfig {
  url: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  poolSize?: number;
  nodeEnv?: string;
}

export const createTypeOrmConfig = (config: DatabaseConfig): TypeOrmModuleOptions => {
  // Parse SSL configuration
  let sslConfig: boolean | { rejectUnauthorized: boolean } = false;

  if (config.nodeEnv === 'production') {
    sslConfig = config.ssl ?? { rejectUnauthorized: true };
  }

  return {
    type: 'postgres',
    url: config.url,
    synchronize: false, // Schema managed by migrations
    logging: config.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
    ssl: sslConfig,
    extra: {
      timezone: 'UTC',
      max: config.poolSize || 50,
      min: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      statement_timeout: 300000,
      query_timeout: 300000,
    },
    entities: Object.values(entities),
  };
};
```

**Create** `packages/shared/src/config/index.ts`:
```typescript
export * from './typeorm.config';
```

### Step 5.2: Update Worker to Use Shared Config (45 min)

**Update** `apps/worker/src/config/typeorm.config.ts`:
```typescript
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { createTypeOrmConfig as createSharedConfig } from '@perfana/shared/config';
import { getConfig } from './environment.js';

export const createTypeOrmConfig = (): TypeOrmModuleOptions => {
  const config = getConfig();

  return createSharedConfig({
    url: config.DATABASE_URL,
    ssl: config.DB_SSL_REJECT_UNAUTHORIZED !== false
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: false },
    poolSize: config.DB_POOL_SIZE,
    nodeEnv: config.NODE_ENV,
  });
};
```

**Verify**:
```bash
cd apps/worker
npm run type-check
npm run build
```

### Step 5.3: Update API to Use Shared Config (45 min)

**Same process for API**:
```bash
cd apps/api
# Update typeorm.config.ts to use shared config
# Verify builds
npm run type-check
npm run build
```

### Step 5.4: Commit Shared Config (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen

git add packages/shared/src/config
git add apps/worker/src/config apps/api/src/config
git commit -m "Extract TypeORM configuration to shared package

Move database configuration logic to @perfana/shared/config:
- Shared TypeORM factory function
- Common database connection settings
- SSL configuration logic

Both API and worker now use identical database configuration."
```

---

## Phase 6: Extract Database Migrations
**Estimated Time**: 2 hours
**Branch**: Continue `monorepo-setup`

### Step 6.1: Consolidate Migrations (1 hour)

**Determine migration source**:
```bash
# Check which project has the authoritative migrations
ls apps/api/src/database/migrations/ 2>/dev/null || echo "No API migrations"
ls apps/worker/src/database/migrations/ 2>/dev/null || echo "No worker migrations"
```

**Move migrations to shared**:
```bash
cd /Users/daniel/workspace/perfana-next-gen

# Create migrations directory
mkdir -p packages/shared/src/database/migrations

# Copy migrations (adjust source as needed)
cp apps/api/src/database/migrations/*.ts packages/shared/src/database/migrations/ 2>/dev/null || true
```

### Step 6.2: Create Migration Scripts (45 min)

**Create** `packages/shared/src/database/index.ts`:
```typescript
export * from './migrations';
```

**Update root** `package.json`:
```json
{
  "scripts": {
    "migration:generate": "cd packages/shared && typeorm migration:generate",
    "migration:run": "cd packages/shared && typeorm migration:run",
    "migration:revert": "cd packages/shared && typeorm migration:revert"
  }
}
```

### Step 6.3: Commit Migrations (15 min)

```bash
git add packages/shared/src/database
git add package.json
git commit -m "Centralize database migrations in shared package

Move migrations to @perfana/shared/database:
- All migrations now in single location
- Add migration scripts to root package.json
- Both API and worker use same migrations

Single source of truth for database schema evolution."
```

---

## Phase 7: Extract Repositories (Optional)
**Estimated Time**: 2 hours
**Branch**: Continue `monorepo-setup`

### Step 7.1: Move Repository Classes (1 hour)

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Move repositories
mv apps/api/src/common/repositories/*.ts packages/shared/src/repositories/ 2>/dev/null || true

# Create barrel export
cat > packages/shared/src/repositories/index.ts << 'EOF'
export * from './test-run.repository';
export * from './metrics.repository';
// Add other repositories
EOF
```

### Step 7.2: Update Imports and Commit (1 hour)

```bash
# Update imports in both apps
cd apps/worker
find src -name "*.ts" -exec sed -i '' \
  "s|from ['\"].*repositories/\(.*\)['\"]|from '@perfana/shared/repositories'|g" {} \;

cd ../api
find src -name "*.ts" -exec sed -i '' \
  "s|from ['\"].*repositories/\(.*\)['\"]|from '@perfana/shared/repositories'|g" {} \;

# Verify
cd ../..
npm run type-check --workspaces

# Commit
git add packages/shared/src/repositories apps/*/src
git commit -m "Extract repository classes to shared package

Move repository implementations to @perfana/shared/repositories:
- Single source for data access logic
- Shared across API and worker
- Consistent data access patterns"
```

---

## Phase 8: Final Integration & Testing
**Estimated Time**: 4 hours
**Branch**: Continue `monorepo-setup`

### Step 8.1: Install All Dependencies (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Clean install
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -rf apps/*/package-lock.json packages/*/package-lock.json

# Install with workspaces
npm install

# Verify workspace linking
npm ls @perfana/shared --workspaces
```

### Step 8.2: Build All Packages (30 min)

```bash
# Build in dependency order
cd packages/shared
npm run build

cd ../../apps/api
npm run build

cd ../worker
npm run build

# Or build all at once
cd /Users/daniel/workspace/perfana-next-gen
npm run build
```

### Step 8.3: Run All Tests (1 hour)

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Run tests in each workspace
npm run test --workspace=packages/shared
npm run test --workspace=apps/api
npm run test --workspace=apps/worker

# Or all at once
npm run test
```

**Expected**: Worker tests still fail (pre-existing issue documented in Phase 1)

### Step 8.4: Verify Type Checking (30 min)

```bash
# Type check all workspaces
npm run type-check

# Should show no errors
```

### Step 8.5: Update Documentation (1 hour)

**Create** `MONOREPO_STRUCTURE.md`:
```markdown
# Monorepo Structure

## Overview
This is a monorepo containing the Perfana Next-Gen platform applications and shared packages.

## Structure

\`\`\`
perfana-next-gen/
├── apps/
│   ├── api/              # NestJS API server
│   └── worker/           # Background job processor
└── packages/
    └── shared/           # Shared code
        ├── entities/     # TypeORM entities
        ├── types/        # TypeScript types
        ├── config/       # Configuration
        ├── repositories/ # Data access
        └── database/     # Migrations
\`\`\`

## Workspace Commands

\`\`\`bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run all tests
npm run test

# Type check all packages
npm run type-check

# Run specific workspace
npm run dev --workspace=apps/worker
\`\`\`

## Development

1. Make changes to shared package: \`packages/shared/src/\`
2. Rebuild shared: \`npm run build --workspace=@perfana/shared\`
3. Changes automatically available to API and worker

## Adding Dependencies

\`\`\`bash
# Add to specific workspace
npm install <package> --workspace=apps/worker

# Add to shared package
npm install <package> --workspace=@perfana/shared

# Add to root (dev dependencies)
npm install -D <package> -w
\`\`\`
```

**Update** root `README.md`:
```markdown
# Perfana Next-Gen

Monorepo for Perfana performance testing platform.

## Quick Start

\`\`\`bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run API
npm run dev --workspace=apps/api

# Run worker
npm run dev --workspace=apps/worker
\`\`\`

See [MONOREPO_STRUCTURE.md](./MONOREPO_STRUCTURE.md) for details.
```

### Step 8.6: Final Commit (30 min)

```bash
cd /Users/daniel/workspace/perfana-next-gen

git add .
git commit -m "Complete monorepo migration - Final integration

Summary of migration:
✅ Worker moved to apps/worker with git history preserved
✅ Shared package created with entities, types, config
✅ All imports updated to use @perfana/shared
✅ Database migrations consolidated
✅ TypeORM configuration shared
✅ Build system working across all workspaces
✅ Documentation updated

Workspace structure:
- apps/api: NestJS API server
- apps/worker: Background job processor
- packages/shared: Shared entities, types, config

All packages build successfully ✅
Type checking passes ✅

Next steps:
- Merge to main branch
- Update CI/CD pipeline
- Archive old worker repository"
```

---

## Phase 9: CI/CD Updates & Deployment
**Estimated Time**: 2 hours
**Branch**: Continue `monorepo-setup` or new branch

### Step 9.1: Update GitHub Actions (if applicable)

**Create** `.github/workflows/ci.yml`:
```yaml
name: CI

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build shared package
        run: npm run build --workspace=@perfana/shared

      - name: Build API
        run: npm run build --workspace=@perfana/api

      - name: Build worker
        run: npm run build --workspace=@perfana/worker

      - name: Run tests
        run: npm run test --workspaces

      - name: Type check
        run: npm run type-check --workspaces
```

### Step 9.2: Update Deployment Scripts

**For API deployment** (adjust for your setup):
```bash
# In deployment script
cd /path/to/perfana-next-gen
git pull
npm install
npm run build --workspace=@perfana/shared
npm run build --workspace=@perfana/api
pm2 restart api
```

**For Worker deployment**:
```bash
# In deployment script
cd /path/to/perfana-next-gen
git pull
npm install
npm run build --workspace=@perfana/shared
npm run build --workspace=@perfana/worker
pm2 restart worker
```

### Step 9.3: Environment Variables

**Ensure .env files exist**:
```bash
# Root .env (if needed)
NODE_ENV=production

# apps/api/.env
DATABASE_URL=postgresql://...
API_PORT=3000

# apps/worker/.env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

---

## Phase 10: Cleanup & Archive
**Estimated Time**: 1 hour

### Step 10.1: Merge to Main

```bash
cd /Users/daniel/workspace/perfana-next-gen

# Ensure everything is committed
git status

# Switch to main and merge
git checkout main
git merge monorepo-setup

# Push to remote
git push origin main
```

### Step 10.2: Archive Old Worker Repository

```bash
cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker

# Create archive tag
git tag -a archive-pre-monorepo -m "Final state before migrating to monorepo

Migrated to: /Users/daniel/workspace/perfana-next-gen/apps/worker
Migration date: $(date +%Y-%m-%d)
Final commit: $(git rev-parse HEAD)"

# Push tags
git push origin --tags

# Add README noting migration
cat > README.md << 'EOF'
# ⚠️ ARCHIVED - This repository has been migrated

This repository has been migrated to the main monorepo:

**New location**: `/Users/daniel/workspace/perfana-next-gen/apps/worker`

All future development happens in the monorepo.

This repository is kept for historical reference only.

## Migration Details
- Date: $(date +%Y-%m-%d)
- Target: perfana-next-gen monorepo
- Location: apps/worker
- Git history: Preserved via subtree merge

See tag `archive-pre-monorepo` for final standalone state.
EOF

git add README.md
git commit -m "Archive: Repository migrated to monorepo"
git push
```

### Step 10.3: Update Links & Documentation

**Update any external references**:
- Package.json repository URLs
- Documentation links
- CI/CD configurations
- Team documentation
- README files

---

## Post-Migration Checklist

### Verification ✅

- [ ] All packages build successfully
- [ ] Type checking passes in all workspaces
- [ ] Tests run (worker tests have pre-existing issue, documented)
- [ ] API starts and runs correctly
- [ ] Worker starts and runs correctly
- [ ] Shared package imports work in both API and worker
- [ ] Git history preserved (if using subtree merge)
- [ ] Environment variables configured
- [ ] CI/CD updated and working

### Documentation ✅

- [ ] MONOREPO_STRUCTURE.md created
- [ ] Root README.md updated
- [ ] Development guide updated
- [ ] Deployment guide updated
- [ ] Team notified of new structure

### Cleanup ✅

- [ ] Old worker repository archived
- [ ] Links updated
- [ ] Backup files cleaned up
- [ ] Temporary migration files removed

---

## Rollback Plan

If issues occur during migration:

### Before Phase 8 (Integration)

```bash
# Simply delete the monorepo-setup branch
cd /Users/daniel/workspace/perfana-next-gen
git checkout main
git branch -D monorepo-setup

# Worker repo is untouched, continue using it
cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
# Continue development here
```

### After Phase 8 (After merge to main)

```bash
# Revert main branch
cd /Users/daniel/workspace/perfana-next-gen
git revert <merge-commit-sha>

# Or hard reset (if not pushed)
git reset --hard <commit-before-merge>

# Restore worker repository
cd /Users/daniel/workspace/perfana-ds-next-gen/perfana-ds-worker
git checkout type-orm
# Continue using standalone repository
```

---

## Estimated Timeline

| Phase | Description | Time | Cumulative |
|-------|-------------|------|------------|
| 1 | Prepare monorepo infrastructure | 4 hours | 4 hours |
| 2 | Migrate worker code | 4 hours | 8 hours |
| 3 | Extract shared entities | 6 hours | 14 hours |
| 4 | Extract shared types | 2 hours | 16 hours |
| 5 | Extract shared configuration | 3 hours | 19 hours |
| 6 | Extract database migrations | 2 hours | 21 hours |
| 7 | Extract repositories (optional) | 2 hours | 23 hours |
| 8 | Final integration & testing | 4 hours | 27 hours |
| 9 | CI/CD updates | 2 hours | 29 hours |
| 10 | Cleanup & archive | 1 hour | 30 hours |

**Total Estimated Time**: ~30 hours (~4 days)

**Realistic Timeline**: 1 week (accounting for testing, issues, reviews)

---

## Success Criteria

✅ **Complete migration when:**

1. Both API and worker build without errors
2. All imports use `@perfana/shared` correctly
3. No code duplication between apps
4. Type checking passes for all workspaces
5. Tests run (pre-existing worker test issue noted)
6. Documentation is complete and accurate
7. Team can develop and deploy as before
8. CI/CD pipeline works with new structure

---

## Benefits Realized

After migration, you'll have:

✅ **Single source of truth** for entities, types, config
✅ **Guaranteed consistency** between API and worker
✅ **Faster development** - change once, use everywhere
✅ **Better type safety** - compiler catches cross-app issues
✅ **Easier refactoring** - rename/modify with confidence
✅ **Simplified deployment** - one repo, one pipeline
✅ **Reduced duplication** - ~50% less code to maintain
✅ **Unified tooling** - one ESLint, one TypeScript config

---

## Support & Questions

During migration, if you encounter issues:

1. Check this migration plan for relevant phase
2. Review rollback plan
3. Test in isolation (build shared → build API → build worker)
4. Check TypeScript errors carefully (usually import paths)
5. Verify workspace linking: `npm ls @perfana/shared`

**Remember**: You can stop at any phase, commit your progress, and continue later. Each phase is designed to be independently completable.

Good luck with the migration! 🚀
