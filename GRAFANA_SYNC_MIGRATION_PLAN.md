# Migration Plan: Integrating perfana-grafana into perfana-next-gen Monorepo

**Document Version:** 1.1
**Date:** 2025-11-02
**Status:** Planning
**Estimated Effort:** 3-5 days (reduced due to code reuse)

## 🎯 Executive Summary

**KEY FINDING:** The monorepo already contains extensive Grafana infrastructure that can be reused:

✅ **Already Implemented:**
- Grafana entities (GrafanaInstance, GrafanaDashboard, ApplicationDashboard)
- Full-featured Grafana API client with batching, retries, connection pooling
- Complete TypeScript type definitions
- Database schema and migrations

🔄 **What We're Adding:**
- Dashboard synchronization service (store, update, restore)
- Auto-configuration for test runs
- Sanity checking and validation
- Direct Grafana database access (optional)

💡 **Impact:**
- **Reduced complexity:** No need to create duplicate entities/types
- **Faster implementation:** Reuse existing battle-tested client
- **Better maintainability:** Single source of truth for Grafana operations
- **Estimated effort reduced from 5-7 days to 3-5 days**

## 📋 Table of Contents

- [Overview](#overview)
- [Current State Analysis](#current-state-analysis)
- [Target Architecture](#target-architecture)
- [Integration Strategy](#integration-strategy)
- [Shared Code Migration](#shared-code-migration)
- [Dependencies Analysis](#dependencies-analysis)
- [Configuration Migration](#configuration-migration)
- [NestJS Module Architecture](#nestjs-module-architecture)
- [Scheduled Tasks](#scheduled-tasks)
- [Migration Phases](#migration-phases)
- [Key Differences](#key-differences)
- [Integration Benefits](#integration-benefits)
- [Risks & Mitigation](#risks--mitigation)
- [Success Criteria](#success-criteria)

## Overview

This document outlines the comprehensive plan to migrate the standalone `perfana-grafana` application into the `perfana-next-gen` monorepo as `apps/grafana-sync`.

### Current Location
- **Source:** `/Users/daniel/workspace/perfana-grafana`
- **Type:** Standalone Node.js application
- **Database:** MongoDB + TypeORM (mixed)

### Target Location
- **Destination:** `/Users/daniel/workspace/perfana-next-gen/apps/grafana-sync`
- **Type:** NestJS application (monorepo package)
- **Database:** TypeORM + PostgreSQL (unified)

## Current State Analysis

### perfana-grafana Application

**Purpose:** Synchronizes Grafana dashboards with the Perfana platform

**Key Features:**
- Dashboard synchronization (add, update, restore)
- Auto-configuration for test runs
- Sanity checking for test runs and benchmarks
- Template dashboard management
- Grafana HTTP API integration
- Optional direct Grafana database access

**Technology Stack:**
- Node.js with JavaScript/TypeScript mix
- MongoDB for legacy operations
- TypeORM for newer features
- Winston for logging
- Interval-based scheduling (`setInterval`)

**Project Structure:**
```
perfana-grafana/
├── index.js                    # Main entry point
├── grafana-sync/              # Core sync logic
├── auto-config/               # Auto-configuration
├── test-run-sanity-checker/   # Test run validation
├── sanity-checker/            # General validation
├── helpers/                   # Utilities & DB
├── database/                  # DB abstraction layer
├── config/                    # Configuration
└── entities/                  # TypeORM entities
```

## Target Architecture

### apps/grafana-sync Structure

```
apps/grafana-sync/
├── package.json              # Scoped: @perfana/grafana-sync
├── tsconfig.json             # Extends monorepo config
├── .env.example              # Environment template
├── README.md                 # Service documentation
├── CODING_RULES.md          # Service standards
│
├── src/
│   ├── main.ts              # NestJS bootstrap
│   ├── app.module.ts        # Root module
│   │
│   ├── modules/             # Feature modules
│   │   ├── grafana-sync/
│   │   │   ├── grafana-sync.module.ts
│   │   │   ├── grafana-sync.service.ts
│   │   │   ├── store-dashboard.service.ts
│   │   │   ├── restore-dashboard.service.ts
│   │   │   └── update-dashboards.service.ts
│   │   │
│   │   ├── auto-config/
│   │   │   ├── auto-config.module.ts
│   │   │   ├── auto-config.service.ts
│   │   │   ├── auto-config-finders.service.ts
│   │   │   └── auto-config-updates.service.ts
│   │   │
│   │   ├── sanity-checker/
│   │   │   ├── sanity-checker.module.ts
│   │   │   ├── test-run-sanity-checker.service.ts
│   │   │   └── general-sanity-checker.service.ts
│   │   │
│   │   └── grafana-api/
│   │       ├── grafana-api.module.ts
│   │       ├── grafana-api.service.ts
│   │       └── grafana-db.service.ts
│   │
│   ├── config/              # NestJS config modules
│   │   ├── grafana-sync.config.ts
│   │   └── validation.schema.ts
│   │
│   ├── types/               # Service-specific types
│   │   ├── dashboard.types.ts
│   │   └── grafana.types.ts
│   │
│   └── utils/               # Utility functions
│       ├── dashboard-uid.util.ts
│       ├── template-variables.util.ts
│       └── transformers.util.ts
│
└── test/                    # Tests
    ├── unit/
    ├── integration/
    └── e2e/
```

## Existing Grafana Infrastructure (REUSE!)

**CRITICAL:** The monorepo already has extensive Grafana infrastructure that MUST be reused:

### ✅ Already Implemented in Monorepo

#### **1. Grafana Entities** (`packages/shared/src/entities/`)
- ✅ `grafana-instance.entity.ts` - Grafana server instances with API keys
- ✅ `grafana-dashboard.entity.ts` - Dashboard metadata with panels, variables, templates
- ✅ `application-dashboard.entity.ts` - Application-specific dashboard configurations

#### **2. Grafana API Client** (`apps/worker/src/lib/grafana/`)
- ✅ `client.ts` - Full-featured Grafana API client
  - Connection pooling with undici (30 concurrent connections)
  - Request batching (configurable batch size)
  - Automatic retries with exponential backoff
  - Query panel data from Grafana dashboards
  - Fetch datasources by UID
- ✅ `batching.ts` - Smart request batching logic
- ✅ `formatter.ts` - Response transformation to time-series format

#### **3. Grafana Types** (`packages/shared/src/types/grafana.ts`)
- ✅ Complete type definitions for:
  - GrafanaInstance, GrafanaDashboard, ApplicationDashboard
  - Dashboard panels, variables, templating
  - API DTOs (Create, Update, Query)
  - List responses with pagination

#### **4. Configuration Cache** (`apps/worker/src/config/`)
- ✅ `grafana-config-cache.ts` - Grafana instance configuration caching

### 🔄 Reuse Strategy

**DO:**
- ✅ Import `GrafanaClient` from worker for all Grafana API calls
- ✅ Use existing entities from `packages/shared`
- ✅ Use existing types from `packages/shared/src/types/grafana.ts`
- ✅ Reference worker's Grafana implementation as the source of truth

**DON'T:**
- ❌ Create duplicate Grafana entities
- ❌ Create duplicate Grafana API client
- ❌ Create duplicate type definitions
- ❌ Re-implement connection pooling or batching logic

### 📋 What perfana-grafana Adds (Unique Features)

The standalone perfana-grafana app has features NOT in worker:

1. **Dashboard Synchronization**
   - Store dashboards from Grafana to Perfana DB
   - Update existing dashboards when changed
   - Restore missing dashboards
   - Template dashboard management

2. **Auto-Configuration**
   - Automatic dashboard creation for test runs
   - Variable substitution and templating
   - Profile-based configuration

3. **Sanity Checking**
   - Test run validation and cleanup
   - SLI/SLO benchmark validation
   - Snapshot management

4. **Direct Grafana DB Access** (Optional)
   - MySQL/PostgreSQL direct queries
   - Bypass HTTP API for performance

**These are the features we need to port to the new grafana-sync app.**

### 💻 Code Reuse Examples

#### **Example 1: Using Worker's Grafana Client**

```typescript
// apps/grafana-sync/src/modules/grafana-api/grafana-api.service.ts
import { Injectable } from '@nestjs/common';
import { GrafanaClient, GrafanaConfig } from '../../../worker/src/lib/grafana/client';

@Injectable()
export class GrafanaApiService {
  private client: GrafanaClient;

  constructor() {
    const config: GrafanaConfig = {
      url: 'https://grafana.example.com',
      apiKey: 'your-api-key',
      concurrency: 30,
      batchSize: 20,
    };

    // Reuse worker's battle-tested client
    this.client = new GrafanaClient(config);
  }

  async fetchDashboard(uid: string) {
    // Use client methods
    return this.client.getDatasourceByUid(uid);
  }
}
```

#### **Example 2: Using Shared Entities**

```typescript
// apps/grafana-sync/src/modules/grafana-sync/grafana-sync.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GrafanaInstance,
  GrafanaDashboard,
  ApplicationDashboard
} from '@perfana/shared/entities';

@Injectable()
export class GrafanaSyncService {
  constructor(
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,

    @InjectRepository(GrafanaDashboard)
    private dashboardRepo: Repository<GrafanaDashboard>,
  ) {}

  async syncDashboards() {
    // Use existing entities - no need to create new ones!
    const instances = await this.grafanaInstanceRepo.find();
    // ... sync logic
  }
}
```

#### **Example 3: Using Shared Types**

```typescript
// apps/grafana-sync/src/modules/auto-config/auto-config.service.ts
import { Injectable } from '@nestjs/common';
import {
  GrafanaDashboard,
  ApplicationDashboard,
  DashboardPanel,
  TemplatingVariable
} from '@perfana/shared/types/grafana';

@Injectable()
export class AutoConfigService {
  async createDashboard(
    templateDashboard: GrafanaDashboard,
    variables: TemplatingVariable[]
  ): Promise<ApplicationDashboard> {
    // Use shared types for type safety
  }
}
```

## Integration Strategy

### Design Principles

1. **Reuse Existing Infrastructure** - Use worker's Grafana client and shared entities
2. **Follow Worker Pattern** - Model after `apps/worker` architecture
3. **NestJS First** - Use dependency injection and modules
4. **Shared Code** - Maximize code reuse via `packages/shared`
5. **Type Safety** - Full TypeScript migration
6. **Testing** - Comprehensive test coverage
7. **Configuration** - Environment-based config via NestJS

### Alignment with Monorepo

| Aspect | apps/api | apps/worker | apps/grafana-sync |
|--------|----------|-------------|-------------------|
| Framework | NestJS | NestJS | NestJS |
| Database | TypeORM | TypeORM | TypeORM |
| Config | ConfigModule | ConfigModule | ConfigModule |
| Logging | Winston | Winston | Winston |
| Testing | Jest | Vitest | Jest |
| Build | TypeScript | TypeScript | TypeScript |

## Shared Code Migration

### Database Layer → packages/shared

**Move to:** `packages/shared/src/database/`

**Files:**
- `typeorm-sync.ts` (from `database/typeorm-sync.js`)
- `sync-database.ts` (from `database/sync-database.js`)
- `transformers.ts` (from `database/transformers.js`)

### Entities → packages/shared

**Move to:** `packages/shared/src/entities/`

**New Entities:**
```typescript
// grafana-instance.entity.ts
@Entity('grafana_instances')
export class GrafanaInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  url: string;

  @Column({ name: 'api_key', nullable: true })
  apiKey?: string;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// dashboard.entity.ts
@Entity('grafana_dashboards')
export class GrafanaDashboard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  uid: string;

  @Column()
  title: string;

  @Column({ type: 'jsonb' })
  data: object;

  @ManyToOne(() => GrafanaInstance)
  @JoinColumn({ name: 'grafana_instance_id' })
  grafanaInstance: GrafanaInstance;

  @Column({ name: 'is_template', default: false })
  isTemplate: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// application-dashboard.entity.ts
@Entity('application_dashboards')
export class ApplicationDashboard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TestRun)
  @JoinColumn({ name: 'test_run_id' })
  testRun: TestRun;

  @ManyToOne(() => GrafanaDashboard)
  @JoinColumn({ name: 'dashboard_id' })
  dashboard: GrafanaDashboard;

  @Column({ type: 'jsonb', nullable: true })
  variables: object;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### Repositories → packages/shared

**Move to:** `packages/shared/src/repositories/`

**New Repositories:**
- `grafana-instance.repository.ts`
- `grafana-dashboard.repository.ts`
- `application-dashboard.repository.ts`

### Types → packages/shared

**Move to:** `packages/shared/src/types/`

**New Type Definitions:**
```typescript
// grafana.types.ts
export interface GrafanaApiConfig {
  url: string;
  apiKey?: string;
  timeout?: number;
}

export interface DashboardSyncResult {
  added: number;
  updated: number;
  restored: number;
  errors: string[];
}

export interface TemplateVariable {
  name: string;
  type: string;
  query?: string;
  datasource?: string;
  current?: { value: string; text: string };
}

// dashboard.types.ts
export interface DashboardPanel {
  id: number;
  title: string;
  type: string;
  targets: DashboardTarget[];
}

export interface DashboardTarget {
  expr?: string;
  query?: string;
  datasource: string;
}
```

## Dependencies Analysis

### Current Dependencies (perfana-grafana)

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "async": "^3.2.1",
    "bluebird": "^3.7.2",
    "dotenv": "^16.3.1",
    "jsonpath-plus": "^10.3.0",
    "lodash": "^4.17.21",
    "md5": "^2.2.1",
    "meteor-random": "0.0.3",
    "moment": "^2.29.4",
    "mongodb": "^4.8.0",
    "mysql": "^2.18.1",
    "node-fetch": "^2.6.9",
    "pg": "^8.8.0",
    "reflect-metadata": "^0.2.1",
    "semver": "^7.3.8",
    "typeorm": "^0.3.20",
    "uuid": "^9.0.0",
    "winston": "^3.17.0"
  }
}
```

### New Dependencies (apps/grafana-sync)

```json
{
  "name": "@perfana/grafana-sync",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@perfana/shared": "file:../../packages/shared",
    "@nestjs/common": "^10.2.0",
    "@nestjs/config": "^3.1.0",
    "@nestjs/core": "^10.2.0",
    "@nestjs/schedule": "^4.0.0",
    "@nestjs/typeorm": "^11.0.0",
    "typeorm": "^0.3.27",
    "pg": "^8.11.3",
    "mysql": "^2.18.1",
    "async": "^3.2.1",
    "bluebird": "^3.7.2",
    "jsonpath-plus": "^10.3.0",
    "lodash": "^4.17.21",
    "moment": "^2.29.4",
    "semver": "^7.3.8",
    "winston": "^3.17.0",
    "axios": "^1.6.0",
    "joi": "^18.0.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.2.0",
    "@nestjs/testing": "^10.2.0",
    "@types/node": "^20.10.0",
    "@types/lodash": "^4.14.0",
    "@typescript-eslint/eslint-plugin": "^6.21.0",
    "@typescript-eslint/parser": "^6.21.0",
    "eslint": "^8.57.1",
    "jest": "^29.7.0",
    "nodemon": "^3.1.10",
    "prettier": "^3.1.0",
    "rimraf": "^5.0.5",
    "typescript": "^5.3.0"
  }
}
```

### Removed Dependencies

| Dependency | Reason | Replacement |
|------------|--------|-------------|
| `@supabase/supabase-js` | Not needed with TypeORM | TypeORM |
| `mongodb` | Migrating to PostgreSQL only | TypeORM + pg |
| `dotenv` | NestJS ConfigModule | `@nestjs/config` |
| `node-fetch` | Use Axios | `axios` |
| `meteor-random` | Legacy dependency | Native `uuid` |
| `md5` | Not needed | Native crypto |

## Configuration Migration

### Environment Variables

**File:** `apps/grafana-sync/.env.example`

```bash
# ============================================
# Database Configuration (Shared)
# ============================================
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=perfana
DB_PASSWORD=perfana
DB_NAME=perfana
DB_SYNCHRONIZE=false
DB_LOGGING=false

# ============================================
# Grafana Sync Configuration
# ============================================
GRAFANA_SYNC_INTERVAL=30000
GRAFANA_MAX_SERIES=2
GRAFANA_PROPAGATE_TEMPLATE_UPDATES=false
GRAFANA_PROMETHEUS_QUERY_RANGE_DAYS=1

# ============================================
# Grafana Direct Database Access (Optional)
# ============================================
GRAFANA_USE_DB_DIRECT_ACCESS=false

# MySQL Configuration (if using MySQL for Grafana)
GRAFANA_MYSQL_HOST=
GRAFANA_MYSQL_USER=
GRAFANA_MYSQL_PASSWORD=
GRAFANA_MYSQL_DATABASE=grafana

# PostgreSQL Configuration (if using PostgreSQL for Grafana)
GRAFANA_PG_HOST=
GRAFANA_PG_PORT=5432
GRAFANA_PG_USER=
GRAFANA_PG_PASSWORD=
GRAFANA_PG_DATABASE=grafana
GRAFANA_PG_SCHEMA=public
GRAFANA_PG_SSL=false

# ============================================
# Sanity Checker Configuration
# ============================================
# Test Run Sanity Checker
TESTRUN_SANITY_CHECKER_ENABLED=false
TESTRUN_SANITY_CHECKER_DELAY_MINUTES=10
TESTRUN_SANITY_CHECKER_INTERVAL=300000

# General Sanity Checker
SANITY_CHECKER_ENABLED=false
SANITY_CHECKER_INTERVAL=3600000

# ============================================
# Logging Configuration
# ============================================
LOG_LEVEL=info
NODE_ENV=development

# ============================================
# Application Configuration
# ============================================
PORT=3002
```

### NestJS Configuration Module

**File:** `apps/grafana-sync/src/config/grafana-sync.config.ts`

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('grafanaSync', () => ({
  // Sync settings
  syncInterval: parseInt(process.env.GRAFANA_SYNC_INTERVAL, 10) || 30000,
  maxSeries: parseInt(process.env.GRAFANA_MAX_SERIES, 10) || 2,
  propagateTemplateUpdates: process.env.GRAFANA_PROPAGATE_TEMPLATE_UPDATES === 'true',
  prometheusQueryRangeDays: parseInt(process.env.GRAFANA_PROMETHEUS_QUERY_RANGE_DAYS, 10) || 1,

  // Grafana database access
  grafanaDb: {
    useDirectAccess: process.env.GRAFANA_USE_DB_DIRECT_ACCESS === 'true',

    mysql: {
      host: process.env.GRAFANA_MYSQL_HOST,
      user: process.env.GRAFANA_MYSQL_USER,
      password: process.env.GRAFANA_MYSQL_PASSWORD,
      database: process.env.GRAFANA_MYSQL_DATABASE || 'grafana',
    },

    postgres: {
      host: process.env.GRAFANA_PG_HOST,
      port: parseInt(process.env.GRAFANA_PG_PORT, 10) || 5432,
      user: process.env.GRAFANA_PG_USER,
      password: process.env.GRAFANA_PG_PASSWORD,
      database: process.env.GRAFANA_PG_DATABASE || 'grafana',
      schema: process.env.GRAFANA_PG_SCHEMA || 'public',
      ssl: process.env.GRAFANA_PG_SSL === 'true',
    },
  },

  // Sanity checker settings
  sanityChecker: {
    testRun: {
      enabled: process.env.TESTRUN_SANITY_CHECKER_ENABLED === 'true',
      delayMinutes: parseInt(process.env.TESTRUN_SANITY_CHECKER_DELAY_MINUTES, 10) || 10,
      interval: parseInt(process.env.TESTRUN_SANITY_CHECKER_INTERVAL, 10) || 300000,
    },
    general: {
      enabled: process.env.SANITY_CHECKER_ENABLED === 'true',
      interval: parseInt(process.env.SANITY_CHECKER_INTERVAL, 10) || 3600000,
    },
  },

  // Application settings
  port: parseInt(process.env.PORT, 10) || 3002,
}));
```

### Configuration Validation Schema

**File:** `apps/grafana-sync/src/config/validation.schema.ts`

```typescript
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  // Grafana Sync
  GRAFANA_SYNC_INTERVAL: Joi.number().min(1000).default(30000),
  GRAFANA_MAX_SERIES: Joi.number().min(1).default(2),
  GRAFANA_PROPAGATE_TEMPLATE_UPDATES: Joi.boolean().default(false),
  GRAFANA_PROMETHEUS_QUERY_RANGE_DAYS: Joi.number().min(1).default(1),

  // Grafana DB Access
  GRAFANA_USE_DB_DIRECT_ACCESS: Joi.boolean().default(false),

  // When direct access enabled, require credentials
  GRAFANA_MYSQL_HOST: Joi.string().when('GRAFANA_USE_DB_DIRECT_ACCESS', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Sanity Checkers
  TESTRUN_SANITY_CHECKER_ENABLED: Joi.boolean().default(false),
  TESTRUN_SANITY_CHECKER_DELAY_MINUTES: Joi.number().min(1).default(10),
  TESTRUN_SANITY_CHECKER_INTERVAL: Joi.number().min(10000).default(300000),
  SANITY_CHECKER_ENABLED: Joi.boolean().default(false),
  SANITY_CHECKER_INTERVAL: Joi.number().min(10000).default(3600000),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Application
  PORT: Joi.number().default(3002),
});
```

## NestJS Module Architecture

### Root Module

**File:** `apps/grafana-sync/src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import grafanaSyncConfig from './config/grafana-sync.config';
import { validationSchema } from './config/validation.schema';
import { GrafanaSyncModule } from './modules/grafana-sync/grafana-sync.module';
import { AutoConfigModule } from './modules/auto-config/auto-config.module';
import { SanityCheckerModule } from './modules/sanity-checker/sanity-checker.module';
import { GrafanaApiModule } from './modules/grafana-api/grafana-api.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [grafanaSyncConfig],
      validationSchema,
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_NAME'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        synchronize: configService.get('DB_SYNCHRONIZE', false),
        logging: configService.get('DB_LOGGING', false),
      }),
    }),

    // Feature modules
    GrafanaSyncModule,
    AutoConfigModule,
    SanityCheckerModule,
    GrafanaApiModule,
  ],
})
export class AppModule {}
```

### Main Entry Point

**File:** `apps/grafana-sync/src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('grafanaSync.port', 3002);
  const logger = new Logger('GrafanaSync');

  await app.listen(port);

  logger.log(`Grafana Sync Service started on port ${port}`);
  logger.log(`Environment: ${configService.get('NODE_ENV')}`);
  logger.log(`Log Level: ${configService.get('LOG_LEVEL')}`);
  logger.log(`Sync Interval: ${configService.get('grafanaSync.syncInterval')}ms`);
}

bootstrap();
```

### Grafana Sync Module

**File:** `apps/grafana-sync/src/modules/grafana-sync/grafana-sync.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaSyncService } from './grafana-sync.service';
import { StoreDashboardService } from './store-dashboard.service';
import { RestoreDashboardService } from './restore-dashboard.service';
import { UpdateDashboardsService } from './update-dashboards.service';
import { GrafanaApiModule } from '../grafana-api/grafana-api.module';
import { GrafanaDashboard, GrafanaInstance, ApplicationDashboard } from '@perfana/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GrafanaDashboard,
      GrafanaInstance,
      ApplicationDashboard,
    ]),
    GrafanaApiModule,
  ],
  providers: [
    GrafanaSyncService,
    StoreDashboardService,
    RestoreDashboardService,
    UpdateDashboardsService,
  ],
  exports: [GrafanaSyncService],
})
export class GrafanaSyncModule {}
```

### Auto-Config Module

**File:** `apps/grafana-sync/src/modules/auto-config/auto-config.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoConfigService } from './auto-config.service';
import { AutoConfigFindersService } from './auto-config-finders.service';
import { AutoConfigUpdatesService } from './auto-config-updates.service';
import { GrafanaApiModule } from '../grafana-api/grafana-api.module';
import { TestRun, ApplicationDashboard } from '@perfana/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestRun, ApplicationDashboard]),
    GrafanaApiModule,
  ],
  providers: [
    AutoConfigService,
    AutoConfigFindersService,
    AutoConfigUpdatesService,
  ],
  exports: [AutoConfigService],
})
export class AutoConfigModule {}
```

### Sanity Checker Module

**File:** `apps/grafana-sync/src/modules/sanity-checker/sanity-checker.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRunSanityCheckerService } from './test-run-sanity-checker.service';
import { GeneralSanityCheckerService } from './general-sanity-checker.service';
import { TestRun, Benchmark } from '@perfana/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestRun, Benchmark]),
  ],
  providers: [
    TestRunSanityCheckerService,
    GeneralSanityCheckerService,
  ],
})
export class SanityCheckerModule {}
```

### Grafana API Module

**File:** `apps/grafana-sync/src/modules/grafana-api/grafana-api.module.ts`

**IMPORTANT:** This module wraps the existing `GrafanaClient` from worker.

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaApiService } from './grafana-api.service';
import { GrafanaDbService } from './grafana-db.service';
import { GrafanaInstance } from '@perfana/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([GrafanaInstance]),
  ],
  providers: [GrafanaApiService, GrafanaDbService],
  exports: [GrafanaApiService, GrafanaDbService],
})
export class GrafanaApiModule {}
```

