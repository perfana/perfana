# Keycloak Migration Plan: Replacing Supabase Auth in Perfana

## 🎯 Executive Summary

This document outlines the migration strategy from Supabase Auth to Keycloak for the Perfana performance analysis platform. This migration represents a strategic shift to enterprise-grade, self-hosted identity management that provides full control over authentication, advanced SSO capabilities, and removes vendor lock-in while maintaining JWT-based access control.

**Key Benefits:**
- **Full Control**: Complete ownership of authentication infrastructure
- **Enterprise SSO**: Native support for SAML, OAuth2, OIDC, Kerberos
- **Multi-Factor Authentication**: Built-in MFA with TOTP, WebAuthn support
- **Advanced Federation**: Connect to Active Directory, LDAP, and social providers
- **Compliance Ready**: Audit logging, session management, and security policies
- **Cost Optimization**: Eliminate per-user SaaS costs

---

## 📊 Current State Analysis

### Existing Supabase Auth Implementation

Based on analysis of the Perfana codebase:

#### **Backend Components**
- **CombinedAuthGuard** (`/apps/api/src/guards/combined-auth.guard.ts`):
  - Dual authentication: Supabase JWT + API Keys
  - Uses `supabase.auth.getUser()` for JWT validation
  - Stores auth type in request context

#### **Frontend Components**
- **Token Storage**: localStorage (`perfana_access_token`, `perfana_refresh_token`)
- **Auth Endpoints**:
  - `POST /auth/signin` - User login
  - `POST /auth/signup` - User registration
  - `POST /auth/refresh` - Token refresh
  - `POST /auth/reset-password` - Password reset

#### **Database Dependencies**
- **16 Supabase Auth Tables** identified for migration:
  - Core: users, sessions, refresh_tokens, identities, audit_log_entries
  - MFA: mfa_factors, mfa_challenges, mfa_amr_claims
  - OAuth/SSO: sso_providers, sso_domains, saml_providers, saml_relay_states
  - Token Management: one_time_tokens, flow_state
  - System: instances, schema_migrations

#### **Current Auth Features Used**
- JWT-based authentication
- API key authentication (already native)
- Social login providers (Google, GitHub)
- Email/password authentication
- Token refresh mechanism
- Password reset flows

---

## 🏗️ Target Architecture with Keycloak

### High-Level Architecture

```
┌─────────────────────┐
│  Browser/Mobile     │
│     Client          │
└──────────┬──────────┘
           │ OIDC Auth (PKCE)
           │ Bearer Token
           ▼
┌─────────────────────┐       ┌──────────────────┐
│     Keycloak        │◄──────│  LDAP/AD/Social  │
│   (Perfana Realm)   │       │    Providers     │
└──────────┬──────────┘       └──────────────────┘
           │ JWT (Access Token)
           ▼
┌─────────────────────┐
│   API Gateway       │
│  (NestJS Backend)   │
│  - JWT Validation   │
│  - Session Context  │
└──────────┬──────────┘
           │ SET LOCAL app.current_user_id
           ▼
┌─────────────────────┐
│    PostgreSQL       │
│   with RLS/RBAC     │
└─────────────────────┘
```

### Component Breakdown

#### **1. Keycloak Server**
- **Deployment**: Docker/Kubernetes (self-hosted)
- **Database**: Dedicated PostgreSQL instance
- **Realms**:
  - `perfana-dev` (development)
  - `perfana-staging` (staging)
  - `perfana-prod` (production)

#### **2. Keycloak Clients**
- **perfana-web** (public client):
  - Type: Public (SPA)
  - Flow: Authorization Code with PKCE
  - Redirect URIs: `http://localhost:4001/*`, `https://app.perfana.io/*`

- **perfana-api** (confidential client):
  - Type: Confidential
  - Purpose: Service-to-service auth, admin operations
  - Client credentials grant enabled

- **perfana-mobile** (public client):
  - Type: Public
  - Flow: Authorization Code with PKCE
  - Custom scheme redirects

#### **3. Roles & Groups Structure**
```yaml
Realm Roles:
  - perfana-admin      # Full system access
  - perfana-user       # Standard user access
  - perfana-viewer     # Read-only access

Client Roles (perfana-api):
  - api-admin          # API administration
  - api-write          # Write access to API
  - api-read           # Read access to API

Groups:
  - /organizations/acme
    - /teams/platform
    - /teams/performance
  - /organizations/techcorp
    - /teams/devops
```

