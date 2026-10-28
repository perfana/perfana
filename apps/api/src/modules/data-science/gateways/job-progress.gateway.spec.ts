import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JobProgressGateway } from './job-progress.gateway';
import { AuthenticatedSocket } from '../../test-runs/guards/websocket-auth.guard';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { JobProgressService } from '../services/job-progress.service';

/**
 * These tests pin the tenant-isolation invariants of this gateway, which had
 * none before v0.2.97.38 — not a weak check but the absence of one.
 *
 *  1. subscribe:scope joins a scope room only for a caller that is a member of
 *     the system under test's organization, and fails closed on every
 *     uncertainty. The room carries live job:progress / job:completed /
 *     job:failed / job:stuck / job:blocked traffic, so joining it IS the read.
 *  2. the connect acknowledgment carries no cross-tenant job list. It used to
 *     call getAllActiveJobs() unconditionally for every authenticated socket.
 *  3. query:job answers on the job's OWN scope, and answers identically for a
 *     job that does not exist and a job the caller may not see.
 *  4. an unverified `organization_id` JWT claim is never an authorization
 *     decision — the v0.2.97.37 defect in the sibling gateway.
 */
describe('JobProgressGateway tenant isolation', () => {
  let gateway: JobProgressGateway;
  let query: jest.Mock;
  let getAccessibleOrganizations: jest.Mock;
  let getActiveJobForScope: jest.Mock;
  let getAllActiveJobs: jest.Mock;
  let getJobProgress: jest.Mock;

  const SUT = '11111111-2222-3333-4444-555555555555';

  const socket = (over: Partial<AuthenticatedSocket> = {}) =>
    ({
      id: 'socket-1',
      userId: 'user-a',
      authType: 'keycloak-jwt',
      roles: [],
      // handleConnection ends with Array.from(client.rooms).
      rooms: new Set<string>(),
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      ...over,
    }) as unknown as AuthenticatedSocket;

  const progress = (over: Record<string, unknown> = {}) => ({
    jobId: 'job-1',
    testRunId: 'run-1',
    systemUnderTestId: SUT,
    testEnvironment: 'acc',
    workload: 'loadTest',
    ...over,
  });

  const scope = { systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'loadTest' };
  const room = `job:scope:${SUT}:acc:loadTest`;

  beforeEach(() => {
    query = jest.fn();
    getAccessibleOrganizations = jest.fn().mockResolvedValue([]);
    getActiveJobForScope = jest.fn().mockResolvedValue(null);
    getAllActiveJobs = jest.fn().mockResolvedValue([progress()]);
    getJobProgress = jest.fn().mockResolvedValue(null);
    gateway = new JobProgressGateway(
      { get: jest.fn() } as unknown as ConfigService,
      {} as ApiKeysService,
      { getActiveJobForScope, getAllActiveJobs, getJobProgress } as unknown as JobProgressService,
      { getAccessibleOrganizations } as unknown as AuthorizationService,
      { query } as unknown as DataSource,
    );
    gateway.server = { sockets: { sockets: new Map() } } as never;
  });

  describe('subscribe:scope', () => {
    it('joins the room when the caller is a member of the system organization', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-1']);
      const client = socket();

      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result).toEqual({ success: true, room, scope, activeJob: null });
      expect(client.join).toHaveBeenCalledWith(room);
      expect(getAccessibleOrganizations).toHaveBeenCalledWith('user-a');
    });

    it('denies a caller whose memberships do not include the system organization', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-2']);
      const client = socket();

      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result).toEqual({ success: false, error: 'Not authorized for this scope' });
      expect(client.join).not.toHaveBeenCalled();
      // The scope lookup must not run either: its result is the other tenant's.
      expect(getActiveJobForScope).not.toHaveBeenCalled();
    });

    it('denies a caller that only asserts the organization through a JWT claim', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue([]);
      const client = socket({ organizationId: 'org-1' });

      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result).toEqual({ success: false, error: 'Not authorized for this scope' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown system', [] as unknown[]],
      ['a system whose organization_id is NULL', [{ organization_id: null }]],
    ])('fails closed on %s', async (_label, rows) => {
      query.mockResolvedValueOnce(rows);
      getAccessibleOrganizations.mockResolvedValue(['org-1']);

      const client = socket();
      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result.success).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('fails closed when the ownership lookup throws', async () => {
      query.mockRejectedValueOnce(new Error('statement timeout'));
      getAccessibleOrganizations.mockResolvedValue(['org-1']);

      const client = socket();
      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result.success).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('fails closed when membership resolution throws', async () => {
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockRejectedValue(new Error('redis down'));

      const client = socket();
      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result.success).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('denies a non-uuid system id without issuing the query', async () => {
      // The id is bound as a uuid, so a non-uuid would make the statement throw
      // rather than return no rows. Deny on the shape first.
      const client = socket();
      const result = await gateway.handleSubscribeToScope(client, { ...scope, systemUnderTestId: 'not-a-uuid' });

      expect(result.success).toBe(false);
      expect(query).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('lets an admin join without a membership lookup', async () => {
      const client = socket({ roles: ['perfana-admin'] });

      const result = await gateway.handleSubscribeToScope(client, scope);

      expect(result.success).toBe(true);
      expect(client.join).toHaveBeenCalledWith(room);
      expect(query).not.toHaveBeenCalled();
      expect(getAccessibleOrganizations).not.toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    it('does not put any job in the acknowledgment', async () => {
      const client = socket();

      await gateway.handleConnection(client);

      expect(getAllActiveJobs).not.toHaveBeenCalled();
      const payload = (client.emit as jest.Mock).mock.calls[0]![1];
      expect(payload).not.toHaveProperty('activeJobs');
    });

    it('does not put any job in an ADMIN acknowledgment either', async () => {
      // Admins get the whole picture from the job:all room, not from a payload
      // that would also reach every non-admin if the branch ever moved.
      const client = socket({ roles: ['perfana-admin'] });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('job:all');
      expect(getAllActiveJobs).not.toHaveBeenCalled();
      expect((client.emit as jest.Mock).mock.calls[0]![1]).not.toHaveProperty('activeJobs');
    });
  });

  describe('query:job', () => {
    it('returns the progress when the caller may read the job scope', async () => {
      getJobProgress.mockResolvedValue(progress());
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-1']);

      const result = await gateway.handleQueryJob(socket(), { jobId: 'job-1' });

      expect(result.progress).toEqual(progress());
    });

    it('answers a job in another organization exactly like a job that does not exist', async () => {
      getJobProgress.mockResolvedValue(progress());
      query.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
      getAccessibleOrganizations.mockResolvedValue(['org-2']);

      const denied = await gateway.handleQueryJob(socket(), { jobId: 'job-1' });

      getJobProgress.mockResolvedValue(null);
      const missing = await gateway.handleQueryJob(socket(), { jobId: 'job-404' });

      expect(denied).toEqual({ success: true, jobId: 'job-1', progress: null });
      expect(missing).toEqual({ success: true, jobId: 'job-404', progress: null });
    });
  });
});