**File:** `apps/grafana-sync/src/modules/grafana-api/grafana-api.service.ts`

**REUSES:** Worker's `GrafanaClient` from `apps/worker/src/lib/grafana/client.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaClient, GrafanaConfig } from '../../../worker/src/lib/grafana/client';

@Injectable()
export class GrafanaApiService {
  private readonly logger = new Logger(GrafanaApiService.name);
  private clients: Map<string, GrafanaClient> = new Map();

  constructor(
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
  ) {}

  /**
   * Get or create GrafanaClient for a specific instance
   * Reuses the worker's implementation
   */
  async getClient(instanceId: string): Promise<GrafanaClient> {
    if (this.clients.has(instanceId)) {
      return this.clients.get(instanceId)!;
    }

    const instance = await this.grafanaInstanceRepo.findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error(`Grafana instance ${instanceId} not found`);
    }

    const config: GrafanaConfig = {
      url: instance.client_url,
      apiKey: instance.apiKey!,
      orgId: instance.orgId,
      timeout: 30000,
      concurrency: 30,
      batchSize: 20,
    };

    const client = new GrafanaClient(config);
    this.clients.set(instanceId, client);

    return client;
  }

  /**
   * Fetch dashboard from Grafana using HTTP API
   */
  async getDashboard(instanceId: string, dashboardUid: string): Promise<any> {
    const client = await this.getClient(instanceId);
    // Use client to fetch dashboard
    // Implementation will call Grafana API endpoints
  }

  /**
   * List all dashboards from Grafana instance
   */
  async listDashboards(instanceId: string): Promise<any[]> {
    const client = await this.getClient(instanceId);
    // Implementation
  }
}
```

## Scheduled Tasks

### Using @nestjs/schedule

**Example: Grafana Sync Service**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { StoreDashboardService } from './store-dashboard.service';
import { RestoreDashboardService } from './restore-dashboard.service';
import { UpdateDashboardsService } from './update-dashboards.service';

@Injectable()
export class GrafanaSyncService {
  private readonly logger = new Logger(GrafanaSyncService.name);
  private isSyncing = false;

  constructor(
    private configService: ConfigService,
    private storeDashboardService: StoreDashboardService,
    private restoreDashboardService: RestoreDashboardService,
    private updateDashboardsService: UpdateDashboardsService,
  ) {}

  @Interval('grafana-sync')
  async handleGrafanaSync() {
    const interval = this.configService.get<number>('grafanaSync.syncInterval', 30000);

    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping...');
      return;
    }

    try {
      this.isSyncing = true;
      this.logger.debug('Starting Grafana dashboard sync...');

      // Add new dashboards
      const addedCount = await this.storeDashboardService.addNewDashboards();

      // Update existing dashboards
      const updatedCount = await this.updateDashboardsService.updateDashboards();

      // Restore missing dashboards
      const restoredCount = await this.restoreDashboardService.restoreDashboards();

      this.logger.log(
        `Sync completed: ${addedCount} added, ${updatedCount} updated, ${restoredCount} restored`
      );
    } catch (error) {
      this.logger.error('Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTemplateUpdates() {
    if (!this.configService.get<boolean>('grafanaSync.propagateTemplateUpdates')) {
      return;
    }

    try {
      await this.updateDashboardsService.updateTemplateDashboards();
    } catch (error) {
      this.logger.error('Template update failed:', error);
    }
  }
}
```

