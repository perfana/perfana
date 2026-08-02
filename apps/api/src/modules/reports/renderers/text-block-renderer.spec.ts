import { TextBlockRenderer } from './text-block-renderer';
import type { ReportSectionConfig } from '@perfana/shared';

describe('TextBlockRenderer', () => {
  const renderer = new TextBlockRenderer();

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig => ({
    type: 'text_block',
    order: 0,
    ...over,
  });

  it('renders the content as markdown', () => {
    const html = renderer.renderTextBlockSection(section({ config: { content: 'The **p95** rose' } }));
    expect(html).toContain('<strong>p95</strong>');
  });

  it('ignores a legacy comment — a text block has no accompanying text', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: 'Body copy' }, comment: 'legacy annotation' }),
    );
    expect(html).toContain('Body copy');
    expect(html).not.toContain('legacy annotation');
  });

  it('renders nothing when the content is empty, even with a legacy comment', () => {
    expect(
      renderer.renderTextBlockSection(section({ config: { content: '  ' }, comment: 'legacy' })),
    ).toBe('');
  });

  it('rejects an unknown alignment rather than interpolating it', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: 'x', alignment: 'left"><script>alert(1)</script>' } }),
    );
    expect(html).toContain('text-align: left;');
    expect(html).not.toContain('<script>');
  });
});