---

## 📋 Migration Phases

### **Phase 0: Preparation & Analysis** (Week 1)

**Objectives:**
- Complete inventory of Supabase Auth usage
- Design Keycloak realm configuration
- Set up development environment

**Tasks:**
1. **Audit Current Implementation**
   - [x] Map all Supabase Auth API calls
   - [x] Document custom claims in JWTs
   - [ ] Inventory RLS policies using auth.uid()
   - [ ] List all OAuth providers configured

2. **Design Target Schema**
   - [ ] Define user attribute mappings
   - [ ] Design role hierarchy
   - [ ] Plan group structure for organizations/teams
   - [ ] Define custom user attributes (metadata)

3. **Infrastructure Planning**
   - [ ] Choose deployment strategy (Docker/K8s)
   - [ ] Size Keycloak instances (CPU/Memory)
   - [ ] Plan backup/restore procedures
   - [ ] Define monitoring requirements

**Deliverables:**
- Current state documentation
- Target architecture diagram
- Infrastructure requirements document
- Risk assessment matrix

---

### **Phase 1: Infrastructure Setup** (Week 2)

**Objectives:**
- Deploy Keycloak infrastructure
- Configure base realm settings
- Establish CI/CD pipeline

**Tasks:**

1. **Keycloak Deployment**
   ```yaml
   # docker-compose.yml
   version: '3.8'
   services:
     postgres-keycloak:
       image: postgres:15-alpine
       environment:
         POSTGRES_DB: keycloak
         POSTGRES_USER: keycloak
         POSTGRES_PASSWORD: ${KC_DB_PASSWORD}
       volumes:
         - keycloak_data:/var/lib/postgresql/data

     keycloak:
       image: quay.io/keycloak/keycloak:22.0
       environment:
         KC_DB: postgres
         KC_DB_URL: jdbc:postgresql://postgres-keycloak:5432/keycloak
         KC_DB_USERNAME: keycloak
         KC_DB_PASSWORD: ${KC_DB_PASSWORD}
         KC_HOSTNAME: auth.perfana.io
         KC_HOSTNAME_STRICT: false
         KC_HTTPS_CERTIFICATE_FILE: /opt/keycloak/certs/tls.crt
         KC_HTTPS_CERTIFICATE_KEY_FILE: /opt/keycloak/certs/tls.key
         KEYCLOAK_ADMIN: admin
         KEYCLOAK_ADMIN_PASSWORD: ${KC_ADMIN_PASSWORD}
       command: start
       ports:
         - "8443:8443"
       depends_on:
         - postgres-keycloak
   ```

2. **Realm Configuration**
   ```json
   {
     "realm": "perfana-prod",
     "enabled": true,
     "sslRequired": "external",
     "registrationAllowed": true,
     "registrationEmailAsUsername": true,
     "rememberMe": true,
     "verifyEmail": true,
     "loginTheme": "perfana",
     "emailTheme": "perfana",
     "internationalizationEnabled": true,
     "supportedLocales": ["en"],
     "defaultLocale": "en",
     "authenticationFlows": [],
     "requiredActions": [
       "VERIFY_EMAIL",
       "UPDATE_PASSWORD",
       "CONFIGURE_TOTP"
     ]
   }
   ```

3. **Security Hardening**
   - [ ] Configure SSL/TLS certificates
   - [ ] Set up firewall rules
   - [ ] Enable audit logging
   - [ ] Configure session timeouts
   - [ ] Set up brute force protection

**Deliverables:**
- Operational Keycloak instance
- Realm export configuration (version controlled)
- Backup/restore scripts
- Monitoring dashboards

---

### **Phase 2: Integration Layer Development** (Week 3-4)

**Objectives:**
- Replace Supabase Auth SDK with Keycloak integration
- Implement JWT validation middleware
- Create auth service abstraction layer

**Tasks:**