**Example: Test Run Sanity Checker**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TestRun } from '@perfana/shared/entities';

@Injectable()
export class TestRunSanityCheckerService {
  private readonly logger = new Logger(TestRunSanityCheckerService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(TestRun)
    private testRunRepository: Repository<TestRun>,
  ) {}

  @Cron('*/5 * * * *') // Every 5 minutes
  async checkStuckTestRuns() {
    if (!this.configService.get<boolean>('grafanaSync.sanityChecker.testRun.enabled')) {
      return;
    }

    this.logger.debug('Checking for stuck test runs...');

    const delayMinutes = this.configService.get<number>(
      'grafanaSync.sanityChecker.testRun.delayMinutes',
      10
    );

    try {
      const threshold = new Date(Date.now() - delayMinutes * 60 * 1000);

      const stuckTestRuns = await this.testRunRepository
        .createQueryBuilder('testRun')
        .where('testRun.status = :status', { status: 'running' })
        .andWhere('testRun.startTime < :threshold', { threshold })
        .getMany();

      if (stuckTestRuns.length > 0) {
        this.logger.warn(`Found ${stuckTestRuns.length} stuck test runs`);

        for (const testRun of stuckTestRuns) {
          await this.testRunRepository.update(testRun.id, {
            status: 'failed',
            endTime: new Date(),
            notes: 'Marked as failed by sanity checker (stuck)',
          });
        }
      }
    } catch (error) {
      this.logger.error('Sanity check failed:', error);
    }
  }
}
```

## Migration Phases

### Phase 1: Setup Infrastructure ⚙️

**Objective:** Create the basic structure for the new app

**Tasks:**
1. ✅ Create `apps/grafana-sync` directory
2. ✅ Create `package.json` with dependencies
3. ✅ Create `tsconfig.json` extending root config
4. ✅ Create `.env.example` with all variables
5. ✅ Verify workspace detection in root
6. ✅ Add scripts to `turbo.json` if needed

**Files to Create:**
- `apps/grafana-sync/package.json`
- `apps/grafana-sync/tsconfig.json`
- `apps/grafana-sync/.env.example`
- `apps/grafana-sync/README.md`

**Verification:**
```bash
npm install
turbo run build --filter=@perfana/grafana-sync
```

### Phase 2: Migrate Shared Code 📦

**Objective:** Move reusable code to `packages/shared` (SKIP duplicates!)

**Tasks:**

1. ✅ **SKIP - Already Exists:** Grafana entities in `packages/shared/src/entities/`
   - ✓ `grafana-instance.entity.ts` - Already implemented
   - ✓ `grafana-dashboard.entity.ts` - Already implemented
   - ✓ `application-dashboard.entity.ts` - Already implemented

2. ✅ **SKIP - Already Exists:** Grafana types in `packages/shared/src/types/`
   - ✓ `grafana.types.ts` - Complete type definitions already exist

3. ✅ **NEW:** Move database utilities to `packages/shared/src/database/`
   - `typeorm-sync.ts` (from perfana-grafana/database/)
   - `sync-database.ts` (from perfana-grafana/database/)
   - `transformers.ts` (from perfana-grafana/database/)

4. ✅ **OPTIONAL:** Consider moving Grafana client to shared
   - Current location: `apps/worker/src/lib/grafana/client.ts`
   - Option A: Keep in worker, import via relative path
   - Option B: Move to `packages/shared/src/services/grafana/`
   - **Recommendation:** Keep in worker for now, refactor later if needed

5. ✅ Update exports in `packages/shared/src/index.ts`

**Verification:**
```bash
cd packages/shared
npm run build
npm run type-check

