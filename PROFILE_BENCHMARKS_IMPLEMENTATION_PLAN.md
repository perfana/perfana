# Profile Benchmarks Implementation Plan

## Overview
Add `profile_benchmarks` table to enable profile-level Service Level Objectives (SLOs) configuration. This allows users to define benchmarks/SLOs at the profile level that are automatically applied to test runs matching the profile.

## Background Context

### Legacy System (`genericChecks` collection from MongoDB)
The legacy Perfana system stored benchmarks in a `genericChecks` collection that included:
- **Profile association**: Tied benchmarks to profiles
- **Dashboard/Panel selection**: References to Grafana dashboards and specific panels
- **Workload regex matching**: `addForWorkloadsMatchingRegex` field
- **Service Level Objectives**: `panel.requirement` with operator and value
- **Evaluation configuration**: evaluate type (avg, max, min, last, fit/slope)
- **Advanced options**: ramp-up exclusion, series matching patterns, default values

### Current System
- **`benchmarks` table**: Currently stores SLOs at the system-under-test + environment + workload level
- **`profile_grafana_dashboards` table** (just renamed): Stores dashboard auto-configuration per profile
- **System Config SLOs**: UI at `/systems/[id]/config` for managing benchmarks

---

## Implementation Plan

### Phase 1: Database Schema & Entity

#### 1.1 Create Entity File
**File**: `packages/shared/src/entities/profile-benchmark.entity.ts`

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Profile } from './profile.entity';

@Entity('profile_benchmarks')
export class ProfileBenchmark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Foreign key to profile
  @Column({ type: 'uuid' })
  @Index('idx_profile_benchmarks_profile_id')
  profile_id!: string;

  // Reference to profile_grafana_dashboards configuration
  @Column({ type: 'uuid' })
  @Index('idx_profile_benchmarks_dashboard_id')
  profile_dashboard_id!: string;

  // Workload matching pattern (from addForWorkloadsMatchingRegex)
  @Column({ type: 'varchar', length: 500, default: '.*' })
  workload_pattern!: string;

  // Source type (grafana, dynatrace)
  @Column({ type: 'varchar', length: 50, default: 'grafana' })
  source!: string;

  // Dashboard and panel references
  @Column({ type: 'varchar', length: 255, nullable: true })
  grafana_instance?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  dashboard_label?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboard_uid?: string;

  @Column({ type: 'int', nullable: true })
  panel_id?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  panel_title?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  panel_type?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  panel_description?: string;

  // Metric evaluation configuration
  @Column({ type: 'varchar', length: 50, nullable: true })
  evaluate_type?: string; // avg, max, min, last, fit

  @Column({ type: 'varchar', length: 50, nullable: true })
  metric_unit?: string;

  // Service Level Objective (requirement)
  @Column({ type: 'varchar', length: 50, nullable: true })
  requirement_operator?: string; // gt, lt

  @Column({ type: 'numeric', nullable: true })
  requirement_value?: number;

  // Advanced options
  @Column({ type: 'boolean', default: true })
  exclude_ramp_up_time!: boolean;

  @Column({ type: 'boolean', default: false })
  average_all!: boolean;

  @Column({ type: 'text', nullable: true })
  match_pattern?: string; // Series matching regex

  @Column({ type: 'boolean', default: false })
  validate_with_default_if_no_data!: boolean;

  @Column({ type: 'numeric', nullable: true })
  validate_with_default_if_no_data_value?: number;

  // Metadata
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  read_only?: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  profile!: Profile;
}
```

#### 1.2 Create Database Migration
**File**: `packages/shared/src/database/migrations/[timestamp]-CreateProfileBenchmarks.ts`

```sql
-- Create profile_benchmarks table
CREATE TABLE profile_benchmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    profile_id uuid NOT NULL,
    profile_dashboard_id uuid NOT NULL,
    workload_pattern varchar(500) DEFAULT '.*' NOT NULL,
    source varchar(50) DEFAULT 'grafana' NOT NULL,
    grafana_instance varchar(255),
    dashboard_label varchar(500),
    dashboard_uid varchar(255),
    panel_id integer,
    panel_title varchar(255),
    panel_type varchar(50),
    panel_description varchar(255),
    evaluate_type varchar(50),
    metric_unit varchar(50),
    requirement_operator varchar(50),
    requirement_value numeric,
    exclude_ramp_up_time boolean DEFAULT true NOT NULL,
    average_all boolean DEFAULT false NOT NULL,
    match_pattern text,
    validate_with_default_if_no_data boolean DEFAULT false NOT NULL,
    validate_with_default_if_no_data_value numeric,
    description text,
    tags text[] DEFAULT '{}' NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}' NOT NULL,
    read_only boolean DEFAULT false,
    created_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Add foreign key constraint
