# Runtime Configuration Implementation Plan

**Date:** 2025-11-21
**Status:** Planned (Not Implemented)
**Objective:** Convert perfana-web from build-time `NEXT_PUBLIC_*` environment variables to runtime configuration

---

## Problem Statement

Currently, perfana-web requires rebuilding the Docker image whenever Keycloak realm or API URL changes because Next.js bakes `NEXT_PUBLIC_*` environment variables into the client bundle at build time. This means:

- Different Docker images needed for dev/staging/prod environments
- Cannot change configuration without rebuilding
- Keycloak realm hardcoded at build time (e.g., `perfana` vs `perfana-prod`)

---

## Solution: Runtime Config API Endpoint

Create a Next.js API route that serves environment variables at runtime, allowing a single Docker image to work across all environments.

---

## Implementation Steps

### 1. Create Runtime Config API Endpoint

**File:** `apps/web/app/api/config/route.ts` (NEW)

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
    KEYCLOAK_URL: process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080',
    KEYCLOAK_REALM: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'perfana',
    KEYCLOAK_CLIENT_ID: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || 'perfana-web',
    USE_KEYCLOAK_AUTH: process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH === 'true',
  });
}
```

---

### 2. Modify Environment Configuration Module

**File:** `apps/web/lib/env.ts` (MODIFY)

```typescript
// Runtime config cache
let runtimeConfig: RuntimeConfig | null = null;
let configPromise: Promise<RuntimeConfig> | null = null;

interface RuntimeConfig {
  API_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  KEYCLOAK_CLIENT_ID: string;
  USE_KEYCLOAK_AUTH: boolean;
}

/**
 * Load runtime configuration from /api/config endpoint
 * Called once at app initialization before Keycloak setup
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfig) {
    return runtimeConfig;
  }

  if (configPromise) {
    return configPromise;
  }

  configPromise = fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      runtimeConfig = config;
      return config;
    })
    .catch(error => {
      console.error('Failed to load runtime config:', error);
      // Fallback to build-time env vars for development
      runtimeConfig = {
        API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
        KEYCLOAK_URL: process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080',
        KEYCLOAK_REALM: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'perfana',
        KEYCLOAK_CLIENT_ID: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || 'perfana-web',
        USE_KEYCLOAK_AUTH: process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH === 'true',
      };
      return runtimeConfig;
    });

  return configPromise;
}

/**
 * Get runtime configuration (must call loadRuntimeConfig first)
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    throw new Error('Runtime config not loaded. Call loadRuntimeConfig() first.');
  }
  return runtimeConfig;
}

// Export individual config values with getters
export const env = {
  get API_URL() {
    return getRuntimeConfig().API_URL;
  },
  get KEYCLOAK_URL() {
    return getRuntimeConfig().KEYCLOAK_URL;
  },
  get KEYCLOAK_REALM() {
    return getRuntimeConfig().KEYCLOAK_REALM;
  },
  get KEYCLOAK_CLIENT_ID() {
    return getRuntimeConfig().KEYCLOAK_CLIENT_ID;
  },
  get USE_KEYCLOAK_AUTH() {
    return getRuntimeConfig().USE_KEYCLOAK_AUTH;
  },
};
```

---

### 3. Update Keycloak Auth Service

**File:** `apps/web/lib/keycloak-auth.ts` (MODIFY)

Change the singleton pattern to lazy initialization:

```typescript
import Keycloak from 'keycloak-js';
import { getRuntimeConfig } from './env';

class KeycloakAuthService {
  private static instance: KeycloakAuthService | null = null;
  private keycloak: Keycloak | null = null;
  private initialized = false;

  private constructor() {
    // Don't initialize Keycloak in constructor anymore
  }

  public static getInstance(): KeycloakAuthService {
    if (!KeycloakAuthService.instance) {
      KeycloakAuthService.instance = new KeycloakAuthService();
    }
    return KeycloakAuthService.instance;
  }

  /**
   * Initialize Keycloak with runtime config
   * Must be called after loadRuntimeConfig()
   */
  async init(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    const config = getRuntimeConfig();

    this.keycloak = new Keycloak({
      url: config.KEYCLOAK_URL,
      realm: config.KEYCLOAK_REALM,
      clientId: config.KEYCLOAK_CLIENT_ID,
    });

    try {
      const authenticated = await this.keycloak.init({
        onLoad: 'check-sso',
        checkLoginIframe: false,
      });

      this.initialized = true;
      return authenticated;
    } catch (error) {
      console.error('Keycloak initialization failed:', error);
      throw error;
    }
  }

  // ... rest of the methods remain the same
}

