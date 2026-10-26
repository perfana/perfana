import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { jwtVerify } from 'jose';
import { TestRunsGateway } from './test-runs.gateway';
import { AuthenticatedSocket } from '../guards/websocket-auth.guard';
import { TestRunEvent, TestRunEventType } from '../types/realtime-events.types';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * These tests pin the two tenant-isolation invariants of this gateway:
 *
 *  1. subscribe:test-run only joins a run's room for a caller that is a member
 *     of that run's organization, and fails closed on every uncertainty.
 *  2. a test run event is never delivered to every connected client, whatever
 *     the caller passes — the gateway serves all tenants on one namespace.
 */
describe('TestRunsGateway tenant isolation', () => {
  let gateway: TestRunsGateway;
  let query: jest.Mock;
  let emit: jest.Mock;
  let serverEmit: jest.Mock;

  const socket = (over: Partial<AuthenticatedSocket> = {}) =>
    ({
      id: 'socket-1',
      userId: 'user-a',
      roles: [],
      // handleConnection ends with Array.from(client.rooms), so every socket
      // needs one even when the test only cares about join().
      rooms: new Set<string>(),
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      ...over,
    }) as unknown as AuthenticatedSocket;

  const event = (): TestRunEvent => ({
    eventType: TestRunEventType.UPDATED,
    timestamp: new Date().toISOString(),
    testRun: { test_run_id: 'run-1' } as never,
  });

  beforeEach(() => {
    query = jest.fn();
    emit = jest.fn();
    serverEmit = jest.fn();
    gateway = new TestRunsGateway(
      { get: jest.fn() } as unknown as ConfigService,
      {} as ApiKeysService,
      { query } as unknown as DataSource,
    );
    gateway.server = {
      emit: serverEmit,
      to: jest.fn().mockReturnValue({ emit }),
    } as never;
  });

  describe('subscribe:test-run', () => {
    it('joins the room when the caller is a member of the run organization', async () => {
      query
        .mockResolvedValueOnce([{ organization_id: 'org-1' }]) // test_runs
        .mockResolvedValueOnce([{ organization_id: 'org-1' }]); // organization_members
      const client = socket();

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: true, room: 'test-run:run-1', testRunId: 'run-1' });
      expect(client.join).toHaveBeenCalledWith('test-run:run-1');
    });

    it('denies a caller whose memberships do not include the run organization', async () => {
      query
        .mockResolvedValueOnce([{ organization_id: 'org-1' }])
        .mockResolvedValueOnce([{ organization_id: 'org-2' }]);
      const client = socket();

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('denies a caller that only asserts the organization through a JWT claim', async () => {
      // The pre-fix check was gated on client.organizationId, which made an
      // absent claim skip the comparison entirely. A present claim must not be
      // an authorization decision either.
      query
        .mockResolvedValueOnce([{ organization_id: 'org-1' }])
        .mockResolvedValueOnce([]); // no membership rows
      const client = socket({ organizationId: 'org-1' });

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('denies when the run has no organization', async () => {
      query.mockResolvedValueOnce([{ organization_id: null }]);
      const client = socket();

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('denies when the run does not exist', async () => {
      query.mockResolvedValueOnce([]);

      const result = await gateway.handleSubscribeToTestRun(socket(), { testRunId: 'nope' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
    });

    it('denies when the lookup fails instead of falling through to the join', async () => {
      query.mockRejectedValueOnce(new Error('connection terminated'));
      const client = socket();

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('denies when the membership lookup fails', async () => {
      query
        .mockResolvedValueOnce([{ organization_id: 'org-1' }])
        .mockRejectedValueOnce(new Error('connection terminated'));

      const result = await gateway.handleSubscribeToTestRun(socket(), { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
    });

  /*
   * Value: protects=mayReadTestRun denies a socket that carries no user id,
   * before it reads either table; fails_when=the !client.userId guard is
   * removed, so an identity-less socket reaches the membership comparison with
   * undefined and can subscribe; why_new=every existing subscribe test supplies
   * a userId, so this fail-closed arm was never entered;
   * seam=none; no_claim=that the middleware cannot produce such a socket
   * (handleConnection disconnects one, but canActivate and the middleware are
   * separate paths; unit only)
   */
  it('denies a socket with no user id without querying anything', async () => {
    const client = socket({ userId: undefined });

    const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

    expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
    expect(query).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  /*
   * Value: protects=subscribe rejects a missing testRunId before any
   * authorization work; fails_when=the required-field guard is dropped, so
   * undefined reaches the SQL as a bound parameter and the room name becomes
   * `test-run:undefined`, which every such caller would share;
   * why_new=no test exercised the empty-payload arm;
   * seam=none; no_claim=none beyond protects
   */
  it('rejects a missing testRunId before authorizing', async () => {
    const client = socket();

    const result = await gateway.handleSubscribeToTestRun(client, { testRunId: '' });

    expect(result).toEqual({ success: false, error: 'testRunId is required' });
    expect(query).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

    it('lets an admin subscribe without a membership lookup', async () => {
      const client = socket({ roles: ['perfana-admin'] });

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: true, room: 'test-run:run-1', testRunId: 'run-1' });
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('event fan-out', () => {
    it('never broadcasts to every connected client when no rooms are given', () => {
      gateway.emitTestRunEvent(event());

      expect(serverEmit).not.toHaveBeenCalled();
      expect(gateway.server.to).toHaveBeenCalledWith('global');
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it('never broadcasts when an empty room list is given', () => {
      gateway.emitTestRunEvent(event(), []);

      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('falls back to the rooms named by the event itself', () => {
      gateway.emitTestRunEvent({ ...event(), userId: 'user-a', organizationId: 'org-1', teamId: 'team-1' });

      expect(serverEmit).not.toHaveBeenCalled();
      expect(gateway.server.to).toHaveBeenCalledWith('user:user-a');
      expect(gateway.server.to).toHaveBeenCalledWith('org:org-1');
      expect(gateway.server.to).toHaveBeenCalledWith('team:team-1');
    });

    /*
     * Value: protects=an event with no targeting reaches admins only AND says so
     * at ERROR, so the unresolved caller is diagnosable; fails_when=the
     * rooms.length===1 branch in determineTargetRooms is deleted, which is
     * invisible to a delivery-only assertion; why_new=extends the existing
     * no-widening test, which executed that branch without checking it;
     * seam=none; no_claim=that the log reaches a collector (Logger is spied)
     */
    it('does not widen delivery when a caller passes no targeting at all, and says so', () => {
      // realtime.service.broadcastTestRunDeleted passes undefined for all three.
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      try {
        gateway.emitTestRunDeleted(
          { eventType: TestRunEventType.DELETED, timestamp: new Date().toISOString(), testRunId: 'run-1', id: '' },
          undefined,
          undefined,
          undefined,
        );

        expect(serverEmit).not.toHaveBeenCalled();
        expect(gateway.server.to).toHaveBeenCalledTimes(1);
        expect(gateway.server.to).toHaveBeenCalledWith('global');
        // The admin-only delivery is correct but degraded; it must be reported.
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError.mock.calls[0]![0]).toMatch(/no user\/org\/team targeting/);
      } finally {
        logError.mockRestore();
      }
    });

    it('emits to the rooms it is given', () => {
      gateway.emitTestRunUpdated(event(), 'user-a', 'org-1', 'team-1');

      expect(serverEmit).not.toHaveBeenCalled();
      expect(gateway.server.to).toHaveBeenCalledWith('org:org-1');
      expect(emit).toHaveBeenCalledTimes(4); // user, org, team, global
    });
  });

  /*
   * Value: protects=handleConnection joins only the org rooms the identity is a
   * real member of; fails_when=the NULL-org filter or the JWT-claim dedupe is
   * dropped, or a non-admin joins the global room;
   * why_new=the spec covered subscribe and fan-out only, never handleConnection;
   * seam=none; no_claim=Socket.IO room delivery (join is mocked; unit only)
   */
  describe('handleConnection room membership', () => {
    it('joins only the tenant rooms the identity actually earns', async () => {
      query.mockResolvedValueOnce([
        { organization_id: 'org-1' },
        { organization_id: null }, // must be dropped by filter(Boolean)
        { organization_id: 'org-claim' },
      ]);
      const client = socket({
        userId: 'user-a',
        // Already a member, so the claim must not produce a second join.
        organizationId: 'org-claim',
        teamId: 'team-1',
        rooms: new Set<string>(),
        emit: jest.fn(),
        disconnect: jest.fn(),
      });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:user-a');
      expect(client.join).toHaveBeenCalledWith('org:org-1');
      expect(client.join).toHaveBeenCalledWith('org:org-claim');
      expect(client.join).toHaveBeenCalledWith('team:team-1');
      // A NULL organization_id row would otherwise create one `org:null` room
      // that every tenant with a NULL-org membership would share.
      expect(client.join).not.toHaveBeenCalledWith('org:null');
      expect(client.join).not.toHaveBeenCalledWith('org:undefined');
      // Global is admin monitoring only.
      expect(client.join).not.toHaveBeenCalledWith('global');
      expect(client.join).toHaveBeenCalledTimes(4);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    /*
     * Value: protects=handleConnection joins the organization named by a JWT
     * claim the caller has no membership row for; fails_when=the claim arm is
     * removed, so an API-key identity that carries organization_id joins no org
     * room and silently receives nothing; why_new=the existing test sets the
     * claim equal to a membership row, which only proves the dedupe;
     * seam=none; no_claim=that the claim is trustworthy (it is read from a
     * verified token, not checked against organization_members here)
     */
    it('joins an org named only by the JWT claim', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      const client = socket({
        organizationId: 'org-2',
        emit: jest.fn(),
        disconnect: jest.fn(),
      });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('org:org-1');
      expect(client.join).toHaveBeenCalledWith('org:org-2');
      expect(client.join).not.toHaveBeenCalledWith('global');
    });

    /*
     * Value: protects=only an admin identity joins the global room, which
     * receives every tenant's events; fails_when=the isAdmin guard is removed
     * or inverted, which turns the global room into a cross-tenant firehose for
     * ordinary users; why_new=the existing test only proves a NON-admin stays
     * out, so the true arm was never executed;
     * seam=none; no_claim=that roles on the socket are authentic (set by the
     * middleware from a verified token or an API key; unit only)
     */
    it('joins the global room for an admin identity', async () => {
      query.mockResolvedValueOnce([]);
      const client = socket({
        roles: ['perfana-admin'],
        emit: jest.fn(),
        disconnect: jest.fn(),
      });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('global');
      expect(client.join).toHaveBeenCalledWith('user:user-a');
    });

    /*
     * Value: protects=an unauthenticated socket is disconnected and joins
     * nothing; fails_when=the !client.userId guard is removed, so
     * TestRunRooms.user(undefined) creates a shared `user:undefined` room every
     * identity-less socket lands in; why_new=no test entered the disconnect arm;
     * seam=none; no_claim=none beyond protects
     */
    it('disconnects a socket with no user id and joins no room', async () => {
      const client = socket({ userId: undefined, emit: jest.fn(), disconnect: jest.fn() });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledTimes(1);
      expect(client.join).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });
  });

    describe('Keycloak JWT audience', () => {
    const connect = async (configured: Record<string, string>) => {
      const config = {
        get: jest.fn((key: string) => configured[key]),
      } as unknown as ConfigService;
      const gw = new TestRunsGateway(
        config,
        { validateApiKey: jest.fn().mockResolvedValue(null) } as unknown as ApiKeysService,
        { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource,
      );
      // No `adapter` function on the stub server, so the Redis setup is skipped.
      gw.server = { emit: jest.fn(), to: jest.fn() } as never;

      const use = jest.fn();
      await gw.afterInit({ use } as never);

      const middleware = use.mock.calls[0]![0] as (
        s: unknown,
        next: (err?: Error) => void,
      ) => Promise<void>;
      const next = jest.fn();
      await middleware(
        { id: 'socket-1', handshake: { auth: { token: 'a.b.c' } } },
        next,
      );
      return next;
    };

    beforeEach(() => {
      (jwtVerify as jest.Mock).mockClear();
      (jwtVerify as jest.Mock).mockResolvedValue({
        payload: { sub: 'user-a', realm_access: { roles: ['user'] } },
        protectedHeader: {},
      });
    });

    /*
     * Value: protects=the connect middleware refuses a Keycloak JWT when
     * KEYCLOAK_CLIENT_ID is unset; fails_when=the missing-client-id guard is
     * removed, so a token is verified with no audience check at all;
     * why_new=no test reached validateKeycloakToken on this gateway;
     * seam=none; no_claim=real Keycloak verification (jose is mocked; unit only)
     */
    it('refuses the connection when KEYCLOAK_CLIENT_ID is not configured', async () => {
      const next = await connect({
        KEYCLOAK_URL: 'http://keycloak:8080',
        KEYCLOAK_REALM: 'perfana-prod',
      });

      expect(jwtVerify).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(Error);
    });

    /*
     * Value: protects=the gateway hands jose the configured client id as the JWT
     * audience; fails_when=the audience option is dropped or reverts to
     * `clientId || undefined`, which disables the check;
     * why_new=nothing asserted the verify options on this gateway's JWT path;
     * seam=none; no_claim=that Keycloak mints that aud claim (jose is mocked)
     */
    it('verifies the token against the configured client id as audience', async () => {
      const next = await connect({
        KEYCLOAK_URL: 'http://keycloak:8080',
        KEYCLOAK_REALM: 'perfana-prod',
        KEYCLOAK_CLIENT_ID: 'perfana-api',
      });

      expect(jwtVerify).toHaveBeenCalledTimes(1);
      expect((jwtVerify as jest.Mock).mock.calls[0]![2]).toMatchObject({
        audience: 'perfana-api',
      });
      expect(next).toHaveBeenCalledWith();
    });
  });
});
