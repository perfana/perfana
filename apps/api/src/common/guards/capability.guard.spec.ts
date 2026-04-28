import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CapabilityGuard } from './capability.guard';
import { AuthorizationService } from '../services/authorization.service';
import {
  KeycloakEnhancedAuthGuard,
  AuthenticatedRequest,
} from '../../guards/keycloak-enhanced-auth.guard';
import {
  REQUIRES_CAPABILITY_META,
  RequiresCapabilityMeta,
} from '../decorators/requires-capability.decorator';
import { Capability } from '../../constants/capabilities.constants';

jest.mock('../../guards/keycloak-enhanced-auth.guard', () => ({
  KeycloakEnhancedAuthGuard: {
    getUserId: jest.fn(),
    getRoles: jest.fn(),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    method: 'PATCH',
    url: '/test/endpoint',
    params: {},
    body: {},
    query: {},
    headers: {},
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function makeContext(
  request: AuthenticatedRequest,
  meta: RequiresCapabilityMeta | undefined,
): ExecutionContext {
  const handler = {};
  const cls = {};

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => handler,
    getClass: () => cls,
    // Attach meta as a property so the Reflector mock can read it
    __meta: meta,
  } as unknown as ExecutionContext;
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('CapabilityGuard', () => {
  let guard: CapabilityGuard;
  let reflector: jest.Mocked<Reflector>;
  let authzService: jest.Mocked<Pick<AuthorizationService, 'getCapabilities'>>;

  const userId = 'user-abc-123';
  const roles = ['org-member'];

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    authzService = {
      getCapabilities: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuthorizationService, 'getCapabilities'>>;

    guard = new CapabilityGuard(
      reflector,
      authzService as unknown as AuthorizationService,
    );

    // Silence logger output in tests
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    // Default mock values — individual tests override as needed
    (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(userId);
    (KeycloakEnhancedAuthGuard.getRoles as jest.Mock).mockReturnValue(roles);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 1. No metadata → allow (open route)
  it('allows a request when the handler has no @RequiresCapability metadata', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext(makeRequest(), undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authzService.getCapabilities).not.toHaveBeenCalled();
  });

  // 2. Capability present → grant
  it('allows a request when the capability is present for the resolved org', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.IntegrationDynatraceUpdate,
      source: { orgIdFromBody: 'organizationId' },
    };
    reflector.getAllAndOverride.mockReturnValue(meta);

    const request = makeRequest({ body: { organizationId: 'org-1' } as any });
    const ctx = makeContext(request, meta);

    (authzService.getCapabilities as jest.Mock).mockResolvedValue([
      Capability.IntegrationDynatraceUpdate,
      Capability.TestRunRead,
    ]);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // 3. Capability missing → deny + log + 403
  it('denies with ForbiddenException and logs WARN when capability is missing', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.IntegrationDynatraceDelete,
      source: { orgIdFromBody: 'organizationId' },
    };
    reflector.getAllAndOverride.mockReturnValue(meta);

    const request = makeRequest({ body: { organizationId: 'org-1' } as any });
    const ctx = makeContext(request, meta);

    (authzService.getCapabilities as jest.Mock).mockResolvedValue([Capability.TestRunRead]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      `Missing capability: ${Capability.IntegrationDynatraceDelete}`,
    );

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining(`capability=${Capability.IntegrationDynatraceDelete}`),
    );
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining(`userId=${userId}`),
    );
  });

  // 4. orgIdParam resolution
  it('resolves orgId from req.params when orgIdParam is configured', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.IntegrationGrafanaUpdate,
      source: { orgIdParam: 'orgId' },
    };
    reflector.getAllAndOverride.mockReturnValue(meta);

    const request = makeRequest({ params: { orgId: 'org-from-param' } as any });
    const ctx = makeContext(request, meta);

    (authzService.getCapabilities as jest.Mock).mockResolvedValue([
      Capability.IntegrationGrafanaUpdate,
    ]);

    await guard.canActivate(ctx);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(
      userId,
      roles,
      'org-from-param',
    );
  });

  // 5. orgIdFromBody resolution
  it('resolves orgId from req.body when orgIdFromBody is configured', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.IntegrationDynatraceCreate,
      source: { orgIdFromBody: 'organizationId' },
    };
    reflector.getAllAndOverride.mockReturnValue(meta);

    const request = makeRequest({ body: { organizationId: 'org-from-body' } as any });
    const ctx = makeContext(request, meta);

    (authzService.getCapabilities as jest.Mock).mockResolvedValue([
      Capability.IntegrationDynatraceCreate,
    ]);

    await guard.canActivate(ctx);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(
      userId,
      roles,
      'org-from-body',
    );
  });

  // 6. orgIdFromQuery resolution
  it('resolves orgId from req.query when orgIdFromQuery is configured', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.TestRunDelete,
      source: { orgIdFromQuery: 'orgId' },
    };
    reflector.getAllAndOverride.mockReturnValue(meta);

    const request = makeRequest({ query: { orgId: 'org-from-query' } as any });
    const ctx = makeContext(request, meta);

    (authzService.getCapabilities as jest.Mock).mockResolvedValue([Capability.TestRunDelete]);

    await guard.canActivate(ctx);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(
      userId,
      roles,
      'org-from-query',
    );
  });

  // 7. No orgId source configured → call getCapabilities with null
  it('passes null as orgId when no orgId source is configured (system-level check)', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.SystemManageUsers,
      source: {},
    };
    reflector.getAllAndOverride.mockReturnValue(meta);

    const request = makeRequest();
    const ctx = makeContext(request, meta);

    (authzService.getCapabilities as jest.Mock).mockResolvedValue([
      Capability.SystemManageUsers,
    ]);

    await guard.canActivate(ctx);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(userId, roles, null);
  });

  // 8. No userId (unauthenticated request) → 403, not 500
  it('denies with ForbiddenException (not 500) when userId cannot be extracted', async () => {
    const meta: RequiresCapabilityMeta = {
      capability: Capability.IntegrationDynatraceUpdate,
      source: {},
    };
    reflector.getAllAndOverride.mockReturnValue(meta);
    (KeycloakEnhancedAuthGuard.getUserId as jest.Mock).mockReturnValue(null);

    const request = makeRequest();
    const ctx = makeContext(request, meta);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(authzService.getCapabilities).not.toHaveBeenCalled();

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('no authenticated user'),
    );
  });
});
