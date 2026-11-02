/**
 * The two controllers in front of the insights service: they resolve the caller's organization
 * scope ONCE per request and hand it to the service as a required parameter (root CLAUDE.md #48).
 */

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SeriesGroupingInsightsController } from './series-grouping-insights.controller';
import { SeriesGroupingTestRunController } from './series-grouping-test-run.controller';

const ctx = (roles: string[] = ['user']) => ({ userId: 'user-1', roles, organizations: [], teams: [] }) as never;

function make() {
  const insights = {
    preview: jest.fn().mockResolvedValue('preview'),
    apply: jest.fn().mockResolvedValue('apply'),
    suggestions: jest.fn().mockResolvedValue('suggestions'),
    status: jest.fn().mockResolvedValue('status'),
  };
  const authz = {
    isGlobalAdmin: jest.fn().mockReturnValue(false),
    getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-a']),
  };
  return {
    insights,
    authz,
    rules: new SeriesGroupingInsightsController(insights as never, authz as never),
    testRuns: new SeriesGroupingTestRunController(insights as never, authz as never),
  };
}

describe('route shapes', () => {
  const route = (controller: { prototype: object }, method: string) => {
    const handler = (controller.prototype as Record<string, unknown>)[method] as object;
    return {
      path: Reflect.getMetadata(PATH_METADATA, handler),
      verb: Reflect.getMetadata(METHOD_METADATA, handler),
      base: Reflect.getMetadata(PATH_METADATA, controller),
    };
  };

  it('POST /series-grouping-rules/preview and /apply', () => {
    expect(route(SeriesGroupingInsightsController, 'preview')).toEqual({ base: 'series-grouping-rules', path: 'preview', verb: RequestMethod.POST });
    expect(route(SeriesGroupingInsightsController, 'apply')).toEqual({ base: 'series-grouping-rules', path: 'apply', verb: RequestMethod.POST });
  });

  it('GET /test-runs/:id/series-grouping-suggestions and /series-grouping-status', () => {
    expect(route(SeriesGroupingTestRunController, 'suggestions')).toEqual({
      base: 'test-runs',
      path: ':id/series-grouping-suggestions',
      verb: RequestMethod.GET,
    });
    expect(route(SeriesGroupingTestRunController, 'status')).toEqual({
      base: 'test-runs',
      path: ':id/series-grouping-status',
      verb: RequestMethod.GET,
    });
  });
});

describe('organization scope', () => {
  const calls: Array<[string, (c: ReturnType<typeof make>, caller: never) => Promise<unknown>, unknown[]]> = [
    ['preview', (c, caller) => c.rules.preview({ applicationDashboardId: 'd' } as never, caller), ['preview']],
    ['apply', (c, caller) => c.rules.apply({ testRunId: 'r', scope: 'baseline' } as never, caller), ['apply']],
    ['suggestions', (c, caller) => c.testRuns.suggestions('run-001', caller), ['suggestions']],
    ['status', (c, caller) => c.testRuns.status('run-001', caller), ['status']],
  ];

  it.each(calls)('%s passes the caller\'s accessible organizations to the service', async (name, invoke) => {
    const c = make();

    await invoke(c, ctx());

    const lastArg = (c.insights as Record<string, jest.Mock>)[name]!.mock.calls[0]!.at(-1);
    expect(lastArg).toEqual(['org-a']);
    expect(c.authz.getAccessibleOrganizations).toHaveBeenCalledWith('user-1');
  });

  it.each(calls)('%s passes null for a global admin', async (name, invoke) => {
    const c = make();
    c.authz.isGlobalAdmin.mockReturnValue(true);

    await invoke(c, ctx(['super-admin']));

    expect((c.insights as Record<string, jest.Mock>)[name]!.mock.calls[0]!.at(-1)).toBeNull();
  });

  it.each(calls)('%s passes an empty list, not null, for a user with no memberships', async (name, invoke) => {
    const c = make();
    c.authz.getAccessibleOrganizations.mockResolvedValue([]);

    await invoke(c, ctx());

    expect((c.insights as Record<string, jest.Mock>)[name]!.mock.calls[0]!.at(-1)).toEqual([]);
  });

  it('the by-run routes hand the raw :id through for the service to resolve', async () => {
    const c = make();

    await c.testRuns.suggestions('run-001', ctx());
    await c.testRuns.status('run-002', ctx());

    expect(c.insights.suggestions).toHaveBeenCalledWith('run-001', ['org-a']);
    expect(c.insights.status).toHaveBeenCalledWith('run-002', ['org-a']);
  });
});