# Verify entities are accessible
node -e "console.log(require('./dist/entities/grafana-instance.entity'))"
```

### Phase 3: Convert to NestJS 🏗️

**Objective:** Migrate JavaScript/plain Node.js to NestJS services

**Tasks:**

1. ✅ Create NestJS bootstrap files
   - `src/main.ts`
   - `src/app.module.ts`

2. ✅ Create configuration module
   - `src/config/grafana-sync.config.ts`
   - `src/config/validation.schema.ts`

3. ✅ Convert helpers to services (REUSE worker's client):
   - `helpers/grafana-api.js` → `modules/grafana-api/grafana-api.service.ts`
     - **IMPORTANT:** Wrap worker's `GrafanaClient` instead of reimplementing
     - Import from: `apps/worker/src/lib/grafana/client.ts`
   - `helpers/grafanaDb.js` → `modules/grafana-api/grafana-db.service.ts`
     - Direct MySQL/PostgreSQL access for Grafana database

4. ✅ Convert sync logic to modules:
   - `grafana-sync/` → `modules/grafana-sync/`
   - Create `grafana-sync.service.ts` (main orchestrator)
   - Create `store-dashboard.service.ts`
   - Create `restore-dashboard.service.ts`
   - Create `update-dashboards.service.ts`

5. ✅ Convert auto-config to module:
   - `auto-config/` → `modules/auto-config/`
   - Create `auto-config.service.ts`
   - Create `auto-config-finders.service.ts`
   - Create `auto-config-updates.service.ts`

6. ✅ Convert sanity checkers to module:
   - `test-run-sanity-checker/` → `modules/sanity-checker/`
   - Create `test-run-sanity-checker.service.ts`
   - Create `general-sanity-checker.service.ts`

7. ✅ Implement scheduled tasks with `@Cron` and `@Interval` decorators

**Verification:**
```bash
cd apps/grafana-sync
npm run build
npm run type-check
```

### Phase 4: Configuration & Environment ⚙️

**Objective:** Setup environment-based configuration

**Tasks:**
1. ✅ Create comprehensive `.env.example`
2. ✅ Implement Joi validation schema
3. ✅ Create NestJS configuration modules
4. ✅ Document all environment variables
5. ✅ Setup logging with Winston (from shared)
6. ✅ Create service-specific README.md

**Files to Create/Update:**
- `apps/grafana-sync/.env.example`
- `apps/grafana-sync/src/config/grafana-sync.config.ts`
- `apps/grafana-sync/src/config/validation.schema.ts`
- `apps/grafana-sync/README.md`

**Verification:**
```bash
# Test with missing env vars
npm run dev

