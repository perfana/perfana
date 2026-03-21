# Phase 6: Keycloak Authentication Migration

## 🎯 Overview

This document details Phase 6 of the Perfana PostgreSQL migration: replacing Supabase Auth with Keycloak for enterprise-grade identity management. This phase completes the migration away from Supabase services while providing enhanced authentication capabilities.

**Migration Context**: Part of the broader [Supabase to PostgreSQL Migration](./MIGRATION_SUPABASE_TO_POSTGRES.md) - Phase 6 authentication overhaul.

---

## 📊 Current Authentication Analysis

### Existing Supabase Auth Dependencies

**Backend Components:**
- `CombinedAuthGuard` (`apps/api/src/guards/combined-auth.guard.ts`)
  - Dual authentication: Supabase JWT + API Keys
  - Uses `supabase.auth.getUser()` for validation
  - Sets `authType: 'supabase-jwt'` for admin endpoints

**Frontend Components:**
- Minimal Supabase client (`apps/web/lib/supabase.ts`)
- Token storage: `perfana_access_token`, `perfana_refresh_token`
- Auth endpoints: signin, signup, refresh, reset-password

**Dependencies to Replace:**
- `@supabase/supabase-js` in backend and frontend
- Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- 16 Supabase Auth tables (users, sessions, refresh_tokens, etc.)

---

## 🏗️ Target Keycloak Architecture

### High-Level Flow
```
┌─────────────────┐    OIDC/PKCE     ┌─────────────────┐
│  Frontend App   │◄─────────────────┤    Keycloak     │
│  (React/Next)   │   Bearer JWT     │  (Auth Server)  │
└─────────┬───────┘                  └─────────────────┘
          │ API Calls                          │
          │ Authorization: Bearer <token>      │ OAuth Providers
          ▼                                    ▼ (Google/GitHub)
┌─────────────────┐                  ┌─────────────────┐
│   NestJS API    │                  │  External IdPs  │
│ - JWT Validation│                  │                 │
│ - Session Context│                 └─────────────────┘
└─────────┬───────┘
          │ SET LOCAL app.current_user_id
          ▼
┌─────────────────┐
│   PostgreSQL    │
│   with RLS      │
└─────────────────┘
```

### Keycloak Configuration

**Realm**: `perfana-prod`
**Clients**:
- `perfana-web` (Public OIDC client for frontend)
- `perfana-api` (Confidential client for backend)

**Key Features**:
- JWT tokens with custom claims (organizations, teams, roles)
- OAuth2/OIDC compliance
- PostgreSQL session context integration
- Preserve existing API key authentication

---

## 🔄 Implementation Phases

### Phase 6.1: Keycloak Infrastructure Setup

**Duration**: 3-4 days

**Tasks**:
1. **Deploy Keycloak with Docker**
```yaml
# docker-compose.keycloak.yml
version: '3.8'
services:
  keycloak-postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: ${KEYCLOAK_DB_PASSWORD}
    volumes:
      - keycloak_db_data:/var/lib/postgresql/data

  keycloak:
    image: quay.io/keycloak/keycloak:24.0
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://keycloak-postgres:5432/keycloak
      KC_HOSTNAME: auth.perfana.dev
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD}
    ports:
      - "8080:8080"
    command: ["start-dev"]
```

2. **Configure Realm and Clients**
```json
{
  "realm": "perfana-prod",
  "enabled": true,
  "registrationAllowed": true,
  "loginTheme": "perfana",
  "clients": [
    {
      "clientId": "perfana-web",
      "protocol": "openid-connect",
      "publicClient": true,
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "redirectUris": ["http://localhost:3000/*", "https://app.perfana.io/*"],
      "webOrigins": ["http://localhost:3000", "https://app.perfana.io"]
    },
    {
      "clientId": "perfana-api",
      "protocol": "openid-connect",
      "publicClient": false,
      "serviceAccountsEnabled": true,
      "authorizationServicesEnabled": true
    }
  ]
}
```