1. **Backend Auth Service** (`/apps/api/src/modules/auth/keycloak-auth.service.ts`)
   ```typescript
   import { Injectable } from '@nestjs/common';
   import { createRemoteJWKSet, jwtVerify } from 'jose';
   import { ConfigService } from '@nestjs/config';

   @Injectable()
   export class KeycloakAuthService {
     private keycloakIssuer: string;
     private jwks: ReturnType<typeof createRemoteJWKSet>;

     constructor(private configService: ConfigService) {
       this.keycloakIssuer = `${this.configService.get('KEYCLOAK_URL')}/realms/${this.configService.get('KEYCLOAK_REALM')}`;
       const jwksUrl = `${this.keycloakIssuer}/protocol/openid-connect/certs`;
       this.jwks = createRemoteJWKSet(new URL(jwksUrl));
     }

     async validateToken(token: string) {
       try {
         const { payload } = await jwtVerify(token, this.jwks, {
           issuer: this.keycloakIssuer,
           audience: 'perfana-api'
         });

         return {
           sub: payload.sub,
           email: payload.email,
           roles: payload.realm_access?.roles || [],
           organizations: payload.organizations || [],
           teams: payload.teams || []
         };
       } catch (error) {
         throw new UnauthorizedException('Invalid token');
       }
     }

     async refreshToken(refreshToken: string) {
       const response = await fetch(
         `${this.keycloakIssuer}/protocol/openid-connect/token`,
         {
           method: 'POST',
           headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
           body: new URLSearchParams({
             grant_type: 'refresh_token',
             refresh_token: refreshToken,
             client_id: 'perfana-web'
           })
         }
       );

       if (!response.ok) {
         throw new UnauthorizedException('Token refresh failed');
       }

       return response.json();
     }
   }
   ```

2. **Updated Auth Guard** (`/apps/api/src/guards/keycloak-auth.guard.ts`)
   ```typescript
   import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
   import { Reflector } from '@nestjs/core';
   import { KeycloakAuthService } from '../modules/auth/keycloak-auth.service';
   import { ApiKeysService } from '../modules/api-keys/api-keys.service';
   import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

   @Injectable()
   export class KeycloakAuthGuard implements CanActivate {
     constructor(
       private reflector: Reflector,
       private keycloakAuthService: KeycloakAuthService,
       private apiKeysService: ApiKeysService
     ) {}

     async canActivate(context: ExecutionContext): Promise<boolean> {
       const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
         context.getHandler(),
         context.getClass()
       ]);

       if (isPublic) return true;

       const request = context.switchToHttp().getRequest();
       const authHeader = request.headers.authorization;

       if (!authHeader?.startsWith('Bearer ')) {
         throw new UnauthorizedException('Missing Authorization header');
       }

       const token = authHeader.substring(7);

       // Try API Key first (for backward compatibility)
       try {
         const isValidApiKey = await this.apiKeysService.validateApiKey(token);
         if (isValidApiKey) {
           request.authType = 'api-key';
           return true;
         }
       } catch {}

       // Validate Keycloak JWT
       try {
         const user = await this.keycloakAuthService.validateToken(token);
         request.user = user;
         request.authType = 'keycloak-jwt';
         return true;
       } catch (error) {
         throw new UnauthorizedException('Invalid or expired token');
       }
     }
   }
   ```