# Should show validation errors
```

### Phase 5: Testing & Quality ✅

**Objective:** Comprehensive test coverage and code quality

**Tasks:**
1. ✅ Setup Jest configuration
2. ✅ Write unit tests for all services:
   - `grafana-sync.service.spec.ts`
   - `grafana-api.service.spec.ts`
   - `auto-config.service.spec.ts`
   - `sanity-checker.service.spec.ts`

3. ✅ Write integration tests:
   - Database operations
   - Grafana API calls
   - Dashboard sync workflow

4. ✅ Create CODING_RULES.md (following monorepo standards)

5. ✅ Setup ESLint configuration

6. ✅ Add to CI/CD pipeline

**Test Coverage Target:** >80%

**Verification:**
```bash
npm run test
npm run test:cov
npm run lint
```

### Phase 6: Integration & Documentation 🔗

**Objective:** Integrate with existing apps and finalize documentation

**Tasks:**
1. ✅ Update root `package.json` scripts
2. ✅ Update `turbo.json` for build dependencies
3. ✅ Test with other apps (api, web, worker)
4. ✅ Update main `CLAUDE.md` documentation
5. ✅ Create migration changelog
6. ✅ Document API endpoints (if exposed)
7. ✅ Create Docker configuration (if needed)

**Files to Update:**
- `/package.json` (root)
- `/turbo.json`
- `/CLAUDE.md`
- `apps/grafana-sync/Dockerfile` (optional)

**Verification:**
```bash
# Build entire monorepo
npm run build