**Deliverables**:
- Operational Keycloak instance
- Configured realm with clients
- OAuth providers (Google, GitHub) set up
- Backup/restore procedures tested

### Phase 6.2: Backend JWT Integration

**Duration**: 4-5 days

**Tasks**:
1. **Install Dependencies**
```bash
npm install jose @keycloak/keycloak-admin-client
```

2. **Create Keycloak JWT Service**
```typescript
// apps/api/src/modules/auth/keycloak-jwt.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KeycloakJwtService {
  private jwks;
  private issuer: string;

  constructor(private configService: ConfigService) {
    this.issuer = `${this.configService.get('KEYCLOAK_URL')}/realms/perfana-prod`;
    const jwksUrl = `${this.issuer}/protocol/openid-connect/certs`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async validateToken(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'perfana-api'
      });

      return {
        sub: payload.sub,
        email: payload.email,
        roles: payload.realm_access?.roles || [],
        organizations: payload.organizations || [],
        teams: payload.teams || [],
        sessionId: payload.sid
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid Keycloak token');
    }
  }
}
```

3. **Update CombinedAuthGuard for Triple Authentication**
```typescript
// apps/api/src/guards/enhanced-auth.guard.ts
@Injectable()
export class EnhancedAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private apiKeysService: ApiKeysService,
    private keycloakJwtService: KeycloakJwtService,
    private supabaseService: any // Fallback during migration
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    // 1. Try API Key authentication (highest priority)
    try {
      const isValidApiKey = await this.apiKeysService.validateApiKey(token);
      if (isValidApiKey) {
        request.authType = 'api-key';
        return true;
      }
    } catch {}

    // 2. Try Keycloak JWT authentication
    try {
      const user = await this.keycloakJwtService.validateToken(token);
      request.user = user;
      request.authType = 'keycloak-jwt';
      return true;
    } catch {}

    // 3. Fallback to Supabase JWT (during migration only)
    if (process.env.MIGRATION_MODE === 'true') {
      try {
        const { data: { user }, error } = await this.supabaseService.auth.getUser(token);
        if (!error && user) {
          request.user = user;
          request.authType = 'supabase-jwt';
          return true;
        }
      } catch {}
    }

    throw new UnauthorizedException('Invalid or expired token');
  }
}
```

4. **Database Session Context Middleware**
```typescript
// apps/api/src/middleware/db-session.middleware.ts
@Injectable()
export class DatabaseSessionMiddleware implements NestMiddleware {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async use(req: any, res: any, next: () => void) {
    if (req.user && req.authType === 'keycloak-jwt') {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();

      try {
        await queryRunner.startTransaction();

        // Set PostgreSQL session variables for RLS
        await queryRunner.query('SET LOCAL app.current_user_id = $1', [req.user.sub]);
        await queryRunner.query('SET LOCAL app.current_user_email = $1', [req.user.email]);
        await queryRunner.query('SET LOCAL app.current_user_roles = $1', [
          JSON.stringify(req.user.roles)
        ]);

        // Attach queryRunner to request
        req.queryRunner = queryRunner;

        res.on('finish', async () => {
          await queryRunner.commitTransaction();
          await queryRunner.release();
        });

        next();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        await queryRunner.release();
        throw error;
      }
    } else {
      next();
    }
  }
}
```

**Deliverables**:
- Keycloak JWT validation service
- Enhanced authentication guard with triple auth
- Database session context integration
- Unit tests for auth components

### Phase 6.3: Frontend OIDC Integration

**Duration**: 3-4 days

**Tasks**:
1. **Install Keycloak JavaScript Adapter**
```bash
npm install keycloak-js
```

