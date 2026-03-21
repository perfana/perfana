# Test Infrastructure Fix Plan

## Problem Statement

The test suite is failing due to TypeORM entity metadata loading issues. The root cause is that:

1. **Tests import entities from `@perfana/shared/entities`** which resolves to compiled JavaScript files in `packages/shared/dist/`
2. **ts-jest cannot compile `.js` files** without `allowJs` enabled
3. **Enabling `allowJs` breaks Jest's coverage instrumentation** (tries to instrument compiled files)
4. **TypeORM entity metadata fails to load correctly** from compiled files, causing relationship errors like:
   ```
   TypeORMError: Entity metadata for SystemUnderTest#pyroscopeInstance was not found
   TypeORMError: Entity metadata for AwrReport#testRun was not found
   ```

## Current Architecture

```
@perfana/shared/
├── src/
│   ├── entities/
│   │   ├── *.entity.ts         # TypeScript source files
│   │   └── index.ts            # Barrel export
│   └── ...
├── dist/
│   ├── entities/
│   │   ├── *.entity.js         # Compiled JavaScript
│   │   ├── *.entity.d.ts       # Type definitions
│   │   └── index.js            # Compiled barrel export
│   └── ...
└── package.json
    └── "exports": {
          "./entities": {
            "types": "./dist/entities/index.d.ts",
            "default": "./dist/entities/index.js"  # <-- Problem: Points to compiled files
          }
        }
```

**Runtime (Production):** Apps import from `dist/` (compiled JavaScript) ✅
**Tests (Development):** Apps need to import from `src/` (TypeScript source) ❌

## Solution Options

### Option A: Dual Export Paths (Recommended)

Add conditional exports that use source files for tests and compiled files for production.

**Pros:**
- Clean separation of concerns
- No changes to test files
- Works with TypeScript's path resolution
- Compatible with ts-jest

**Cons:**
- Requires Node.js 12.20+ with conditional exports support
- Slightly more complex package.json

**Implementation:**

1. **Update `packages/shared/package.json`:**

```json
{
  "exports": {
    "./entities": {
      "types": "./dist/entities/index.d.ts",
      "development": "./src/entities/index.ts",
      "default": "./dist/entities/index.js"
    },
    "./types": {
      "types": "./dist/types/index.d.ts",
      "development": "./src/types/index.ts",
      "default": "./dist/types/index.js"
    },
    // ... other exports
  },
  "conditions": ["development"]
}
```

2. **Set NODE_ENV in test environments:**

```javascript
// apps/api/src/test/setup.ts
process.env.NODE_ENV = 'test'; // Already set
process.env.NODE_ENV = 'development'; // Add this
```

3. **Configure TypeScript for tests:**

No changes needed - TypeScript will follow the `development` condition.

4. **Update Jest moduleNameMapper (fallback):**

Keep existing mappings as fallback:

```javascript
// apps/api/jest.config.js
moduleNameMapper: {
  '^jose$': '<rootDir>/src/test/__mocks__/jose.ts',
  '^bullmq$': '<rootDir>/src/test/__mocks__/bullmq.ts',
  '^@perfana/shared/entities$': '<rootDir>/../../packages/shared/src/entities/index.ts',
  '^@perfana/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  '^@perfana/shared$': '<rootDir>/../../packages/shared/src/index.ts',
}
```

**Estimated Time:** 2-3 hours
**Risk:** Low
**Impact:** Fixes all entity loading issues

---

### Option B: TypeScript Project References Only

Use TypeScript project references and ensure tests only use source files.

**Pros:**
- Simpler than dual exports
- Standard TypeScript approach
- Already partially implemented

**Cons:**
- Requires changes to multiple test files
- Global setup still problematic
- May not work with runtime TypeORM entity discovery

**Implementation:**

1. **Update all test files that import entities:**

```typescript
// Before
import * as sharedEntities from '@perfana/shared/entities';

// After
import * as sharedEntities from '../../../../packages/shared/src/entities';
```

2. **Update `apps/api/src/test/global-setup.ts`:**

Already done:
```typescript
import * as sharedEntities from '../../../../packages/shared/src/entities';
```

3. **Update Jest moduleNameMapper in all apps:**

Already done for API, need to verify others.

4. **Ensure TypeScript paths are correct:**

```json
// apps/api/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@perfana/shared": ["../../packages/shared/src"],
      "@perfana/shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

**Estimated Time:** 3-4 hours
**Risk:** Medium (requires many file changes)
**Impact:** Fixes entity loading but requires ongoing discipline

---

### Option C: Separate Test Entity Package

Create a separate test-only entity package that exports TypeScript source.

**Pros:**
- Clear separation of test vs production
- No conditional logic needed
- Easy to maintain

**Cons:**
- Code duplication
- Synchronization burden
- More complex monorepo structure

**Implementation:**

1. **Create `packages/shared-test` package:**

```
packages/shared-test/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts  # Re-exports from ../shared/src
```

2. **Update test imports:**

```typescript
// Before
import * as sharedEntities from '@perfana/shared/entities';

