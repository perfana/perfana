/**
 * CapabilityGuard integration test (e2e)
 *
 * Boots a minimal NestJS app with a test controller decorated with
 * @RequiresCapability, wires CapabilityGuard as a global APP_GUARD, and fires
 * real HTTP requests via supertest.
 *
 * AuthorizationService.getCapabilities is the only stub — the decorator,
 * guard, Reflector, org-extraction, logger, and ForbiddenException pipeline
 * are all real.
 *
 * Auth context is injected by a lightweight fakeAuthMiddleware that sets
 * request.authType and request.user to match exactly what
 * KeycloakEnhancedAuthGuard.getUserId / getRoles read (authType='keycloak-jwt',
 * user.sub, user.roles).
 */
import {
  INestApplication,
  Controller,
  Get,
  Post,
  Body,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { CapabilityGuard } from './capability.guard';
import { RequiresCapability } from '../decorators/requires-capability.decorator';
import { Capability } from '../../constants/capabilities.constants';
import { AuthorizationService } from '../services/authorization.service';

// ─── Minimal test controller ──────────────────────────────────────────────────

@Controller('test')
class TestCapController {
  /** No @RequiresCapability — the guard's no-metadata fast-path should allow */
  @Get('open')
  open() {
    return { ok: true };
  }

  /** Gated: requires integration:dynatrace:update, no org resolution */
  @Get('cap-required-update')
  @RequiresCapability(Capability.IntegrationDynatraceUpdate)
  capUpdate() {
    return { ok: true };
  }

  /** Gated: requires integration:dynatrace:create, resolves org from body */
  @Post('cap-required-create')
  @RequiresCapability(Capability.IntegrationDynatraceCreate, {
    orgIdFromBody: 'organizationId',
  })
  capCreate(@Body() body: { organizationId?: string }) {
    return { ok: true, orgId: body.organizationId ?? null };
  }

  /** Gated: requires integration:dynatrace:delete, resolves org from query */
  @Get('cap-required-query-org')
  @RequiresCapability(Capability.IntegrationDynatraceDelete, {
    orgIdFromQuery: 'orgId',
  })
  capQueryOrg() {
    return { ok: true };
  }
}

// ─── Fake auth middleware ─────────────────────────────────────────────────────
//
// Sets request.authType = 'keycloak-jwt' and request.user = { sub, roles }
// from a simple "user:<userId>[,<role>...]" Authorization header.
// Matches exactly what KeycloakEnhancedAuthGuard.getUserId / getRoles read.
//
function fakeAuthMiddleware(req: any, _res: any, next: any) {
  const auth: string | undefined = req.headers?.authorization;
  if (auth?.startsWith('user:')) {
    const parts = auth.slice(5).split(',');
    const userId = parts[0];
    const roles = parts.slice(1);
    req.authType = 'keycloak-jwt';
    req.user = { sub: userId, roles };
  }
  next();
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('CapabilityGuard (e2e / integration)', () => {
  let app: INestApplication;
  let authzService: { getCapabilities: jest.Mock };
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    authzService = { getCapabilities: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TestCapController],
      providers: [
        { provide: AuthorizationService, useValue: authzService },
        { provide: APP_GUARD, useClass: CapabilityGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(fakeAuthMiddleware);
    await app.init();

    // Spy AFTER app.init() so the guard's own logger instance already exists
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterAll(async () => {
    warnSpy?.mockRestore();
    await app.close();
  });

  beforeEach(() => {
    warnSpy.mockClear();
    authzService.getCapabilities.mockReset();
  });

  // ── Test 1: open route (no decorator) ─────────────────────────────────────

  it('returns 200 on an open route (no @RequiresCapability — guard fast-path)', async () => {
    await request(app.getHttpServer()).get('/test/open').expect(200);
    expect(authzService.getCapabilities).not.toHaveBeenCalled();
  });

  // ── Test 2: grant ──────────────────────────────────────────────────────────

  it('returns 200 when the authenticated user has the required capability', async () => {
    authzService.getCapabilities.mockResolvedValue([
      Capability.IntegrationDynatraceUpdate,
    ]);

    await request(app.getHttpServer())
      .get('/test/cap-required-update')
      .set('Authorization', 'user:user-1,perfana-user')
      .expect(200);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(
      'user-1',
      ['perfana-user'],
      null, // no org source configured on this route
    );
  });

  // ── Test 3: deny ───────────────────────────────────────────────────────────

  it('returns 403 with missing-capability message when user lacks the capability', async () => {
    authzService.getCapabilities.mockResolvedValue([]); // no caps

    const res = await request(app.getHttpServer())
      .get('/test/cap-required-update')
      .set('Authorization', 'user:user-2,perfana-user')
      .expect(403);

    expect(res.body.message).toContain(
      `Missing capability: ${Capability.IntegrationDynatraceUpdate}`,
    );
  });

  // ── Test 4: WARN log on deny ───────────────────────────────────────────────

  it('emits a structured WARN log on deny with capability, userId, orgId, route', async () => {
    authzService.getCapabilities.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/test/cap-required-update')
      .set('Authorization', 'user:user-3,perfana-user')
      .expect(403);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /Capability denied: capability=integration:dynatrace:update userId=user-3 orgId=null route=GET \/test\/cap-required-update/,
      ),
    );
  });

  // ── Test 5: no-auth → 403, not 500 ────────────────────────────────────────

  it('returns 403 (not 500) when there is no authenticated user', async () => {
    // getCapabilities must NOT be called — guard bails out before calling authz
    authzService.getCapabilities.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .get('/test/cap-required-update')
      // no Authorization header → fakeAuthMiddleware sets nothing → userId = null
      .expect(403);

    expect(res.body.message).toContain(
      `Missing capability: ${Capability.IntegrationDynatraceUpdate}`,
    );
    expect(authzService.getCapabilities).not.toHaveBeenCalled();
  });

  // ── Test 6: org resolution from body ──────────────────────────────────────

  it('resolves orgId from request body via orgIdFromBody and passes it to getCapabilities', async () => {
    authzService.getCapabilities.mockResolvedValue([
      Capability.IntegrationDynatraceCreate,
    ]);

    await request(app.getHttpServer())
      .post('/test/cap-required-create')
      .set('Authorization', 'user:user-4,perfana-user')
      .send({ organizationId: 'org-a' })
      .expect(201);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(
      'user-4',
      ['perfana-user'],
      'org-a',
    );
  });

  // ── Test 7: org resolution from query ─────────────────────────────────────

  it('resolves orgId from query string via orgIdFromQuery and passes it to getCapabilities', async () => {
    authzService.getCapabilities.mockResolvedValue([
      Capability.IntegrationDynatraceDelete,
    ]);

    await request(app.getHttpServer())
      .get('/test/cap-required-query-org?orgId=org-b')
      .set('Authorization', 'user:user-5,perfana-user')
      .expect(200);

    expect(authzService.getCapabilities).toHaveBeenCalledWith(
      'user-5',
      ['perfana-user'],
      'org-b',
    );
  });
});