2. **Create Keycloak Auth Service**
```typescript
// apps/web/lib/keycloak-auth.ts
import Keycloak from 'keycloak-js';

class KeycloakAuthService {
  private keycloak: Keycloak;
  private static instance: KeycloakAuthService;

  private constructor() {
    this.keycloak = new Keycloak({
      url: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
      realm: 'perfana-prod',
      clientId: 'perfana-web'
    });
  }

  static getInstance(): KeycloakAuthService {
    if (!KeycloakAuthService.instance) {
      KeycloakAuthService.instance = new KeycloakAuthService();
    }
    return KeycloakAuthService.instance;
  }

  async init(): Promise<boolean> {
    try {
      const authenticated = await this.keycloak.init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
        pkceMethod: 'S256'
      });

      if (authenticated) {
        this.setupTokenRefresh();
        this.storeTokens();
      }

      return authenticated;
    } catch (error) {
      console.error('Keycloak initialization failed', error);
      return false;
    }
  }

  private setupTokenRefresh() {
    setInterval(() => {
      this.keycloak.updateToken(30).then(refreshed => {
        if (refreshed) {
          this.storeTokens();
        }
      }).catch(() => {
        this.logout();
      });
    }, 60000);
  }

  private storeTokens() {
    if (this.keycloak.token) {
      localStorage.setItem('perfana_access_token', this.keycloak.token);
    }
    if (this.keycloak.refreshToken) {
      localStorage.setItem('perfana_refresh_token', this.keycloak.refreshToken);
    }
  }

  login(): Promise<void> {
    return this.keycloak.login({
      redirectUri: window.location.origin + '/dashboard'
    });
  }

  logout(): Promise<void> {
    localStorage.removeItem('perfana_access_token');
    localStorage.removeItem('perfana_refresh_token');
    return this.keycloak.logout({
      redirectUri: window.location.origin
    });
  }

  getToken(): string | undefined {
    return this.keycloak.token;
  }

  getUserInfo(): any {
    return this.keycloak.tokenParsed;
  }

  hasRole(role: string): boolean {
    return this.keycloak.hasRealmRole(role);
  }
}

export default KeycloakAuthService.getInstance();
```

3. **Create Auth Context Provider**
```typescript
// apps/web/contexts/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import keycloakAuth from '../lib/keycloak-auth';

interface AuthContextType {
  authenticated: boolean;
  user: any;
  login: () => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    keycloakAuth.init().then(auth => {
      setAuthenticated(auth);
      if (auth) {
        setUser(keycloakAuth.getUserInfo());
      }
      setLoading(false);
    });
  }, []);

  const value = {
    authenticated,
    user,
    login: () => keycloakAuth.login(),
    logout: () => keycloakAuth.logout(),
    hasRole: (role: string) => keycloakAuth.hasRole(role),
    loading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

4. **Update API Client for Token Injection**
```typescript
// apps/web/lib/api-client.ts
import keycloakAuth from './keycloak-auth';

function getAuthHeaders(): Record<string, string> {
  const token = keycloakAuth.getToken() || localStorage.getItem('perfana_access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export async function apiCall(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    // Token expired, try to refresh or redirect to login
    try {
      await keycloakAuth.updateToken(0);
      // Retry the request with new token
      return fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...options.headers,
        },
      });
    } catch {
      keycloakAuth.login();
      throw new Error('Authentication required');
    }
  }

  return response;
}
```

**Deliverables**:
- Keycloak OIDC integration
- React auth context provider
- Updated API client with token management
- Protected route components

### Phase 6.4: User Migration

**Duration**: 2-3 days

**Tasks**:
1. **Export Supabase Users**
```typescript
// scripts/export-supabase-users.ts
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function exportUsers() {
  const { data: users, error } = await supabase.auth.admin.listUsers();

  if (error) throw error;

  const keycloakUsers = users.map(user => ({
    username: user.email,
    email: user.email,
    emailVerified: user.email_confirmed_at !== null,
    enabled: true,
    firstName: user.user_metadata?.first_name || '',
    lastName: user.user_metadata?.last_name || '',
    attributes: {
      supabase_id: [user.id],
      created_at: [user.created_at],
      ...Object.entries(user.user_metadata || {}).reduce((acc, [key, value]) => ({
        ...acc,
        [key]: [String(value)]
      }), {})
    },
    realmRoles: ['perfana-user']
  }));

  fs.writeFileSync('users-export.json', JSON.stringify(keycloakUsers, null, 2));
  console.log(`Exported ${keycloakUsers.length} users`);
}