ALTER TABLE profile_benchmarks
    ADD CONSTRAINT fk_profile_benchmarks_profile
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Add indexes
CREATE INDEX idx_profile_benchmarks_profile_id ON profile_benchmarks(profile_id);
CREATE INDEX idx_profile_benchmarks_dashboard_id ON profile_benchmarks(profile_dashboard_id);
CREATE INDEX idx_profile_benchmarks_workload_pattern ON profile_benchmarks(workload_pattern);
CREATE INDEX idx_profile_benchmarks_enabled ON profile_benchmarks(enabled);

-- Add table comment
COMMENT ON TABLE profile_benchmarks IS 'Service level objectives (SLOs) configured at profile level, auto-applied to matching test runs';
```

#### 1.3 Update Entity Barrel Export
**File**: `packages/shared/src/entities/index.ts`

```typescript
export * from './profile-benchmark.entity';
```

---

### Phase 2: Backend API Implementation

#### 2.1 Create DTOs
**File**: `apps/api/src/modules/profiles/dto/profile-benchmark.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsUUID } from 'class-validator';

export class CreateProfileBenchmarkDto {
  @ApiProperty({ description: 'Profile dashboard ID to attach benchmark to' })
  @IsUUID()
  profileDashboardId: string;

  @ApiProperty({ description: 'Workload pattern regex', default: '.*' })
  @IsOptional()
  @IsString()
  workloadPattern?: string;

  @ApiProperty({ description: 'Source type', enum: ['grafana', 'dynatrace'] })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({ description: 'Panel ID' })
  @IsOptional()
  @IsNumber()
  panelId?: number;

  @ApiProperty({ description: 'Evaluation type', enum: ['avg', 'max', 'min', 'last', 'fit'] })
  @IsOptional()
  @IsString()
  evaluateType?: string;

  @ApiProperty({ description: 'Requirement operator', enum: ['gt', 'lt'] })
  @IsOptional()
  @IsString()
  requirementOperator?: string;

  @ApiProperty({ description: 'Requirement value' })
  @IsOptional()
  @IsNumber()
  requirementValue?: number;

