import { SeriesGroupingController } from './series-grouping.controller';

jest.mock('../../common/utils/with-org-filter', () => ({ withOrgFilter: jest.fn() }));
import { withOrgFilter } from '../../common/utils/with-org-filter';

/**
 * Every route resolves the caller's organizations ONCE and hands them to the service: the
 * service treats that argument as the tenant boundary, so a route that forgot it would silently
 * read across tenants (root CLAUDE.md #48).
 */
describe('SeriesGroupingController', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as never;
  const authz = {} as never;
  let service: Record<string, jest.Mock>;
  let controller: SeriesGroupingController;

  beforeEach(() => {
    (withOrgFilter as jest.Mock).mockReset().mockResolvedValue(['org-1']);
    service = {
      findAll: jest.fn(async () => []),
      findOne: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => undefined),
    };
    controller = new SeriesGroupingController(service as never, authz);
  });

  it('findAll passes the query and the resolved scope', async () => {
    await controller.findAll('sut-1', ctx, 'acc', 'peak', 'dash-1');
    expect(withOrgFilter).toHaveBeenCalledWith('user-1', ['user'], authz);
    expect(service.findAll).toHaveBeenCalledWith(
      { systemId: 'sut-1', environment: 'acc', workload: 'peak', applicationDashboardId: 'dash-1' },
      ['org-1'],
    );
  });

  it('passes null (global admin) through unchanged', async () => {
    (withOrgFilter as jest.Mock).mockResolvedValue(null);
    await controller.findOne('rule-1', ctx);
    expect(service.findOne).toHaveBeenCalledWith('rule-1', null);
  });

  it.each([
    ['create', (c: SeriesGroupingController) => c.create({} as never, ctx), (s: Record<string, jest.Mock>) => s.create, [{}, 'user-1', ['user'], ['org-1']]],
    ['update', (c: SeriesGroupingController) => c.update('rule-1', {} as never, ctx), (s: Record<string, jest.Mock>) => s.update, ['rule-1', {}, 'user-1', ['user'], ['org-1']]],
    ['remove', (c: SeriesGroupingController) => c.remove('rule-1', ctx), (s: Record<string, jest.Mock>) => s.remove, ['rule-1', 'user-1', ['user'], ['org-1']]],
  ])('%s passes the resolved scope', async (_name, call, method, args) => {
    await call(controller);
    expect(method(service)).toHaveBeenCalledWith(...args);
    expect(withOrgFilter).toHaveBeenCalledTimes(1);
  });
});
