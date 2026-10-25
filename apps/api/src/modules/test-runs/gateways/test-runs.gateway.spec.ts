import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
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
    ({ id: 'socket-1', userId: 'user-a', roles: [], join: jest.fn(), leave: jest.fn(), ...over }) as unknown as AuthenticatedSocket;

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

    it('does not widen delivery when a caller passes no targeting at all', () => {
      // realtime.service.broadcastTestRunDeleted passes undefined for all three.
      gateway.emitTestRunDeleted(
        { eventType: TestRunEventType.DELETED, timestamp: new Date().toISOString(), testRunId: 'run-1', id: '' },
        undefined,
        undefined,
        undefined,
      );

      expect(serverEmit).not.toHaveBeenCalled();
      expect(gateway.server.to).toHaveBeenCalledTimes(1);
      expect(gateway.server.to).toHaveBeenCalledWith('global');
    });

    it('emits to the rooms it is given', () => {
      gateway.emitTestRunUpdated(event(), 'user-a', 'org-1', 'team-1');

      expect(serverEmit).not.toHaveBeenCalled();
      expect(gateway.server.to).toHaveBeenCalledWith('org:org-1');
      expect(emit).toHaveBeenCalledTimes(4); // user, org, team, global
    });
  });
});