export default KeycloakAuthService.getInstance();
```

---

### 4. Update Auth Context

**File:** `apps/web/contexts/auth-context.tsx` (MODIFY)

Update the initialization sequence:

```typescript
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import keycloakAuth from '@/lib/keycloak-auth';
import { loadRuntimeConfig } from '@/lib/env';

// ... existing context interface ...

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    async function initAuth() {
      try {
        setIsLoading(true);

        // STEP 1: Load runtime configuration first
        await loadRuntimeConfig();

        // STEP 2: Initialize Keycloak with loaded config
        const authenticated = await keycloakAuth.init();

        setIsAuthenticated(authenticated);
        if (authenticated) {
          const profile = await keycloakAuth.loadUserProfile();
          setUser(profile);
        }
      } catch (error) {
        console.error('Auth initialization failed:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initAuth();
  }, []);

  // ... rest of the provider implementation
}
```

---

### 5. Update Dockerfile

**File:** `Dockerfile` (MODIFY)

**Remove these sections:**

```dockerfile
# Lines 28-32: Remove build args
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_KEYCLOAK_URL
ARG NEXT_PUBLIC_KEYCLOAK_REALM
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
ARG NEXT_PUBLIC_USE_KEYCLOAK_AUTH

# Lines 124-140: Remove builder stage args and ENV settings
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_KEYCLOAK_URL
ARG NEXT_PUBLIC_KEYCLOAK_REALM
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
ARG NEXT_PUBLIC_USE_KEYCLOAK_AUTH

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL
ENV NEXT_PUBLIC_KEYCLOAK_REALM=$NEXT_PUBLIC_KEYCLOAK_REALM
ENV NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
ENV NEXT_PUBLIC_USE_KEYCLOAK_AUTH=$NEXT_PUBLIC_USE_KEYCLOAK_AUTH
```

**Add runtime ENV in web stage (after line 208):**

```dockerfile
# Environment variables for production
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NEXT_PUBLIC_API_URL="" \
    NEXT_PUBLIC_KEYCLOAK_URL="" \
    NEXT_PUBLIC_KEYCLOAK_REALM="" \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="" \
    NEXT_PUBLIC_USE_KEYCLOAK_AUTH="true"
