import { UpdateTestRunHandler } from './update-test-run.handler';
import { UpdateTestRunCommand } from '../commands/update-test-run.command';

/**
 * TODOS.md P2, "A completion call that omits tags wipes the run's tags".
 * Value: protects=an update that leaves `tags` out keeps the stored tags, and so keeps the profile
 *   ADAPT templates those tags chose (since v0.2.97.57 the completing run's tags pick them);
 * fails_when=the payload writes `data.tags || []` again; why_new=no spec covered this handler;
 * seam=handler over a mocked repository (withRequestEm hands it back unchanged outside a request).
 */
describe('UpdateTestRunHandler tags', () => {
  const before = {
    id: 'uuid-1', testRunId: 'run-1', systemUnderTestId: 'sut', testEnvironment: 'acc', workload: 'load',
    tags: ['jvm', 'nightly'], completed: false, abort: false, systemUnderTest: { name: 'app' },
    startTime: new Date(), endTime: new Date(), createdAt: new Date(), updatedAt: new Date(),
  };
  const build = () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(before),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const handler = new UpdateTestRunHandler(
      repo as never,
      { emitTestRunUpdated: jest.fn(), emitTestRunEvent: jest.fn() } as never,
      { logUpdate: jest.fn() } as never,
    );
    return { repo, handler };
  };
  const command = (tags: string[] | undefined) =>
    UpdateTestRunCommand.fromParams({
      testRunId: 'run-1', systemUnderTestId: 'sut', testEnvironment: 'acc', workload: 'load', completed: true, tags,
    } as never);

  it('keeps the stored tags when the update omits them', async () => {
    const { repo, handler } = build();
    await handler.execute(command(undefined), undefined);
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['jvm', 'nightly'] }));
  });

  it('replaces them when the update names tags, and clears them on an explicit empty list', async () => {
    const { repo, handler } = build();
    await handler.execute(command(['dotnet']), undefined);
    expect(repo.update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tags: ['dotnet'] }));
    await handler.execute(command([]), undefined);
    expect(repo.update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tags: [] }));
  });
});