// After
import * as sharedEntities from '@perfana/shared-test/entities';
```

3. **Configure package.json:**

```json
{
  "name": "@perfana/shared-test",
  "main": "src/index.ts",
  "exports": {
    "./entities": "./src/entities/index.ts"
  }
}
```

**Estimated Time:** 4-5 hours
**Risk:** Medium
**Impact:** Clean separation but adds maintenance overhead

---

## Recommended Implementation Plan

**Choose Option A: Dual Export Paths**

### Phase 1: Update Shared Package (30 min)

1. ✅ Modify `packages/shared/package.json` to add `development` condition to all exports
2. ✅ Verify TypeScript compilation still works
3. ✅ Test that production builds still use `dist/` files

### Phase 2: Configure Test Environments (1 hour)

1. ✅ Update `apps/api/src/test/setup.ts` to set `NODE_ENV=development`
2. ✅ Update `apps/grafana-sync/test/setup.ts` similarly
3. ✅ Update `apps/worker/src/test/setup.ts` similarly
4. ✅ Keep existing Jest moduleNameMapper as fallback
5. ✅ Verify tsconfig.test.json has correct paths

### Phase 3: Test and Verify (1-2 hours)

1. ✅ Run API tests: `cd apps/api && npm test`
2. ✅ Run Web tests: `cd apps/web && npm test`
3. ✅ Run Grafana Sync tests: `cd apps/grafana-sync && npm test`
4. ✅ Run Worker tests: `cd apps/worker && npm test`
5. ✅ Verify TypeORM entity metadata loads correctly
6. ✅ Check that no `.js` file compilation warnings appear

### Phase 4: Coverage and SonarQube (30 min)

1. ✅ Generate coverage: `npm run test:coverage`
2. ✅ Fix coverage paths: `npm run fix-coverage-paths`
3. ✅ Run SonarQube scan: `npm run sonar:scan`
4. ✅ Verify coverage reports are accurate

## Alternative Quick Fix (If Dual Exports Don't Work)

If conditional exports cause issues with older Node versions or build tools:

### Fallback: Direct Source Imports

1. **Update `apps/api/src/test/global-setup.ts`:**
   - Already using direct import: ✅

2. **Update Jest config to transform `@perfana/shared` source:**

```javascript
// apps/api/jest.config.js
module.exports = {
  // ... existing config
  transformIgnorePatterns: [
    'node_modules/(?!@perfana/shared)', // Allow transforming @perfana/shared
  ],
  moduleNameMapper: {
    '^@perfana/shared/entities$': '<rootDir>/../../packages/shared/src/entities/index.ts',
    '^@perfana/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};
```

3. **Ensure all test files use mapped paths:**
   - Let Jest handle the mapping automatically

## Success Criteria

- ✅ All test suites pass without TypeORM entity metadata errors
- ✅ No ts-jest warnings about compiling `.js` files
- ✅ Coverage reports generate successfully for all 4 apps
- ✅ SonarQube scan completes with accurate coverage data
- ✅ Production builds continue to use compiled `dist/` files
- ✅ No performance degradation in test execution time

## Files to Modify

### Required Changes
1. `packages/shared/package.json` - Add conditional exports
2. `apps/api/src/test/setup.ts` - Set NODE_ENV=development
3. `apps/grafana-sync/test/setup.ts` - Set NODE_ENV=development
4. `apps/worker/src/test/setup.ts` - Set NODE_ENV=development

### Already Updated
1. ✅ `apps/api/jest.config.js` - moduleNameMapper configured
2. ✅ `apps/api/src/test/global-setup.ts` - Direct source import
3. ✅ `apps/worker/vitest.config.ts` - Alias configured
4. ✅ `apps/worker/vitest.integration.config.ts` - Alias configured
5. ✅ `apps/grafana-sync/jest.config.js` - moduleNameMapper configured

### Verification
1. ✅ `apps/api/tsconfig.json` - Paths configured
2. ✅ `apps/api/tsconfig.test.json` - Test config (may need strictNullChecks: false removed later)

## Rollback Plan

If the fix causes production issues:

1. **Revert `packages/shared/package.json`** to original exports
2. **Remove NODE_ENV=development** from test setup files
3. **Keep moduleNameMapper changes** - they're harmless in production
4. **Use Option B** (direct source imports) as fallback

## Future Improvements

After fixing the immediate issue:

1. **Re-enable strict TypeScript checks in tests:**
   - Remove `strictNullChecks: false` from `tsconfig.test.json`
   - Fix encryption.ts null safety issues in shared package

2. **Consolidate test configurations:**
   - Create shared test config in `tsconfig.test.base.json`
   - Extend in all apps for consistency

3. **Add CI/CD checks:**
   - Verify tests work with both source and dist files
   - Add pre-publish hook to ensure dist is up-to-date

4. **Document the pattern:**
   - Update CLAUDE.md with dual export pattern explanation
   - Add comments in package.json explaining the setup

## Estimated Total Time

- **Option A (Recommended):** 2-3 hours
- **Option B (Fallback):** 3-4 hours
- **Option C (Alternative):** 4-5 hours

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Conditional exports break production | Low | High | Test production build before deploying |
| Tests still fail after changes | Medium | Medium | Have rollback plan ready |
| Coverage reports inaccurate | Low | Medium | Verify lcov paths after changes |
| TypeORM still can't find entities | Low | High | Fall back to Option B |

## Next Steps

1. **Immediate:** Implement Option A (Dual Export Paths)
2. **Verify:** Run full test suite and check for errors
3. **Validate:** Generate coverage and run SonarQube scan
4. **Document:** Update CLAUDE.md with the solution
5. **Monitor:** Watch for any issues in CI/CD pipeline
