import { ReportTemplateService } from './report-template.service';
import type { ReportSectionConfig } from '@perfana/shared';

describe('ReportTemplateService.validateSections', () => {
  // validateSections reads no injected dependency, so stubs are enough.
  const service = new ReportTemplateService({} as never, {} as never, {} as never);
  const validate = (sections: ReportSectionConfig[]) =>
    (service as unknown as { validateSections(s: ReportSectionConfig[]): void }).validateSections(sections);

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig => ({
    type: 'slo',
    order: 0,
    ...over,
  });

  it('accepts text on a header section', () => {
    expect(() => validate([section({ type: 'header', text: 'intro' })])).not.toThrow();
  });

  it('accepts a top_10_lists section', () => {
    expect(() => validate([section({ type: 'top_10_lists' })])).not.toThrow();
  });

  it('rejects text on a text_block section', () => {
    expect(() => validate([section({ type: 'text_block', text: 'nope' })])).toThrow(
      /not allowed on 'text_block'/,
    );
  });

  it('rejects a legacy comment on a text_block section', () => {
    expect(() => validate([section({ type: 'text_block', comment: 'nope' })])).toThrow(
      /not allowed on 'text_block'/,
    );
  });

  it('still rejects an unknown section type', () => {
    expect(() => validate([section({ type: 'nonsense' as never })])).toThrow(/Invalid section type/);
  });

  it('still rejects duplicate orders', () => {
    expect(() => validate([section({ order: 0 }), section({ order: 0 })])).toThrow(
      /Duplicate section order/,
    );
  });
});