exportUsers();
```

2. **Import to Keycloak**
```typescript
// scripts/import-keycloak-users.ts
import KcAdminClient from '@keycloak/keycloak-admin-client';
import fs from 'fs';

const kcAdminClient = new KcAdminClient({
  baseUrl: process.env.KEYCLOAK_URL,
  realmName: 'perfana-prod'
});

async function importUsers() {
  await kcAdminClient.auth({
    grantType: 'client_credentials',
    clientId: 'perfana-api',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET
  });

  const users = JSON.parse(fs.readFileSync('users-export.json', 'utf-8'));

  for (const user of users) {
    try {
      const createdUser = await kcAdminClient.users.create(user);

      // Send password reset email
      await kcAdminClient.users.executeActionsEmail({
        id: createdUser.id,
        actions: ['UPDATE_PASSWORD'],
        redirectUri: 'https://app.perfana.io/dashboard'
      });

      console.log(`Imported user: ${user.email}`);
    } catch (error) {
      console.error(`Failed to import user ${user.email}:`, error);
    }
  }
}

importUsers();
```

**Deliverables**:
- User export scripts with validation
- Keycloak import with email verification
- Data integrity verification reports
- User communication templates

### Phase 6.5: Testing & Validation

**Duration**: 3-4 days

**Tasks**:
1. **Create Comprehensive Test Suite**
```typescript
// apps/api/src/test/keycloak-auth.test.ts
describe('Keycloak Authentication Integration', () => {
  describe('JWT Validation', () => {
    it('should validate Keycloak JWT tokens');
    it('should extract user claims correctly');
    it('should handle expired tokens');
    it('should validate token signature');
  });

  describe('Triple Authentication Guard', () => {
    it('should prioritize API key authentication');
    it('should fallback to Keycloak JWT');
    it('should use Supabase fallback in migration mode');
    it('should reject invalid tokens');
  });

  describe('Database Session Context', () => {
    it('should set PostgreSQL session variables');
    it('should handle RLS policies correctly');
    it('should clean up sessions on completion');
  });
});
```

2. **Performance Benchmarking**
```typescript
// Load test with k6
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 500 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01']
  }
};

