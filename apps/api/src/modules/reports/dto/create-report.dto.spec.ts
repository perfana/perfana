import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { GenerateAdHocReportDto, GenerateReportFromTemplateDto } from './create-report.dto';

/**
 * The two entry points a CI/CD pipeline posts to. Both must accept the id a pipeline actually
 * has — the one it handed the load test tool — because the internal uuid is invented by Perfana
 * after the fact and no pipeline ever sees it.
 *
 * `/generate/ad-hoc` used to declare @IsUUID on test_run_id, so the human id was rejected by the
 * validation pipe before the service (which resolves either form) was reached: the same id
 * worked on one endpoint and 400'd on the other.
 */
const errorsFor = async (dto: object, property: string) =>
  (await validate(dto)).filter((e) => e.property === property);

const adHoc = (test_run_id: unknown) =>
  plainToClass(GenerateAdHocReportDto, {
    test_run_id,
    name: 'Release 4.2 sign-off',
    sections: [{ type: 'header', order: 0, title: 'Performance Analysis' }],
  });

describe('GenerateAdHocReportDto test_run_id', () => {
  it('accepts the human test run id a pipeline has', async () => {
    expect(await errorsFor(adHoc('EA-acc-loadtest-00020'), 'test_run_id')).toHaveLength(0);
  });

  it('still accepts the internal uuid the UI links with', async () => {
    expect(
      await errorsFor(adHoc('123e4567-e89b-12d3-a456-426614174000'), 'test_run_id'),
    ).toHaveLength(0);
  });

  it('rejects an empty id rather than letting it reach the lookup', async () => {
    const errors = await errorsFor(adHoc(''), 'test_run_id');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isLength');
  });

  it('rejects an id longer than the column', async () => {
    const errors = await errorsFor(adHoc('x'.repeat(256)), 'test_run_id');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isLength');
  });

  it('accepts an id of exactly the maximum length', async () => {
    expect(await errorsFor(adHoc('x'.repeat(255)), 'test_run_id')).toHaveLength(0);
  });

  it('rejects a non-string, which no longer has a uuid check to catch it', async () => {
    const errors = await errorsFor(adHoc(42), 'test_run_id');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isString');
  });

  it('rejects a missing id', async () => {
    const dto = plainToClass(GenerateAdHocReportDto, {
      name: 'Release 4.2 sign-off',
      sections: [{ type: 'header', order: 0 }],
    });
    expect((await errorsFor(dto, 'test_run_id')).length).toBeGreaterThan(0);
  });
});

describe('GenerateReportFromTemplateDto test_run_id', () => {
  it('takes the same two forms, so neither endpoint is stricter than the other', async () => {
    for (const id of ['EA-acc-loadtest-00020', '123e4567-e89b-12d3-a456-426614174000']) {
      const dto = plainToClass(GenerateReportFromTemplateDto, { test_run_id: id });
      expect(await errorsFor(dto, 'test_run_id')).toHaveLength(0);
    }
  });

  it('needs neither template_id nor template_name — a pipeline may post the run alone', async () => {
    // The default template is used when neither is given; requiring one would mean every
    // pipeline had to learn a uuid it has no way to read.
    const dto = plainToClass(GenerateReportFromTemplateDto, {
      test_run_id: 'EA-acc-loadtest-00020',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
