import { EntityManager } from 'typeorm';
import { SutImportService } from './sut-import.service';

/**
 * generated_reports.template_id is nullable since migration 1821. A NULL refers to nothing, so a
 * report whose template was deleted is not the orphan this filter exists to drop.
 */
describe('SutImportService.dropRowsMissingParent', () => {
  const run = (rows: Record<string, unknown>[], presentIds: string[]) => {
    const service = Object.create(SutImportService.prototype) as {
      logger: { warn: jest.Mock };
      dropRowsMissingParent: (...args: unknown[]) => Promise<Record<string, unknown>[]>;
    };
    service.logger = { warn: jest.fn() };
    const manager = {
      query: jest.fn().mockResolvedValue(presentIds.map((id) => ({ id }))),
    } as unknown as EntityManager;
    return service
      .dropRowsMissingParent(manager, 'generated_reports', rows, 'template_id', 'report_templates')
      .then((kept) => ({ kept, warn: service.logger.warn }));
  };

  it('keeps a report with no template alongside one whose template is present', async () => {
    const { kept, warn } = await run(
      [{ id: 'kept-template', template_id: 'tpl-1' }, { id: 'no-template', template_id: null }],
      ['tpl-1'],
    );

    expect(kept.map((r) => r.id)).toEqual(['kept-template', 'no-template']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still drops a report whose template is missing from the target', async () => {
    const { kept, warn } = await run(
      [{ id: 'orphan', template_id: 'tpl-gone' }, { id: 'no-template', template_id: null }],
      [],
    );

    expect(kept.map((r) => r.id)).toEqual(['no-template']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
