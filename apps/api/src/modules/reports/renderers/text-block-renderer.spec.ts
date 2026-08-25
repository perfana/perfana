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

  it('renders the section title as a heading, like every other section', () => {
    const html = renderer.renderTextBlockSection(
      section({ title: 'Executive summary', config: { content: 'Body copy' } }),
    );
    expect(html).toContain('<h2');
    expect(html).toContain('Executive summary');
  });

  it('renders bare prose when the block has no title', () => {
    const html = renderer.renderTextBlockSection(section({ config: { content: 'Body copy' } }));
    expect(html).not.toContain('<h2');
  });

  it('treats a whitespace-only title as no title', () => {
    const html = renderer.renderTextBlockSection(
      section({ title: '   ', config: { content: 'Body copy' } }),
    );
    expect(html).not.toContain('<h2');
  });

  it('escapes the title rather than interpolating it', () => {
    const html = renderer.renderTextBlockSection(
      section({ title: '<img src=x onerror=alert(1)>', config: { content: 'Body copy' } }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders nothing when a titled block has no content', () => {
    expect(renderer.renderTextBlockSection(section({ title: 'Heading only', config: {} }))).toBe('');
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

  it('should render text content with default left alignment', () => {
    const html = renderer.renderTextBlockSection(section({ config: { content: 'Hello world' } }));

    expect(html).toContain('Hello world');
    expect(html).toContain('text-align: left');
    expect(html).toContain('class="text-block"');
  });

  it('should render with custom alignment', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: 'Centered text', alignment: 'center' } }),
    );

    expect(html).toContain('text-align: center');
  });

  it('should escape HTML in content', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: '<script>alert("xss")</script>' } }),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render nothing when there is no content', () => {
    // An empty section would otherwise print as a bare bordered card in the PDF.
    expect(renderer.renderTextBlockSection(section({}))).toBe('');
  });

  it('should render markdown structure into the report HTML', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: '## Summary\n\n- p95 rose\n- errors flat' } }),
    );

    expect(html).toContain('<h2 ');
    expect(html).toContain('Summary');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>p95 rose</li>');
    expect(html).toContain('<li>errors flat</li>');
    // The raw markers must not survive into the PDF.
    expect(html).not.toContain('## Summary');
  });

  it('should render inline markdown emphasis and safe links, dropping unsafe hrefs', () => {
    const html = renderer.renderTextBlockSection(
      section({
        config: {
          content: 'The **p95** rose, see [docs](https://perfana.io) not [x](javascript:alert(1))',
        },
      }),
    );

    expect(html).toContain('<strong>p95</strong>');
    expect(html).toContain('<a href="https://perfana.io">docs</a>');
    expect(html).not.toContain('javascript:alert(1)"');
    expect(html).not.toContain('<a href="javascript');
  });

  it('should render nothing when the content is only whitespace', () => {
    expect(renderer.renderTextBlockSection(section({ config: { content: '   \n\n  ' } }))).toBe('');
  });

  it('should treat the content as plain text when markdown is disabled', () => {
    // The escape hatch for blocks authored before markdown rendering existed,
    // where a leading dash was meant literally.
    const html = renderer.renderTextBlockSection(
      section({ config: { content: '- not a list\n**not bold**', markdown: false } }),
    );

    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('- not a list');
    expect(html).toContain('**not bold**');
    expect(html).toContain('pre-wrap');
  });

  it('should still escape HTML when markdown is disabled', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: '<script>alert("xss")</script>', markdown: false } }),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render markdown when the flag is absent, matching the form default', () => {
    expect(
      renderer.renderTextBlockSection(section({ config: { content: '- a list item' } })),
    ).toContain('<li>a list item</li>');
  });

  it('should not let a crafted alignment break out of the style attribute', () => {
    // config is only validated as @IsObject(), and this HTML is served
    // unauthenticated via report share links and rendered by Puppeteer.
    const html = renderer.renderTextBlockSection(
      section({
        config: {
          content: 'Body',
          alignment: 'left"><img src=x onerror=alert(1)>',
        },
      }),
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('text-align: left;');
  });

  it('should fall back to left for an unrecognised alignment', () => {
    expect(
      renderer.renderTextBlockSection(section({ config: { content: 'Body', alignment: 'diagonal' } })),
    ).toContain('text-align: left;');
  });

  it('should accept every alignment the form offers', () => {
    for (const alignment of ['left', 'center', 'right', 'justify']) {
      const html = renderer.renderTextBlockSection(section({ config: { content: 'Body', alignment } }));
      expect(html).toContain(`text-align: ${alignment};`);
    }
  });
});
