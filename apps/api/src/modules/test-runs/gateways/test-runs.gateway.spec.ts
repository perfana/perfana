import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { jwtVerify } from 'jose';
import { TestRunsGateway } from './test-runs.gateway';
import { AuthenticatedSocket } from '../guards/websocket-auth.guard';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { TestRunEvent, TestRunEventType } from '../types/realtime-events.types';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * These tests pin the tenant-isolation invariants of this gateway:
 *
 *  1. subscribe:test-run only joins a run's room for a caller that is a member
 *     of that run's organization, and fails closed on every uncertainty.
 *  2. handleConnection joins an `org:`/`team:` room only on verified
 *     membership. A JWT claim may narrow the set, never widen it — `org:` is
 *     where events are actually delivered, so an unverified claim there is the
 *     same leak as an unverified subscribe.
 *  3. a test run event is never delivered to every connected client, whatever
 *     the caller passes — the gateway serves all tenants on one namespace.
 *  4. a caller that passes no organization (the normal case for a Keycloak
 *     login) still reaches the owning org, from the run's own ownership.
 */
describe('TestRunsGateway tenant isolation', () => {
  let gateway: TestRunsGateway;
  let query: jest.Mock;
  let getAccessibleOrganizations: jest.Mock;
  let emit: jest.Mock;
  let serverEmit: jest.Mock;
  let to: jest.Mock;

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
    getAccessibleOrganizations = jest.fn().mockResolvedValue([]);
    emit = jest.fn();
    serverEmit = jest.fn();
    // A loud default: every fan-out assertion below counts `to` calls, and a
    // `to` that silently returns undefined would make a dropped emit look like
    // a pass. Returning the emit stub by default means an unexpected room
    // shows up as a count mismatch, not as a crash or a false green.
    to = jest.fn().mockReturnValue({ emit });
    gateway = new TestRunsGateway(
      { get: jest.fn() } as unknown as ConfigService,
      {} as ApiKeysService,
      { getAccessibleOrganizations } as unknown as AuthorizationService,
      { query } as unknown as DataSource,
    );
    gateway.server = { emit: serverEmit, to } as never;
  });

  describe('subscribe:test-run', () => {
    it('joins the room when the caller is a member of the run organization', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-1']);
      const client = socket();

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: true, room: 'test-run:run-1', testRunId: 'run-1' });
      expect(client.join).toHaveBeenCalledWith('test-run:run-1');
      expect(getAccessibleOrganizations).toHaveBeenCalledWith('user-a');
    });

    it('denies a caller whose memberships do not include the run organization', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-2']);
      const client = socket();

      const result = await gateway.handleSubscribeToTestRun(client, { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('denies a caller that only asserts the organization through a JWT claim', async () => {
      // The pre-fix check was gated on client.organizationId, which made an
      // absent claim skip the comparison entirely. A present claim must not be
      // an authorization decision either.
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue([]);
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
      // The membership lookup is the expensive half; a NULL org short-circuits.
      expect(getAccessibleOrganizations).not.toHaveBeenCalled();
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
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockRejectedValue(new Error('connection terminated'));

      const result = await gateway.handleSubscribeToTestRun(socket(), { testRunId: 'run-1' });

      expect(result).toEqual({ success: false, error: 'Access denied to this test run' });
    });

    /*
     * Value: protects=the run lookup is a single-row index scan on whichever
     * key it was handed, never `id::text = $1 OR test_run_id = $1`;
     * fails_when=the two arms are merged back into one OR, which casts the uuid
     * primary key and so cannot use its index — a sequential scan of
     * `test_runs` with a per-row cast, on a path that now gates access and must
     * not be the thing that times out; why_new=no test asserted the SQL shape,
     * only its result; seam=none; no_claim=the plan Postgres actually picks
     * (the SQL text is asserted, not an EXPLAIN; unit only)
     */
    it('looks a run up by its primary key only when the id is a uuid', async () => {
      query.mockResolvedValue([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-1']);

      await gateway.handleSubscribeToTestRun(socket(), {
        testRunId: '00000000-0000-4000-8000-000000000000',
      });
      expect(query.mock.calls[0]![0]).toContain('WHERE id = $1::uuid');
      expect(query.mock.calls[0]![0]).not.toContain('::text');

      query.mockClear();
      await gateway.handleSubscribeToTestRun(socket(), { testRunId: 'MyRun-2026-01' });
      expect(query.mock.calls[0]![0]).toContain('WHERE test_run_id = $1');
      expect(query.mock.calls[0]![0]).not.toContain('id = $1::uuid');
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
    expect(getAccessibleOrganizations).not.toHaveBeenCalled();
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
      expect(getAccessibleOrganizations).not.toHaveBeenCalled();
    });
  });

  describe('event fan-out', () => {
    it('never broadcasts to every connected client when no rooms are given', () => {
      gateway.emitTestRunEvent(event());

      expect(serverEmit).not.toHaveBeenCalled();
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(['global']);
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it('never broadcasts when an empty room list is given', () => {
      gateway.emitTestRunEvent(event(), []);

      expect(serverEmit).not.toHaveBeenCalled();
      // An empty list is not a broadcast and not a drop: it falls through to
      // the event's own targeting, which here resolves to admins only. Asserted
      // by count as well as by argument, or a dropped emit passes this test.
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(['global']);
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it('falls back to the rooms named by the event itself', () => {
      gateway.emitTestRunEvent({
        ...event(),
        userId: 'user-a',
        organizationId: 'org-1',
        teamId: 'team-1',
      });

      expect(serverEmit).not.toHaveBeenCalled();
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(['user:user-a', 'org:org-1', 'team:team-1', 'global']);
      expect(emit).toHaveBeenCalledTimes(1);
    });

    /*
     * Value: protects=an event whose caller passed no organization still reaches
     * the owning tenant, resolved from the run on the payload;
     * fails_when=the `run?.organizationId` fallback is dropped, which is the
     * normal path rather than an edge one — the enhanced auth guard leaves
     * UserCtx.organizationId undefined for every Keycloak login, so every
     * HTTP-initiated change would reach only the actor and the admin room and
     * same-organization colleagues would stop seeing each other's runs;
     * why_new=no test covered ownership arriving on the payload instead of as
     * an argument; seam=the two TestRun interfaces in this module, which both
     * have to carry the fields; no_claim=that the mappers populate them (that
     * is entity-mapper's own test; unit only)
     */
    it('targets the owning organization from the run when the caller passes none', () => {
      gateway.emitTestRunUpdated(
        {
          ...event(),
          testRun: { test_run_id: 'run-1', organizationId: 'org-9', teamId: 'team-9' } as never,
        },
        'user-a',
        undefined,
        undefined,
      );

      expect(serverEmit).not.toHaveBeenCalled();
      expect(to).toHaveBeenCalledWith(['user:user-a', 'org:org-9', 'team:team-9', 'global']);
    });

    /*
     * Value: protects=an explicit organization from the caller wins over the
     * run's own, so a deliberate narrowing is not silently widened;
     * fails_when=the `??` operands are swapped, which would let a stale or
     * shared payload decide delivery; why_new=the fallback test alone cannot
     * tell precedence apart from "either one works";
     * seam=none; no_claim=none beyond protects
     */
    it('prefers the organization the caller passed over the run own', () => {
      gateway.emitTestRunUpdated(
        { ...event(), testRun: { test_run_id: 'run-1', organizationId: 'org-9' } as never },
        'user-a',
        'org-1',
        undefined,
      );

      expect(to).toHaveBeenCalledWith(['user:user-a', 'org:org-1', 'global']);
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
      // realtime.service.broadcastTestRunDeleted passes undefined for all three,
      // and a DELETED event carries no `testRun` to fall back to.
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      try {
        gateway.emitTestRunDeleted(
          {
            eventType: TestRunEventType.DELETED,
            timestamp: new Date().toISOString(),
            testRunId: 'run-1',
            id: '',
          },
          undefined,
          undefined,
          undefined,
        );

        expect(serverEmit).not.toHaveBeenCalled();
        expect(to).toHaveBeenCalledTimes(1);
        expect(to).toHaveBeenCalledWith(['global']);
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
      // One publish for the whole set, not one per room: socket.io unions them
      // and delivers once per socket, so an admin in all four rooms gets one
      // copy instead of four.
      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith(['user:user-a', 'org:org-1', 'team:team-1', 'global']);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * Value: protects=handleConnection joins only the org rooms the identity is a
   * verified member of; fails_when=an unverified JWT claim is allowed to add a
   * room, or a non-admin joins the global room;
   * why_new=the spec covered subscribe and fan-out only, never handleConnection;
   * seam=none; no_claim=Socket.IO room delivery (join is mocked; unit only)
   */
  describe('handleConnection room membership', () => {
    it('joins only the tenant rooms the identity actually earns', async () => {
      getAccessibleOrganizations.mockResolvedValue(['org-1', 'org-claim']);
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]); // teams lookup
      const client = socket({
        userId: 'user-a',
        // Already a member, so the claim adds nothing and must not double-join.
        organizationId: 'org-claim',
        teamId: 'team-1',
      });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:user-a');
      expect(client.join).toHaveBeenCalledWith('org:org-1');
      expect(client.join).toHaveBeenCalledWith('org:org-claim');
      expect(client.join).toHaveBeenCalledWith('team:team-1');
      expect(client.join).not.toHaveBeenCalledWith('org:null');
      expect(client.join).not.toHaveBeenCalledWith('org:undefined');
      // Global is admin monitoring only.
      expect(client.join).not.toHaveBeenCalledWith('global');
      expect(client.join).toHaveBeenCalledTimes(4);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    /*
     * Value: protects=handleConnection refuses to join an `org:` room named only
     * by a JWT claim, and warns; fails_when=the claim is unioned into the room
     * set instead of intersected with the verified one — `org:{id}` is the room
     * every test run event is delivered to, so a token carrying another
     * tenant's organization_id would receive that tenant's whole event stream
     * without ever calling subscribe; why_new=the original test set the claim
     * equal to a membership row, which only proved the dedupe and left the
     * widening path untested; seam=none; no_claim=that Keycloak cannot be
     * configured to mint a trustworthy organization_id (it is simply not
     * verified here)
     */
    it('refuses an org room named only by the JWT claim', async () => {
      const logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        getAccessibleOrganizations.mockResolvedValue(['org-1']);
        const client = socket({ organizationId: 'org-2' });

        await gateway.handleConnection(client);

        expect(client.join).toHaveBeenCalledWith('org:org-1');
        expect(client.join).not.toHaveBeenCalledWith('org:org-2');
        expect(client.join).not.toHaveBeenCalledWith('global');
        expect(client.join).toHaveBeenCalledTimes(2); // user + org-1
        expect(logWarn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
          /organization_id org-2 it is not a member of/,
        );
      } finally {
        logWarn.mockRestore();
      }
    });

    /*
     * Value: protects=a `team_id` claim only joins a team room when that team
     * belongs to one of the caller's verified organizations;
     * fails_when=the teams lookup is dropped and the claim is trusted again, so
     * any token carrying a team id joins that team's room — the same unverified
     * claim as the org one, and the arm that had no check at all before;
     * why_new=the team claim was joined unconditionally and nothing covered it;
     * seam=none; no_claim=that a team room receives less than its org room
     */
    it('refuses a team room whose team is outside the caller organizations', async () => {
      getAccessibleOrganizations.mockResolvedValue(['org-1']);
      query.mockResolvedValueOnce([{ organization_id: 'org-other' }]);
      const client = socket({ teamId: 'team-x' });

      await gateway.handleConnection(client);

      expect(client.join).not.toHaveBeenCalledWith('team:team-x');
      expect(client.join).toHaveBeenCalledTimes(2); // user + org-1
    });

    it('refuses a team room for a team that does not exist', async () => {
      getAccessibleOrganizations.mockResolvedValue(['org-1']);
      query.mockResolvedValueOnce([]);
      const client = socket({ teamId: 'team-x' });

      await gateway.handleConnection(client);

      expect(client.join).not.toHaveBeenCalledWith('team:team-x');
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
      getAccessibleOrganizations.mockResolvedValue([]);
      const client = socket({ roles: ['perfana-admin'] });

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
      const client = socket({ userId: undefined });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledTimes(1);
      expect(client.join).not.toHaveBeenCalled();
      expect(getAccessibleOrganizations).not.toHaveBeenCalled();
    });

    /*
     * Value: protects=a membership lookup failure joins no org room rather than
     * every one or a guessed one; fails_when=the try/catch in
     * resolveAccessibleOrganizationIds stops returning [], so the rejection
     * escapes handleConnection and leaves the socket connected, authenticated
     * and silently in no tenant room at all; why_new=the fail-closed arm was
     * only covered on the subscribe path;
     * seam=none; no_claim=none beyond protects
     */
    it('joins no org room when the membership lookup fails', async () => {
      getAccessibleOrganizations.mockRejectedValue(new Error('redis down'));
      const client = socket();

      await expect(gateway.handleConnection(client)).resolves.toBeUndefined();

      expect(client.join).toHaveBeenCalledTimes(1);
      expect(client.join).toHaveBeenCalledWith('user:user-a');
    });
  });

  describe('Keycloak JWT verification', () => {
    const connect = async (configured: Record<string, string>) => {
      const config = {
        get: jest.fn((key: string) => configured[key]),
      } as unknown as ConfigService;
      const gw = new TestRunsGateway(
        config,
        { validateApiKey: jest.fn().mockResolvedValue(null) } as unknown as ApiKeysService,
        { getAccessibleOrganizations: jest.fn().mockResolvedValue([]) } as unknown as AuthorizationService,
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
     * Value: protects=the gateway does NOT pass an `audience` to jose, and so
     * keeps accepting the browser's token; fails_when=an audience check is
     * added here alone — the browser authenticates against `perfana-web`, so
     * its `aud` never contains KEYCLOAK_CLIENT_ID and the shipped realm defines
     * no audience mapper, which takes realtime updates out for every logged-in
     * user, silently, because the throw lands in a debug-level catch;
     * why_new=this was shipped and reverted inside one change, and the revert
     * needs a test or the next reader re-adds it; seam=the four JWT verifiers
     * that must move together (TODOS.md);
     * no_claim=that skipping the check is the right end state (it is the
     * current realm's constraint, recorded as debt), nor real Keycloak
     * behaviour (jose is mocked; unit only)
     */
    it('verifies issuer and signature without an audience check', async () => {
      const next = await connect({
        KEYCLOAK_URL: 'http://keycloak:8080',
        KEYCLOAK_REALM: 'perfana-prod',
        KEYCLOAK_CLIENT_ID: 'perfana-api',
      });

      expect(jwtVerify).toHaveBeenCalledTimes(1);
      const options = (jwtVerify as jest.Mock).mock.calls[0]![2] as Record<string, unknown>;
      expect(options).not.toHaveProperty('audience');
      expect(options.issuer).toContain('http://keycloak:8080/realms/perfana-prod');
      expect(next).toHaveBeenCalledWith();
    });

    /*
     * Value: protects=a browser token whose `aud` is the frontend client still
     * connects; fails_when=audience enforcement returns in any form — this is
     * the exact token shape every logged-in user presents;
     * why_new=the options assertion above is structural, this one is the
     * outcome that structure exists for;
     * seam=none; no_claim=real Keycloak verification (jose is mocked)
     */
    it('accepts a token whose audience is the frontend client', async () => {
      (jwtVerify as jest.Mock).mockResolvedValue({
        payload: { sub: 'user-a', aud: 'perfana-web', azp: 'perfana-web' },
        protectedHeader: {},
      });

      const next = await connect({
        KEYCLOAK_URL: 'http://keycloak:8080',
        KEYCLOAK_REALM: 'perfana-prod',
        KEYCLOAK_CLIENT_ID: 'perfana-api',
      });

      expect(next).toHaveBeenCalledWith();
    });
  });
});
