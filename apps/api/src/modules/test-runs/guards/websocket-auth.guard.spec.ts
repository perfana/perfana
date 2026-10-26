import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { AuthenticatedSocket, WebSocketAuthGuard } from './websocket-auth.guard';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * This guard verified Keycloak JWTs with `audience: clientId || undefined`.
 * `undefined` does not relax the audience check in jose — it removes it, so an
 * unset KEYCLOAK_CLIENT_ID accepted any token minted for any client in the
 * realm. These tests pin the two halves of the fix: refuse when the client id
 * is missing, and pass it as the audience when it is present.
 */
describe('WebSocketAuthGuard Keycloak JWT audience', () => {
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
   * Value: protects=canActivate rejects a Keycloak JWT when KEYCLOAK_CLIENT_ID
   * is unset, instead of verifying it with no audience check;
   * fails_when=the guard falls back to `audience: undefined` and accepts a
   * token minted for another client in the realm;
   * why_new=this guard had no spec file at all;
   * seam=none; no_claim=real token verification (jose is mocked; unit only)
   */
  it('rejects the client when KEYCLOAK_CLIENT_ID is not configured', async () => {
    const guard = buildGuard({
      KEYCLOAK_URL: 'http://keycloak:8080',
      KEYCLOAK_REALM: 'perfana-prod',
    });
    const client = socket();

    await expect(guard.canActivate(contextFor(client))).rejects.toThrow(
      /Invalid or expired token/,
    );
    expect(jwtVerify).not.toHaveBeenCalled();
    expect(client.userId).toBeUndefined();
  });

  /*
   * Value: protects=the guard hands jose the configured client id as the JWT
   * audience; fails_when=the audience option reverts to `clientId || undefined`
   * or is removed, which disables the check entirely;
   * why_new=this guard had no spec file at all;
   * seam=none; no_claim=that another client's token is really rejected (jose is mocked)
   */
  it('verifies the token against the configured client id as audience', async () => {
    const guard = buildGuard({
      KEYCLOAK_URL: 'http://keycloak:8080',
      KEYCLOAK_REALM: 'perfana-prod',
      KEYCLOAK_CLIENT_ID: 'perfana-api',
    });
    const client = socket();

    await expect(guard.canActivate(contextFor(client))).resolves.toBe(true);
    expect(jwtVerify).toHaveBeenCalledTimes(1);
    expect((jwtVerify as jest.Mock).mock.calls[0]![2]).toMatchObject({
      audience: 'perfana-api',
    });
    expect(client.authType).toBe('keycloak-jwt');
  });
});
