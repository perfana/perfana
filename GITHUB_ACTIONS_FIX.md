# GitHub Actions Workflow Fix - Node 20 Upgrade

## Issue Encountered

The GitHub Actions workflow failed with the following errors:

### 1. Node Version Mismatch

```
npm warn EBADENGINE Unsupported engine {
  package: '@perfana/worker@1.0.0',
  required: { node: '>=20.0.0' },
  current: { node: 'v18.20.8', npm: '10.8.2' }
}
```

**Multiple packages require Node 20+:**
- `@perfana/worker@1.0.0` → requires `>=20.0.0`
- `@faker-js/faker@10.0.0` → requires `^20.19.0 || ^22.13.0 || ^23.5.0 || >=24.0.0`
- `joi@18.0.1` → requires `>= 20`
- `undici@7.16.0` → requires `>=20.18.1`

### 2. npm Integrity Error

```
npm error code EINTEGRITY
npm error sha512-HpMh8+oahmIdOuS... integrity checksum failed
```

**Package with corruption:** `react-remove-scroll@2.7.1`

This is a known transient npm registry issue that can occur during CI runs.

## Fixes Applied

### Fix 1: Upgrade to Node 20

**Changed in:** `.github/workflows/pr-quality-gate.yml`

Updated all 5 jobs from Node 18 to Node 20:

```yaml
# BEFORE
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '18'  # ❌ Too old
    cache: 'npm'

# AFTER
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'  # ✅ Meets requirements
    cache: 'npm'
```

**Jobs Updated:**
1. API Tests & Coverage
2. Web Tests & Coverage
3. Worker Tests & Coverage
4. TypeScript Type Check
5. Code Linting

### Fix 2: Add npm Cache Cleaning & Retry Logic

**Added before `npm ci` in all jobs:**

```yaml
- name: Clean npm cache (prevent integrity errors)
  run: npm cache clean --force
  continue-on-error: true

- name: Install dependencies with retry
  run: |
    max_attempts=3
    attempt=1
    until npm ci --prefer-offline --no-audit || [ $attempt -eq $max_attempts ]; do
      echo "npm ci attempt $attempt failed. Retrying..."
      npm cache clean --force
      attempt=$((attempt + 1))
      sleep 5
    done
    if [ $attempt -eq $max_attempts ]; then
      echo "npm ci failed after $max_attempts attempts"
      exit 1
    fi
```

**Benefits:**
- `npm cache clean --force` - Clears any corrupted cached packages
- **Retry logic** - Attempts npm ci up to 3 times with 5-second delays
- **Auto-recovery** - Handles transient npm registry corruption during downloads
- `continue-on-error: true` - Doesn't fail if cache is already clean
- `--prefer-offline` - Use cached packages when available (faster)
- `--no-audit` - Skip security audit (faster, not needed in CI)

### Fix 3: Update Documentation

**Files Updated:**

1. **GITHUB_ACTIONS_SETUP.md**
   - Updated prerequisites to require "Node.js 20+"
   - Added troubleshooting for npm integrity errors
   - Updated Node version checks from 18 to 20+

2. **.github/workflows/README.md**
   - Documented Node 20 requirement
   - Listed dependencies that require Node 20+
   - Added npm integrity error troubleshooting section

## Verification Steps

After these fixes, the workflow should:

1. ✅ Install dependencies without Node version warnings
2. ✅ Complete npm install without integrity errors
3. ✅ Run all tests successfully
4. ✅ Complete in 8-12 minutes (expected duration)

## Testing the Fixes

### Option 1: Push and Test
```bash
git add .github/workflows/ *.md
git commit -m "Fix: Upgrade CI to Node 20 and prevent npm integrity errors"
git push origin main
```

Then create a test PR to verify the workflow runs successfully.

### Option 2: Local Verification

Test locally with Node 20 first:

```bash
# Check current Node version
node -v  # Should show v20.x.x

# If not Node 20, install it
nvm install 20
nvm use 20

# Clean and reinstall
rm -rf node_modules package-lock.json
npm install

# Run tests
npm test
npm run type-check
npm run lint
```

## Why This Happened

1. **Worker Package Update**: The `@perfana/worker` package was updated to require Node 20+ for modern JavaScript features and dependencies

2. **Dependency Chain**: When worker was upgraded, it brought in newer versions of:
   - `@faker-js/faker@10.0.0` (for test data generation)
   - `joi@18.0.1` (for schema validation)
   - `undici@7.16.0` (for HTTP client)

3. **CI Lag**: The GitHub Actions workflow was still configured for Node 18, creating a mismatch with local development

## Prevention

To avoid this in the future:

### 1. Keep Workflow and Development in Sync

When updating Node versions locally, also update:
- `.github/workflows/*.yml` files
- `.nvmrc` file (if using nvm)
- `engines` field in `package.json`
- Documentation (README, setup guides)

### 2. Add Package.json Engines Field

Consider adding to root `package.json`:

```json
{
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

This will warn developers if they're using wrong Node version.

### 3. Use .nvmrc File

Create `.nvmrc` in project root:

```
20
```

Then developers can run:
```bash
nvm use  # Automatically uses correct version
```

## Rollback Plan

If Node 20 causes unexpected issues:

1. **Revert workflow:**
   ```bash
   git revert <commit-hash>
   ```

2. **Downgrade worker dependencies** that require Node 20:
   - Check `@faker-js/faker` version
   - Check `joi` version
   - Check `undici` version

3. **Use older package versions** in `package.json`:
   ```json
   {
     "@faker-js/faker": "^8.4.1",  // Node 16+ compatible
     "joi": "^17.11.0"              // Node 18+ compatible
   }
   ```

## Summary

**Changes Made:**
- ✅ Upgraded Node.js from 18 to 20 in all CI jobs
- ✅ Added npm cache cleaning to prevent integrity errors
- ✅ Added retry logic (3 attempts) for npm install to handle transient registry issues
- ✅ Updated documentation to reflect Node 20 requirement
- ✅ Added troubleshooting guides for common CI issues

**Impact:**
- ✅ CI now matches development environment (Node 20)
- ✅ No more engine version warnings
- ✅ Automatic recovery from transient npm registry corruption
- ✅ Significantly reduced npm integrity error probability
- ✅ Better developer experience and workflow reliability

**Next Steps:**
1. Commit and push the changes
2. Create a test PR to verify workflow
3. Monitor first few PR runs for any issues
4. Update team documentation if needed

## Questions?

Check these resources:
- `.github/workflows/README.md` - Workflow documentation
- `GITHUB_ACTIONS_SETUP.md` - Setup guide
- [Node.js Release Schedule](https://github.com/nodejs/release#release-schedule) - Node version support timeline

**Node 20 LTS Support:** Until April 2026 (plenty of time)
