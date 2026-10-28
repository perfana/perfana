import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { AuthenticatedSocket, WebSocketAuthGuard } from './websocket-auth.guard';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * This guard is NOT wired to any gateway — nothing references it in a
 * @UseGuards, and `TestRunsGateway` authenticates in its own Socket.IO
 * middleware. It is a provider in `TestRunsModule` and dead otherwise; see
 * TODOS.md.
 *
 * It still gets a spec, because it is a copy of the gateway's verifier and the
 * two drift. These tests pin that its Keycloak verification matches the three
 * other authorities in the repo: issuer and signature, deliberately no
 * audience. A first attempt at this change enforced `audience: clientId` here
 * and in the gateway, which would have taken realtime updates out for every
 * logged-in user — the browser authenticates against `perfana-web`, so its
 * token's `aud` never contains `perfana-api` and the shipped realm defines no
 * audience mapper. That is recorded as debt rather than fixed here, because
 * tightening it needs a realm change and all four verifiers moved together.
 */
describe('WebSocketAuthGuard Keycloak JWT verification', () => {
  const buildGuard = (configured: Record<string, string>) =>
    new WebSocketAuthGuard(
      { get: jest.fn((key: string) => configured[key]) } as unknown as ConfigService,
      { validateApiKey: jest.fn().mockResolvedValue(null) } as unknown as ApiKeysService,
    );

  const contextFor = (client: AuthenticatedSocket) =>
    ({
      switchToWs: () => ({ getClient: () => client }),
    }) as unknown as ExecutionContext;

  const socket = () =>
    ({
      id: 'socket-1',
      handshake: { auth: { token: 'a.b.c' } },
    }) as unknown as AuthenticatedSocket;

  beforeEach(() => {
    (jwtVerify as jest.Mock).mockClear();
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: { sub: 'user-a', realm_access: { roles: ['user'] } },
      protectedHeader: {},
    });
  });

  /*
   * Value: protects=the guard does NOT pass an `audience` to jose, so it keeps
   * accepting the token the browser actually presents; fails_when=an audience
   * check is added here (or restored from the reverted first attempt), which
   * rejects every browser token because its `aud` is the frontend client;
   * why_new=this guard had no spec file at all, and the reverted attempt proves
   * the mistake is reachable; seam=the four JWT verifiers in the repo that have
   * to move together (TODOS.md);
   * no_claim=that skipping the check is the right end state (it is the current
   * realm's constraint, filed as debt), nor real token verification (jose is
   * mocked; unit only)
   */
  it('verifies issuer and signature without an audience check', async () => {
    const guard = buildGuard({
      KEYCLOAK_URL: 'http://keycloak:8080',
      KEYCLOAK_REALM: 'perfana-prod',
      KEYCLOAK_CLIENT_ID: 'perfana-api',
    });
    const client = socket();

    await expect(guard.canActivate(contextFor(client))).resolves.toBe(true);
    expect(jwtVerify).toHaveBeenCalledTimes(1);
    const options = (jwtVerify as jest.Mock).mock.calls[0]![2] as Record<string, unknown>;
    expect(options).not.toHaveProperty('audience');
    expect(options.issuer).toContain('http://keycloak:8080/realms/perfana-prod');
    expect(client.authType).toBe('keycloak-jwt');
  });

  /*
   * Value: protects=the guard authenticates with no KEYCLOAK_CLIENT_ID set at
   * all; fails_when=a missing-client-id refusal is added, which the reverted
   * attempt did — it would deny every WebSocket connection on a deploy that
   * does not set that variable, and deny it silently;
   * why_new=covers the configuration shape the reverted change broke;
   * seam=none; no_claim=real token verification (jose is mocked)
   */
  it('authenticates without KEYCLOAK_CLIENT_ID configured', async () => {
    const guard = buildGuard({
      KEYCLOAK_URL: 'http://keycloak:8080',
      KEYCLOAK_REALM: 'perfana-prod',
    });
    const client = socket();

    await expect(guard.canActivate(contextFor(client))).resolves.toBe(true);
    expect(jwtVerify).toHaveBeenCalledTimes(1);
    expect(client.userId).toBe('user-a');
  });
});