3. **Database Session Context Middleware**
   ```typescript
   import { Injectable, NestMiddleware } from '@nestjs/common';
   import { InjectDataSource } from '@nestjs/typeorm';
   import { DataSource } from 'typeorm';

   @Injectable()
   export class DatabaseSessionMiddleware implements NestMiddleware {
     constructor(@InjectDataSource() private dataSource: DataSource) {}

     async use(req: any, res: any, next: () => void) {
       if (req.user && req.authType === 'keycloak-jwt') {
         const queryRunner = this.dataSource.createQueryRunner();
         await queryRunner.connect();
         await queryRunner.startTransaction();

         try {
           // Set session variables for RLS
           await queryRunner.query('SET LOCAL app.current_user_id = $1', [req.user.sub]);
           await queryRunner.query('SET LOCAL app.current_user_email = $1', [req.user.email]);
           await queryRunner.query('SET LOCAL app.current_user_roles = $1', [
             JSON.stringify(req.user.roles)
           ]);

           // Attach queryRunner to request for use in controllers
           req.queryRunner = queryRunner;

           // Continue processing
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

**Deliverables:**
- Keycloak auth service implementation
- Updated auth guards and middleware
- Database session context integration
- Unit and integration tests

---

### **Phase 3: Frontend Integration** (Week 4-5)

**Objectives:**
- Replace Supabase client with Keycloak integration
- Implement OIDC flow in frontend
- Update token management logic

**Tasks:**

1. **Keycloak Client Library** (`/apps/web/lib/keycloak-client.ts`)
   ```typescript
   import Keycloak from 'keycloak-js';

   class KeycloakService {
     private keycloak: Keycloak;
     private static instance: KeycloakService;

     private constructor() {
       this.keycloak = new Keycloak({
         url: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
         realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM,
         clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
       });
     }

     static getInstance(): KeycloakService {
       if (!KeycloakService.instance) {
         KeycloakService.instance = new KeycloakService();
       }
       return KeycloakService.instance;
     }

     async init(): Promise<boolean> {
       try {
         const authenticated = await this.keycloak.init({
           onLoad: 'check-sso',
           silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
           pkceMethod: 'S256'
         });

         if (authenticated) {
           // Store tokens
           localStorage.setItem('perfana_access_token', this.keycloak.token!);
           localStorage.setItem('perfana_refresh_token', this.keycloak.refreshToken!);

           // Setup auto-refresh
           setInterval(() => {
             this.keycloak.updateToken(30).catch(() => {
               console.error('Failed to refresh token');
               this.logout();
             });
           }, 60000);
         }

         return authenticated;
       } catch (error) {
         console.error('Keycloak initialization failed', error);
         return false;
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

   export default KeycloakService.getInstance();
   ```

2. **React Context Provider** (`/apps/web/contexts/KeycloakContext.tsx`)
   ```tsx
   import React, { createContext, useContext, useEffect, useState } from 'react';
   import keycloakService from '../lib/keycloak-client';

   interface KeycloakContextType {
     authenticated: boolean;
     user: any;
     login: () => void;
     logout: () => void;
     hasRole: (role: string) => boolean;
   }

   const KeycloakContext = createContext<KeycloakContextType | null>(null);

   export const KeycloakProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
     const [authenticated, setAuthenticated] = useState(false);
     const [user, setUser] = useState(null);

     useEffect(() => {
       keycloakService.init().then(auth => {
         setAuthenticated(auth);
         if (auth) {
           setUser(keycloakService.getUserInfo());
         }
       });
     }, []);

     const value = {
       authenticated,
       user,
       login: () => keycloakService.login(),
       logout: () => keycloakService.logout(),
       hasRole: (role: string) => keycloakService.hasRole(role)
     };

     return (
       <KeycloakContext.Provider value={value}>
         {children}
       </KeycloakContext.Provider>
     );
   };

   export const useKeycloak = () => {
     const context = useContext(KeycloakContext);
     if (!context) {
       throw new Error('useKeycloak must be used within KeycloakProvider');
     }
     return context;
   };
   ```

**Deliverables:**
- Keycloak JavaScript adapter integration
- React context for auth state management
- Updated API client with token injection
- Protected route components

---

### **Phase 4: Data Migration** (Week 5-6)

**Objectives:**
- Migrate existing users from Supabase to Keycloak
- Preserve user sessions where possible
- Maintain user metadata and roles

**Tasks:**

1. **User Export Script** (`/scripts/export-supabase-users.ts`)
   ```typescript
   import { createClient } from '@supabase/supabase-js';
   import fs from 'fs';

   const supabase = createClient(
     process.env.SUPABASE_URL!,
     process.env.SUPABASE_SERVICE_KEY!
   );

   async function exportUsers() {
     const { data: users, error } = await supabase.auth.admin.listUsers();

     if (error) {
       console.error('Failed to fetch users:', error);
       return;
     }

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
       credentials: [],
       realmRoles: ['perfana-user'],
       clientRoles: {}
     }));

     fs.writeFileSync('users-export.json', JSON.stringify(keycloakUsers, null, 2));
     console.log(`Exported ${keycloakUsers.length} users`);
   }

   exportUsers();
   ```

2. **Keycloak Import Script** (`/scripts/import-keycloak-users.ts`)
   ```typescript
   import KcAdminClient from '@keycloak/keycloak-admin-client';
   import fs from 'fs';

   const kcAdminClient = new KcAdminClient({
     baseUrl: process.env.KEYCLOAK_URL,
     realmName: process.env.KEYCLOAK_REALM
   });

   async function importUsers() {
     // Authenticate admin client
     await kcAdminClient.auth({
       grantType: 'client_credentials',
       clientId: 'admin-cli',
       clientSecret: process.env.KEYCLOAK_ADMIN_SECRET
     });

     const users = JSON.parse(fs.readFileSync('users-export.json', 'utf-8'));

     for (const user of users) {
       try {
         // Create user
         const createdUser = await kcAdminClient.users.create(user);

         // Send password reset email
         await kcAdminClient.users.executeActionsEmail({
           id: createdUser.id,
           actions: ['UPDATE_PASSWORD'],
           redirectUri: 'https://app.perfana.io'
         });

         console.log(`Imported user: ${user.email}`);
       } catch (error) {
         console.error(`Failed to import user ${user.email}:`, error);
       }
     }
   }

   importUsers();
   ```

3. **Session Migration Strategy**
   - Issue grace period (30 days) for existing tokens
   - Dual validation during transition period
   - Automatic migration on next login
   - Email notification to users about auth system change

**Deliverables:**
- User export/import scripts
- Data validation reports
- Session migration plan
- User communication templates

---

### **Phase 5: Testing & Validation** (Week 6-7)

**Objectives:**
- Comprehensive testing of auth flows
- Performance benchmarking
- Security audit

**Test Scenarios:**

1. **Functional Tests**
   - [ ] User registration with email verification
   - [ ] Login with email/password
   - [ ] OAuth login (Google, GitHub)
   - [ ] MFA enrollment and verification
   - [ ] Password reset flow
   - [ ] Token refresh mechanism
   - [ ] Session timeout handling
   - [ ] Role-based access control
   - [ ] API key authentication (backward compatibility)

2. **Performance Tests**
   ```typescript
   // Load test script using k6
   import http from 'k6/http';
   import { check } from 'k6';

   export const options = {
     stages: [
       { duration: '2m', target: 100 },
       { duration: '5m', target: 500 },
       { duration: '2m', target: 1000 },
       { duration: '5m', target: 1000 },
       { duration: '2m', target: 0 }
     ],
     thresholds: {
       http_req_duration: ['p(95)<500'],
       http_req_failed: ['rate<0.01']
     }
   };

   export default function () {
     // Test login endpoint
     const loginRes = http.post(
       `${__ENV.KEYCLOAK_URL}/realms/perfana/protocol/openid-connect/token`,
       {
         grant_type: 'password',
         client_id: 'perfana-web',
         username: 'test@example.com',
         password: 'password123'
       }
     );

     check(loginRes, {
       'login successful': (r) => r.status === 200,
       'token received': (r) => JSON.parse(r.body).access_token !== undefined
     });

     if (loginRes.status === 200) {
       const token = JSON.parse(loginRes.body).access_token;

       // Test authenticated API call
       const apiRes = http.get(`${__ENV.API_URL}/test-runs`, {
         headers: { Authorization: `Bearer ${token}` }
       });

       check(apiRes, {
         'API call successful': (r) => r.status === 200
       });
     }
   }
   ```

3. **Security Audit Checklist**
   - [ ] SSL/TLS configuration verified
   - [ ] CORS policies reviewed
   - [ ] Token expiration times appropriate
   - [ ] Rate limiting implemented
   - [ ] Brute force protection enabled
   - [ ] Audit logging functioning
   - [ ] Session fixation prevention
   - [ ] CSRF protection enabled

**Deliverables:**
- Test execution reports
- Performance benchmark results
- Security audit report
- Bug tracking list

---

### **Phase 6: Production Rollout** (Week 7-8)

**Objectives:**
- Deploy to production environment
- Monitor system stability
- Complete migration

**Rollout Strategy:**

1. **Blue-Green Deployment**
   ```yaml
   # Feature flag configuration
   features:
     auth_provider:
       blue: supabase  # Current
       green: keycloak # New
       traffic_split:
         - { percentage: 100, target: blue }  # Week 1
         - { percentage: 90, target: blue }   # Week 2 - 10% pilot
         - { percentage: 50, target: blue }   # Week 3 - 50/50
         - { percentage: 10, target: blue }   # Week 4 - 90% Keycloak
         - { percentage: 0, target: blue }    # Week 5 - Full migration
   ```

2. **Monitoring Setup**
   ```yaml
   # Prometheus metrics
   metrics:
     - keycloak_login_attempts_total
     - keycloak_login_failures_total
     - keycloak_token_validations_total
     - keycloak_token_refresh_total
     - keycloak_response_time_seconds

   # Alerts
   alerts:
     - name: HighAuthFailureRate
       expr: rate(keycloak_login_failures_total[5m]) > 0.1
       severity: warning

     - name: KeycloakDown
       expr: up{job="keycloak"} == 0
       severity: critical
   ```

3. **Rollback Plan**
   - Maintain Supabase auth as fallback for 30 days
   - Database backup before each migration phase
   - Automated rollback scripts ready
   - Clear rollback criteria defined

**Deliverables:**
- Production deployment plan
- Monitoring dashboards
- Runbook documentation
- Post-migration report

---

## 🔧 Technical Implementation Details

### PostgreSQL RLS Integration

```sql
-- Enable RLS on tables
ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;