```

---

### 6. Update Build Script

**File:** `build-m1.sh` (MODIFY)

Remove lines 62-66:

```bash
# DELETE THESE LINES:
--build-arg NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:3001/api} \
--build-arg NEXT_PUBLIC_KEYCLOAK_URL=${NEXT_PUBLIC_KEYCLOAK_URL:-http://localhost:8080} \
--build-arg NEXT_PUBLIC_KEYCLOAK_REALM=${NEXT_PUBLIC_KEYCLOAK_REALM:-perfana} \
--build-arg NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=${NEXT_PUBLIC_KEYCLOAK_CLIENT_ID:-perfana-web} \
--build-arg NEXT_PUBLIC_USE_KEYCLOAK_AUTH=${NEXT_PUBLIC_USE_KEYCLOAK_AUTH:-true} \
```

Now the build command becomes environment-agnostic!

---

### 7. Update Test Configuration

**File:** `apps/web/jest.setup.js` (MODIFY)

Mock the `/api/config` endpoint:

```javascript
// Mock the runtime config API endpoint
global.fetch = jest.fn((url) => {
  if (url === '/api/config') {
    return Promise.resolve({
      json: () => Promise.resolve({
        API_URL: 'http://localhost:3001/api',
        KEYCLOAK_URL: 'http://localhost:8080',
        KEYCLOAK_REALM: 'perfana-test',
        KEYCLOAK_CLIENT_ID: 'perfana-web-test',
        USE_KEYCLOAK_AUTH: false,
      }),
    });
  }
  return Promise.reject(new Error('Unknown URL'));
});
```

---

## Docker Compose Configuration

**File:** `perfana-demo/docker-compose-next-gen.yml`

No changes needed! The existing environment variables will now be read at runtime:

```yaml
perfana-web:
  image: perfana/perfana-web:0.1.0
  environment:
    NEXT_PUBLIC_API_URL: http://localhost:3001/api
    NEXT_PUBLIC_KEYCLOAK_URL: http://localhost:8080
    NEXT_PUBLIC_KEYCLOAK_REALM: perfana-prod  # Can now change without rebuild!
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: perfana-web
    NEXT_PUBLIC_USE_KEYCLOAK_AUTH: "true"
```

---

## Testing Plan

### Local Development Testing
1. Run `npm run dev` in `apps/web`
2. Navigate to `http://localhost:4001`
3. Verify `/api/config` endpoint returns correct values
4. Verify Keycloak initializes with correct realm
5. Run unit tests: `npm test`

### Docker Testing
1. Build image: `./build-m1.sh`
2. Run with different environments:
   ```bash
   # Test with perfana realm
   docker run -e NEXT_PUBLIC_KEYCLOAK_REALM=perfana -p 3000:3000 perfana/perfana-web:0.1.0

   # Test with perfana-prod realm (same image!)
   docker run -e NEXT_PUBLIC_KEYCLOAK_REALM=perfana-prod -p 3000:3000 perfana/perfana-web:0.1.0
   ```
3. Verify both work with the same Docker image

### Integration Testing
1. Start full docker-compose stack
2. Change `NEXT_PUBLIC_KEYCLOAK_REALM` in docker-compose
3. Restart only perfana-web (not rebuild!)
4. Verify authentication works with new realm

---

## Benefits

✅ **Single Build for All Environments**
- Build once, deploy anywhere
- No more separate images for dev/staging/prod

✅ **Easy Configuration Changes**
- Change realm without rebuilding
- Update API URLs on the fly

✅ **Security Maintained**
- Still uses distroless base image
- No shell access in container

✅ **Backward Compatible**
- Works with existing .env.local for development
- No breaking changes to API consumers

✅ **Type Safe**
- Full TypeScript support maintained
- Runtime errors caught during development

---

## Risks & Mitigations

⚠️ **Risk:** Initialization delay from extra API call
**Mitigation:** Config cached in memory, fetched only once. Delay is ~10-50ms.

⚠️ **Risk:** Race condition if Keycloak initializes before config loads
**Mitigation:** Explicit async/await ensures config loads first. Loading state prevents premature rendering.

⚠️ **Risk:** Tests break with async config pattern
**Mitigation:** Mock `/api/config` in jest.setup.js with synchronous response.

⚠️ **Risk:** SSR pages might fail if config not loaded
**Mitigation:** Use client components for authenticated pages. Server components can read env vars directly.

---

## Rollback Plan

If critical issues arise:

1. **Immediate:** Revert Dockerfile changes (restore build args)
2. **Quick:** Revert `lib/env.ts` changes
3. **Full:** Git revert entire commit
4. **Rebuild:** Run `./build-m1.sh` with explicit build args

All changes are designed to be non-breaking, so partial rollback is possible.

---

## Related Files

- `Dockerfile` (lines 28-32, 124-140, 208)
- `build-m1.sh` (lines 62-66)
- `apps/web/lib/env.ts`
- `apps/web/lib/keycloak-auth.ts`
- `apps/web/contexts/auth-context.tsx`
- `apps/web/jest.setup.js`
- `apps/web/app/api/config/route.ts` (NEW)

---

## References

- [Next.js Runtime Configuration](https://nextjs.org/docs/pages/api-reference/next-config-js/runtime-configuration)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Keycloak JavaScript Adapter](https://www.keycloak.org/docs/latest/securing_apps/#_javascript_adapter)

---

## Implementation Status

- [ ] Create `app/api/config/route.ts`
- [ ] Modify `lib/env.ts`
- [ ] Update `lib/keycloak-auth.ts`
- [ ] Update `contexts/auth-context.tsx`
- [ ] Update `Dockerfile`
- [ ] Update `build-m1.sh`
- [ ] Update `jest.setup.js`
- [ ] Test locally
- [ ] Test in Docker
- [ ] Test in docker-compose
- [ ] Update documentation