  @ApiProperty({ description: 'Description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Tags', type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiProperty({ description: 'Exclude ramp-up time', default: true })
  @IsOptional()
  @IsBoolean()
  excludeRampUpTime?: boolean;

  @ApiProperty({ description: 'Average all series', default: false })
  @IsOptional()
  @IsBoolean()
  averageAll?: boolean;

  @ApiProperty({ description: 'Match pattern regex' })
  @IsOptional()
  @IsString()
  matchPattern?: string;

  // Add other fields as needed
}

export class UpdateProfileBenchmarkDto {
  // Same as CreateProfileBenchmarkDto but all fields optional
}

export class ProfileBenchmarkResponse {
  id: string;
  profileId: string;
  profileDashboardId: string;
  workloadPattern: string;
  source: string;
  dashboardLabel?: string;
  panelTitle?: string;
  evaluateType?: string;
  requirementOperator?: string;
  requirementValue?: number;
  description?: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

#### 2.2 Extend Profiles Service
**File**: `apps/api/src/modules/profiles/profiles.service.ts`

Add methods:
- `findBenchmarksByProfileId(profileId: string): Promise<ProfileBenchmarkResponse[]>`
- `createBenchmark(profileId: string, createDto: CreateProfileBenchmarkDto): Promise<ProfileBenchmarkResponse>`
- `updateBenchmark(profileId: string, benchmarkId: string, updateDto: UpdateProfileBenchmarkDto): Promise<ProfileBenchmarkResponse>`
- `deleteBenchmark(profileId: string, benchmarkId: string): Promise<void>`

**Pattern to follow**: Same as `findDashboardsByProfileId`, `createDashboard`, `updateDashboard`, `deleteDashboard`

#### 2.3 Add Controller Endpoints
**File**: `apps/api/src/modules/profiles/profiles.controller.ts`

```typescript
@Get(':id/benchmarks')
@ApiOperation({ summary: 'Get all benchmarks for a profile' })
async getProfileBenchmarks(@Param('id') id: string) {
  return this.profilesService.findBenchmarksByProfileId(id);
}

@Post(':id/benchmarks')
@ApiOperation({ summary: 'Create a new benchmark for a profile' })
async createProfileBenchmark(
  @Param('id') id: string,
  @Body() createDto: CreateProfileBenchmarkDto
) {
  return this.profilesService.createBenchmark(id, createDto);
}

@Put(':id/benchmarks/:benchmarkId')
@ApiOperation({ summary: 'Update a profile benchmark' })
async updateProfileBenchmark(
  @Param('id') id: string,
  @Param('benchmarkId') benchmarkId: string,
  @Body() updateDto: UpdateProfileBenchmarkDto
) {
  return this.profilesService.updateBenchmark(id, benchmarkId, updateDto);
}

@Delete(':id/benchmarks/:benchmarkId')
@ApiOperation({ summary: 'Delete a profile benchmark' })
async deleteProfileBenchmark(
  @Param('id') id: string,
  @Param('benchmarkId') benchmarkId: string
) {
  return this.profilesService.deleteBenchmark(id, benchmarkId);
}
```

#### 2.4 Update Module
**File**: `apps/api/src/modules/profiles/profiles.module.ts`

```typescript
TypeOrmModule.forFeature([
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,  // Add this
  GrafanaInstance,
  GrafanaDashboard
])
```

---

### Phase 3: Frontend Implementation

#### 3.1 Create API Client Functions
**File**: `apps/web/lib/profile-benchmarks.ts`

```typescript
import { authenticatedFetch } from './api';

export interface ProfileBenchmark {
  id: string;
  profileId: string;
  profileDashboardId: string;
  workloadPattern: string;
  source: string;
  dashboardLabel?: string;
  panelTitle?: string;
  evaluateType?: string;
  requirementOperator?: string;
  requirementValue?: number;
  description?: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileBenchmarkData {
  profileDashboardId: string;
  workloadPattern?: string;
  panelId?: number;
  evaluateType?: string;
  requirementOperator?: string;
  requirementValue?: number;
  // ... other fields
}

export async function fetchProfileBenchmarks(profileId: string): Promise<ProfileBenchmark[]> {
  const response = await authenticatedFetch(`/profiles/${profileId}/benchmarks`);
  if (!response.ok) {
    throw new Error('Failed to fetch profile benchmarks');
  }
  return response.json();
}

export async function createProfileBenchmark(
  profileId: string,
  data: CreateProfileBenchmarkData
): Promise<ProfileBenchmark> {
  const response = await authenticatedFetch(`/profiles/${profileId}/benchmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create profile benchmark');
  }
  return response.json();
}

export async function updateProfileBenchmark(
  profileId: string,
  benchmarkId: string,
  data: Partial<CreateProfileBenchmarkData>
): Promise<ProfileBenchmark> {
  const response = await authenticatedFetch(
    `/profiles/${profileId}/benchmarks/${benchmarkId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  if (!response.ok) {
    throw new Error('Failed to update profile benchmark');
  }
  return response.json();
}

export async function deleteProfileBenchmark(
  profileId: string,
  benchmarkId: string
): Promise<void> {
  const response = await authenticatedFetch(
    `/profiles/${profileId}/benchmarks/${benchmarkId}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    throw new Error('Failed to delete profile benchmark');
  }
}
```

#### 3.2 Add "Service Level Objectives" Tab to Profile Details
**File**: `apps/web/app/settings/profiles/[id]/page.tsx`

**Update**:
1. Add new tab: `<Tab label="Service Level Objectives" />`
2. Add TabPanel for SLOs (index 1)
3. Add state for benchmarks loading/data
4. Create `loadBenchmarks()` function similar to `loadDashboards()`

#### 3.3 Create Profile SLO Table Component
**File**: `apps/web/app/settings/profiles/[id]/components/ProfileSLOTable.tsx`

**Reuse from**: `apps/web/app/systems/[id]/config/components/SLOTable.tsx`

**Adaptations**:
- Remove system/environment/workload filtering (not needed at profile level)
- Add "Workload Pattern" column to show regex matching
- Add "Dashboard" column to show which profile dashboard it's linked to
- Keep evaluation type and requirement columns
- Keep actions (edit, delete)

#### 3.4 Create Profile SLO Dialog Components
**Files**:
- `apps/web/app/settings/profiles/[id]/components/AddProfileSLODialog.tsx`
- `apps/web/app/settings/profiles/[id]/components/EditProfileSLODialog.tsx`

**Reuse from**:
- `apps/web/app/systems/[id]/config/components/AddSLODialog.tsx`
- `apps/web/app/systems/[id]/config/components/EditSLODialog.tsx`

**Adaptations**:
1. **Dashboard Selection**: Instead of fetching application dashboards, fetch `profile_grafana_dashboards` for the current profile
2. **Panel Selection**: Fetch panels from the selected profile dashboard
3. **Workload Pattern**: Add text field for workload matching regex (default: '.*')
4. **Remove System/Environment/Workload selectors**: Not needed at profile level
5. **Keep all SLO configuration fields**:
   - Evaluate Type (avg, max, min, last, fit)
   - Requirement Operator & Value (Service Level Objective)
   - Advanced options (exclude ramp-up, match pattern, default values, etc.)

#### 3.5 Dialog Flow
```
1. User clicks "Add SLO" on Service Level Objectives tab
2. Dialog opens with:
   a. Dashboard dropdown (populated from profile_grafana_dashboards)
   b. Panel/Metric dropdown (populated from selected dashboard)
   c. Workload Pattern field (regex, default: .*)
   d. Evaluate Type selector
   e. Requirement section (operator + value)
   f. Advanced options (checkboxes and fields)
   g. Description and Tags
3. On submit:
   a. Validate form
   b. Call createProfileBenchmark API
   c. Refresh benchmarks list
   d. Close dialog
```

---

### Phase 4: Integration Points

#### 4.1 Auto-Application Logic (Future Enhancement)
When a test run is created/updated:
1. Match test run's workload against `workload_pattern` in `profile_benchmarks`
2. Auto-create entries in `benchmarks` table for matching profile benchmarks
3. This allows profile-level SLOs to be automatically applied to test runs

**Location**: Worker service or test run creation logic

#### 4.2 Validation
- Ensure `profile_dashboard_id` references an existing `profile_grafana_dashboards` record
- Validate panel ID exists in the dashboard
- Validate regex patterns for workload matching
- Prevent duplicate benchmarks for same dashboard/panel/workload combination

---

### Phase 5: Testing Strategy

#### 5.1 Backend Tests
- Unit tests for ProfilesService benchmark CRUD methods
- Integration tests for API endpoints
- Validation tests for DTOs
- Database constraint tests (foreign keys, cascades)

#### 5.2 Frontend Tests
- Component tests for ProfileSLOTable
- Dialog component tests
- API client function tests
- Integration tests for full flow

#### 5.3 E2E Tests
- Create profile benchmark flow
- Edit profile benchmark flow
- Delete profile benchmark flow
- Tab navigation and data loading

---

## Implementation Checklist

### Phase 1: Database & Entity
- [ ] Create `ProfileBenchmark` entity
- [ ] Create database migration
- [ ] Update entity barrel export
- [ ] Run migration on database
- [ ] Verify table structure

### Phase 2: Backend API
- [ ] Create DTOs (Create, Update, Response)
- [ ] Extend ProfilesService with benchmark methods
- [ ] Add controller endpoints
- [ ] Update ProfilesModule with entity
- [ ] Add Swagger documentation
- [ ] Write backend unit tests
- [ ] Test API endpoints manually

### Phase 3: Frontend Implementation
- [ ] Create `profile-benchmarks.ts` API client
- [ ] Add "Service Level Objectives" tab to profile details page
- [ ] Create ProfileSLOTable component
- [ ] Create AddProfileSLODialog component
- [ ] Create EditProfileSLODialog component
- [ ] Add benchmark loading logic
- [ ] Add CRUD handlers
- [ ] Add error handling and notifications

### Phase 4: Testing
- [ ] Backend unit tests
- [ ] Backend integration tests
- [ ] Frontend component tests
- [ ] E2E tests
- [ ] Manual testing of full flow

### Phase 5: Documentation
- [ ] Update API documentation
- [ ] Add user guide for profile SLOs
- [ ] Update CLAUDE.md with new feature
- [ ] Add migration notes

---

## Key Design Decisions

1. **Profile Dashboard Association**: `profile_benchmarks` references `profile_grafana_dashboards` (not direct Grafana dashboard references)
   - **Rationale**: Maintains consistency with profile configuration structure
   - **Benefit**: Dashboards are already configured with variables/presets per profile

2. **Workload Pattern Matching**: Use regex pattern instead of fixed workload
   - **Rationale**: Follows legacy `addForWorkloadsMatchingRegex` pattern
   - **Benefit**: Allows flexible matching (e.g., `load-.*` matches `load-100`, `load-500`, etc.)

3. **Reuse SUT SLO UI Components**: Adapt existing SLO dialog components
   - **Rationale**: Consistent UI/UX, faster implementation
   - **Changes**: Remove system/environment/workload selectors, add workload pattern field

4. **Cascade Delete**: `ON DELETE CASCADE` from profiles
   - **Rationale**: When profile is deleted, its benchmarks should be deleted
   - **Safety**: Prevents orphaned benchmarks

5. **Read-Only Flag**: Support read-only profile benchmarks (like dashboards)
   - **Rationale**: System/default profiles shouldn't be modified
   - **UI**: Disable edit/delete actions for read-only benchmarks

---

## Migration from Legacy System

For users migrating from legacy Perfana (MongoDB `genericChecks`):

```sql
-- Example migration query (conceptual)
INSERT INTO profile_benchmarks (
  profile_id,
  workload_pattern,
  dashboard_uid,
  panel_id,
  evaluate_type,
  requirement_operator,
  requirement_value,
  -- ... other fields
)
SELECT
  p.id as profile_id,
  gc.addForWorkloadsMatchingRegex as workload_pattern,
  gc.dashboardUid as dashboard_uid,
  gc.panel_id as panel_id,
  gc.panel_evaluateType as evaluate_type,
  gc.panel_requirement_operator as requirement_operator,
  gc.panel_requirement_value as requirement_value
FROM legacy_generic_checks gc
JOIN profiles p ON p.name = gc.profile;
```

---

## Future Enhancements

1. **Auto-Application**: Automatically create `benchmarks` entries for test runs matching profile
2. **Template System**: Allow copying profile benchmarks to other profiles
3. **Bulk Import/Export**: JSON import/export for profile benchmarks
4. **Benchmark Groups**: Group related benchmarks together
5. **Conditional Application**: Apply benchmarks based on additional conditions (tags, config values)
6. **Benchmark History**: Track changes to benchmark configurations over time

---

## References

- **Legacy genericChecks**: `/Users/daniel/workspace/perfana-fe/imports/collections/genericChecks.js`
- **Current Benchmark Entity**: `packages/shared/src/entities/benchmark.entity.ts`
- **Profile Dashboard Entity**: `packages/shared/src/entities/profile-grafana-dashboard.entity.ts`
- **System SLO UI**: `apps/web/app/systems/[id]/config/components/`
- **Profile Details Page**: `apps/web/app/settings/profiles/[id]/page.tsx`