# Run all apps
npm run dev

# Verify grafana-sync is running
curl http://localhost:3002/health
```

## Key Differences

| Aspect | Current (perfana-grafana) | New (apps/grafana-sync) |
|--------|---------------------------|-------------------------|
| **Architecture** | Plain Node.js with modules | NestJS with DI & modules |
| **Language** | JavaScript with some TS | Full TypeScript |
| **Database** | MongoDB + TypeORM mixed | Pure TypeORM + PostgreSQL |
| **Scheduling** | `setInterval()` | `@nestjs/schedule` |
| **Configuration** | `dotenv` + `config/default.js` | NestJS `ConfigModule` + Joi |
| **Logging** | Winston standalone | Winston via `@perfana/shared` |
| **Entities** | Mix of MongoDB & TypeORM | Pure TypeORM in `@perfana/shared` |
| **Error Handling** | Try-catch with console logs | NestJS exception filters |
| **Testing** | Minimal/none | Jest with unit + integration |
| **Type Safety** | Partial | Full type coverage |
| **Code Sharing** | Standalone | Shares via `@perfana/shared` |
| **Build System** | npm scripts | Turbo monorepo |
| **Dev Experience** | Nodemon | NestJS watch mode |

## Integration Benefits

### 🎯 Technical Benefits

1. **Shared Database Layer**
   - Single TypeORM connection across all apps
   - Shared entities prevent duplication
   - Consistent repository patterns

2. **Shared Configuration**
   - Reuse database config
   - Shared environment validation
   - Consistent logging setup

3. **Type Safety**
   - Full TypeScript with strict mode
   - Shared types prevent mismatches
   - Better IDE support

4. **Unified Build System**
   - Turbo handles build orchestration
   - Parallel builds for speed
   - Smart caching

5. **Better Testing**
   - Integrated test suite
   - Shared test utilities
   - Consistent test patterns

6. **Code Reuse**
   - Share utilities across apps
   - Share repositories
   - Share entity definitions

### 📈 Development Benefits

1. **Single Installation** - One `npm install` for all apps
2. **Consistent Patterns** - Same architecture as api/worker
3. **Easier Debugging** - Unified logging and error handling
4. **Better Collaboration** - Consistent code style
5. **Faster Onboarding** - Familiar structure for new devs

### 🚀 Operations Benefits

1. **Simplified Deployment** - Single repo to deploy
2. **Shared Dependencies** - Reduced bundle size
3. **Version Consistency** - All apps use same library versions
4. **Easier Monitoring** - Consistent logging format

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|-------------------|
| **MongoDB removal breaks existing functionality** | High | Medium | • Comprehensive TypeORM migration first<br>• Maintain backward compatibility during transition<br>• Extensive integration testing |
| **Breaking changes in sync logic** | High | Low | • Thorough unit tests<br>• Integration tests for full sync workflow<br>• Manual testing with real Grafana instances |
| **Configuration drift between old/new** | Medium | Medium | • Joi validation schema<br>• Document all env vars<br>• Create migration guide for configs |
| **Performance degradation** | Medium | Low | • Benchmark sync performance<br>• Monitor sync times<br>• Optimize database queries |
| **Scheduling reliability issues** | High | Low | • Use proven `@nestjs/schedule`<br>• Add health checks<br>• Monitor scheduled task execution |
| **Missing dependencies** | Low | Medium | • Thorough dependency analysis<br>• Test all features<br>• Check for runtime errors |
| **TypeScript migration errors** | Medium | Medium | • Gradual type addition<br>• Use `any` temporarily where needed<br>• Incremental strictness |

## Success Criteria

### Functional Requirements ✅

- [ ] All dashboards sync correctly from Grafana
- [ ] Auto-configuration creates dashboards for test runs
- [ ] Sanity checkers mark invalid test runs
- [ ] Template dashboards propagate updates (if enabled)
- [ ] Direct Grafana DB access works (MySQL & PostgreSQL)
- [ ] HTTP API fallback works when DB access disabled

### Performance Requirements ⚡

- [ ] Sync completes within configured interval
- [ ] No memory leaks during continuous operation
- [ ] Database queries are optimized
- [ ] Scheduled tasks execute reliably

### Quality Requirements 🎯

- [ ] >80% test coverage
- [ ] All ESLint rules pass
- [ ] TypeScript strict mode enabled
- [ ] No console.log statements (use logger)
- [ ] All environment variables validated

### Integration Requirements 🔗

- [ ] Builds successfully with `turbo run build`
- [ ] Starts with `npm run dev` from root
- [ ] Uses shared entities from `@perfana/shared`
- [ ] Integrates with existing database
- [ ] Health checks work

### Documentation Requirements 📚

- [ ] README.md complete with usage instructions
- [ ] CODING_RULES.md follows monorepo standards
- [ ] All environment variables documented
- [ ] CLAUDE.md updated with integration info
- [ ] Migration guide created

## Timeline

| Phase | Duration | Dependencies | Notes |
|-------|----------|--------------|-------|
| Phase 1: Setup Infrastructure | 0.5 days | None | Standard setup |
| Phase 2: Migrate Shared Code | 0.5 days | Phase 1 | **REDUCED:** Most code already exists |
| Phase 3: Convert to NestJS | 1.5 days | Phase 2 | **REDUCED:** Reuse worker's client |
| Phase 4: Configuration & Environment | 0.5 days | Phase 3 | Standard config |
| Phase 5: Testing & Quality | 1 day | Phase 3, 4 | Standard testing |
| Phase 6: Integration & Documentation | 0.5 days | All previous | Standard integration |
| **Total** | **4.5 days** | | |

**Buffer:** +0.5 day for unforeseen issues
**Total with Buffer:** 5 days

### 📉 Time Savings from Code Reuse

| Task | Original Estimate | With Reuse | Savings |
|------|------------------|------------|---------|
| Create Grafana entities | 0.5 days | 0 days | 0.5 days |
| Implement API client | 1 day | 0.25 days | 0.75 days |
| Create type definitions | 0.25 days | 0 days | 0.25 days |
| **Total Savings** | | | **1.5 days** |

## Next Steps

1. **Review & Approval**
   - [ ] Team review of migration plan
   - [ ] Architecture approval
   - [ ] Timeline confirmation

2. **Preparation**
   - [ ] Create feature branch: `feature/monorepo-grafana-sync-integration`
   - [ ] Setup development environment
   - [ ] Backup current perfana-grafana

3. **Execution**
   - [ ] Execute Phase 1: Infrastructure
   - [ ] Execute Phase 2: Shared Code
   - [ ] Execute Phase 3: NestJS Conversion
   - [ ] Execute Phase 4: Configuration
   - [ ] Execute Phase 5: Testing
   - [ ] Execute Phase 6: Integration

4. **Review & Deploy**
   - [ ] Code review
   - [ ] QA testing
   - [ ] Merge to main
   - [ ] Deploy to staging
   - [ ] Deploy to production

---

**Document Owner:** Development Team
**Last Updated:** 2025-11-02
**Status:** Ready for Review