-- Create policy using Keycloak user context
CREATE POLICY "Users can view their organization's test runs"
  ON test_runs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT jsonb_array_elements_text(
        current_setting('app.current_user_organizations')::jsonb
      )::uuid
    )
  );

-- Function to set user context
CREATE OR REPLACE FUNCTION set_user_context(
  p_user_id TEXT,
  p_email TEXT,
  p_roles JSONB,
  p_organizations JSONB,
  p_teams JSONB
) RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, true);
  PERFORM set_config('app.current_user_email', p_email, true);
  PERFORM set_config('app.current_user_roles', p_roles::TEXT, true);
  PERFORM set_config('app.current_user_organizations', p_organizations::TEXT, true);
  PERFORM set_config('app.current_user_teams', p_teams::TEXT, true);
END;
$$ LANGUAGE plpgsql;
```

### Keycloak Custom Attributes Mapper

```json
{
  "name": "organization-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "organizations",
    "claim.name": "organizations",
    "jsonType.label": "JSON",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
```

### Environment Variables

```bash
# Keycloak Configuration
KEYCLOAK_URL=https://auth.perfana.io
KEYCLOAK_REALM=perfana-prod
KEYCLOAK_CLIENT_ID=perfana-web
KEYCLOAK_CLIENT_SECRET=<client-secret>
KEYCLOAK_ADMIN_CLIENT_ID=perfana-api
KEYCLOAK_ADMIN_CLIENT_SECRET=<admin-secret>

# Feature Flags
USE_KEYCLOAK_AUTH=false  # Gradually enable
SUPABASE_AUTH_FALLBACK=true  # During migration

# Session Configuration
SESSION_TIMEOUT=1800  # 30 minutes
REFRESH_TOKEN_EXPIRY=604800  # 7 days
```

---

## 📊 Migration Metrics & Success Criteria

### Key Performance Indicators

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Authentication Success Rate | > 99.9% | Prometheus metrics |
| Token Validation Latency | < 50ms p95 | APM monitoring |
| User Migration Success | 100% | Migration scripts |
| Session Continuity | > 95% | User surveys |
| MFA Adoption Rate | > 30% in 90 days | Keycloak admin console |
| Support Ticket Volume | < 2% of users | Help desk system |

### Go/No-Go Criteria for Each Phase

**Phase 2 (Integration Layer)**
- [ ] All auth endpoints functional
- [ ] JWT validation working
- [ ] Database session context operational
- [ ] 100% backward compatibility with API keys

**Phase 3 (Frontend)**
- [ ] Login/logout flows working
- [ ] Token refresh automatic
- [ ] Protected routes enforced
- [ ] User experience unchanged or improved

**Phase 4 (Data Migration)**
- [ ] 100% users migrated successfully
- [ ] User attributes preserved
- [ ] Roles correctly assigned
- [ ] No data loss confirmed

**Phase 5 (Testing)**
- [ ] All test scenarios passed
- [ ] Performance benchmarks met
- [ ] Security audit passed
- [ ] < 5 critical bugs

**Phase 6 (Production)**
- [ ] Monitoring showing stable metrics
- [ ] Rollback tested successfully
- [ ] User acceptance > 95%
- [ ] No critical incidents in 72 hours

---

## 🚨 Risk Mitigation

### Identified Risks & Mitigation Strategies

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| User session disruption | Medium | High | Dual auth support, grace period |
| Performance degradation | Low | High | Load testing, caching, CDN |
| OAuth provider issues | Low | Medium | Multiple providers, fallback |
| Data migration errors | Medium | High | Validation scripts, rollback plan |
| Security vulnerabilities | Low | Critical | Security audit, pen testing |
| User adoption resistance | Medium | Medium | Clear communication, training |

### Contingency Plans

1. **Authentication Failure Spike**
   - Immediate: Increase Supabase fallback percentage
   - Short-term: Scale Keycloak instances
   - Long-term: Optimize token validation

2. **Data Loss During Migration**
   - Immediate: Stop migration, restore from backup
   - Short-term: Fix migration scripts
   - Long-term: Implement incremental migration

3. **Performance Issues**
   - Immediate: Enable caching layer
   - Short-term: Optimize database queries
   - Long-term: Implement token introspection caching

---

## 📚 Documentation & Training

### Documentation Deliverables

1. **Technical Documentation**
   - API authentication guide
   - Keycloak administration manual
   - Troubleshooting runbook
   - Security best practices

2. **User Documentation**
   - Login guide with screenshots
   - MFA setup instructions
   - Password reset process
   - FAQ section

3. **Developer Documentation**
   - Integration examples
   - Token validation guide
   - Role-based access patterns
   - Testing strategies

### Training Plan

1. **Development Team**
   - 2-hour workshop on Keycloak concepts
   - Hands-on coding session
   - Security best practices review

2. **Operations Team**
   - Keycloak administration training
   - Monitoring and alerting setup
   - Backup and restore procedures

3. **Support Team**
   - Common issues and solutions
   - User assistance scripts
   - Escalation procedures

---

## 🎯 Post-Migration Optimization

### Phase 7: Enhancement & Optimization (Month 2-3)

After successful migration, implement advanced features:

1. **Advanced Security Features**
   - WebAuthn/FIDO2 support
   - Adaptive authentication (risk-based)
   - Device fingerprinting
   - Anomaly detection

2. **Enterprise Integration**
   - Active Directory federation
   - LDAP integration
   - SAML 2.0 for enterprise SSO
   - SCIM for user provisioning

3. **Performance Optimization**
   - Redis cache for tokens
   - CDN for static assets
   - Database connection pooling
   - Horizontal scaling strategy

4. **Compliance & Governance**
   - GDPR compliance tools
   - Consent management
   - Data retention policies
   - Audit log analysis

---

## 📅 Timeline Summary

| Phase | Duration | Start Date | End Date | Status |
|-------|----------|------------|----------|--------|
| Phase 0: Preparation | 1 week | Week 1 | Week 1 | 🔵 Planned |
| Phase 1: Infrastructure | 1 week | Week 2 | Week 2 | 🔵 Planned |
| Phase 2: Integration | 2 weeks | Week 3 | Week 4 | 🔵 Planned |
| Phase 3: Frontend | 2 weeks | Week 4 | Week 5 | 🔵 Planned |
| Phase 4: Migration | 2 weeks | Week 5 | Week 6 | 🔵 Planned |
| Phase 5: Testing | 2 weeks | Week 6 | Week 7 | 🔵 Planned |
| Phase 6: Rollout | 2 weeks | Week 7 | Week 8 | 🔵 Planned |
| Phase 7: Optimization | 8 weeks | Month 2 | Month 3 | 🔵 Planned |

**Total Duration**: 8 weeks for core migration + 8 weeks for optimization

---

## ✅ Conclusion

This migration from Supabase Auth to Keycloak represents a strategic investment in Perfana's authentication infrastructure. The benefits include:

1. **Complete Control**: Full ownership of authentication and user management
2. **Enterprise Ready**: Native support for enterprise SSO and compliance requirements
3. **Cost Efficiency**: Elimination of per-user SaaS costs at scale
4. **Advanced Features**: MFA, adaptive authentication, and sophisticated access policies
5. **Vendor Independence**: No lock-in, open-source foundation

The phased approach minimizes risk while ensuring business continuity. With proper planning, testing, and execution, this migration will provide Perfana with a robust, scalable, and enterprise-grade authentication platform.

---

**Document Version**: 1.0
**Last Updated**: October 2025
**Next Review**: Start of Phase 0
**Status**: 🔵 Planning Phase