export default function () {
  // Test Keycloak token endpoint
  const tokenRes = http.post(`${__ENV.KEYCLOAK_URL}/realms/perfana-prod/protocol/openid-connect/token`, {
    grant_type: 'client_credentials',
    client_id: 'perfana-api',
    client_secret: __ENV.CLIENT_SECRET
  });

  check(tokenRes, {
    'token request successful': (r) => r.status === 200
  });

  if (tokenRes.status === 200) {
    const token = JSON.parse(tokenRes.body).access_token;

    // Test API with Keycloak token
    const apiRes = http.get(`${__ENV.API_URL}/test-runs`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    check(apiRes, {
      'API call successful': (r) => r.status === 200
    });
  }
}
```

**Deliverables**:
- 50+ test scenarios passing
- Performance benchmarks meeting targets
- Security audit report
- Load testing results

### Phase 6.6: Production Rollout

**Duration**: 3-4 days

**Tasks**:
1. **Gradual Feature Flag Rollout**
```bash
# Environment configuration
USE_KEYCLOAK_AUTH=true
KEYCLOAK_ROLLOUT_PERCENTAGE=10  # Start with 10%
SUPABASE_FALLBACK_ENABLED=true  # Keep fallback active
```

2. **Monitoring Setup**
```yaml
# Prometheus metrics
- keycloak_auth_attempts_total
- keycloak_auth_failures_total
- keycloak_token_validation_duration
- keycloak_jwt_decode_errors_total
```

3. **Rollback Procedures**
```bash
# Emergency rollback
kubectl set env deployment/api USE_KEYCLOAK_AUTH=false
kubectl set env deployment/api SUPABASE_FALLBACK_ENABLED=true
```

**Deliverables**:
- Production deployment completed
- Monitoring dashboards active
- Rollback procedures tested
- User acceptance > 95%

---

## 🔧 Environment Configuration

### New Environment Variables
```bash
# Keycloak Configuration
KEYCLOAK_URL=https://auth.perfana.io
KEYCLOAK_REALM=perfana-prod
KEYCLOAK_CLIENT_ID=perfana-api
KEYCLOAK_CLIENT_SECRET=${SECRET}

# Frontend
NEXT_PUBLIC_KEYCLOAK_URL=https://auth.perfana.io
NEXT_PUBLIC_KEYCLOAK_REALM=perfana-prod
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=perfana-web

# Migration Flags
USE_KEYCLOAK_AUTH=false          # Gradually enable
KEYCLOAK_ROLLOUT_PERCENTAGE=0    # Percentage of users on Keycloak
SUPABASE_FALLBACK_ENABLED=true   # Keep during transition
MIGRATION_MODE=true              # Enable during migration
```

---

## 📈 Success Criteria

### Phase 6 Completion Requirements

**Functional Requirements**:
- ✅ All authentication flows working with Keycloak
- ✅ API key authentication preserved
- ✅ OAuth providers (Google, GitHub) functional
- ✅ Database session context operational
- ✅ User migration completed with 100% accuracy

**Performance Requirements**:
- ✅ JWT validation latency < 50ms p95
- ✅ Authentication success rate > 99.9%
- ✅ Token refresh working seamlessly
- ✅ Session management with proper timeouts

**Security Requirements**:
- ✅ HTTPS-only communication
- ✅ PKCE for frontend OAuth flows
- ✅ Token signature validation
- ✅ Session invalidation on logout
- ✅ Audit logging functional

---

## 🚨 Risk Mitigation

### Critical Risks & Strategies

| Risk | Mitigation |
|------|------------|
| User session disruption | Gradual rollout with feature flags |
| Authentication failures | Triple auth with Supabase fallback |
| Performance degradation | Load testing and JWT caching |
| User adoption resistance | Clear communication and training |
| OAuth provider issues | Multiple provider configuration |

### Rollback Plan

1. **Immediate**: Set `USE_KEYCLOAK_AUTH=false`
2. **Short-term**: Scale back rollout percentage
3. **Long-term**: Fix issues and re-attempt rollout

---

## 📅 Timeline Summary

| Sub-Phase | Duration | Deliverables |
|-----------|----------|-------------|
| 6.1 Infrastructure | 3-4 days | Keycloak deployment, realm config |
| 6.2 Backend Integration | 4-5 days | JWT service, enhanced auth guard |
| 6.3 Frontend Integration | 3-4 days | OIDC client, auth context |
| 6.4 User Migration | 2-3 days | User export/import, validation |
| 6.5 Testing | 3-4 days | Test suite, performance benchmarks |
| 6.6 Production Rollout | 3-4 days | Gradual deployment, monitoring |

**Total Phase 6 Duration**: 18-24 days (3.5-5 weeks)

---

## 🎯 Post-Phase 6 Actions

1. **Supabase Cleanup**: Remove Supabase Auth dependencies
2. **Performance Optimization**: Implement JWT caching strategies
3. **Enhanced Features**: MFA, adaptive authentication
4. **Documentation**: Update API documentation and user guides
5. **Team Training**: Keycloak administration and troubleshooting

---

**Phase 6 Status**: 🔵 Planning Complete - Ready for Implementation
**Integration Point**: Completes the full Supabase → PostgreSQL migration
**Next Steps**: Begin Phase 6.1 - Keycloak Infrastructure Setup