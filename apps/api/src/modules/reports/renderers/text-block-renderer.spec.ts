import { Test, TestingModule } from '@nestjs/testing';
import { TextBlockRenderer } from './text-block-renderer';
import { ReportSectionConfig } from '@perfana/shared';

describe('TextBlockRenderer', () => {
  let renderer: TextBlockRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TextBlockRenderer],
    }).compile();

    renderer = module.get(TextBlockRenderer);
  });

  it('should render text content with default left alignment', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: 'Hello world' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('Hello world');
    expect(html).toContain('text-align: left');
    expect(html).toContain('class="text-block"');
  });

  it('should render with custom alignment', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: 'Centered text', alignment: 'center' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('text-align: center');
  });

  it('should escape HTML in content', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: '<script>alert("xss")</script>' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render the section comment above the content', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      comment: 'Author note for readers',
      config: { content: 'Body text' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('section-comment');
    expect(html).toContain('Author note for readers');
    expect(html).toContain('Body text');
    expect(html.indexOf('Author note for readers')).toBeLessThan(html.indexOf('Body text'));
  });

  it('should omit the comment block entirely when no comment is set', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: 'Body text' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).not.toContain('section-comment');
  });

  it('should escape HTML in the comment', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      comment: '<script>alert(1)</script>',
      config: { content: 'Body' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render nothing when there is no content and no comment', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
    };

    // An empty section would otherwise print as a bare bordered card in the PDF.
    expect(renderer.renderTextBlockSection(section)).toBe('');
  });

  it('should still render when only a comment is present', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      comment: 'Reviewed by the perf team',
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('text-align: left');
    expect(html).toContain('class="text-block"');
    expect(html).toContain('Reviewed by the perf team');
  });

  it('should render markdown structure into the report HTML', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: '## Summary\n\n- p95 rose\n- errors flat' },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('<h2 ');
    expect(html).toContain('Summary');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>p95 rose</li>');
    expect(html).toContain('<li>errors flat</li>');
    // The raw markers must not survive into the PDF.
    expect(html).not.toContain('## Summary');
  });

  it('should render inline markdown emphasis and safe links, dropping unsafe hrefs', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: {
        content: 'The **p95** rose, see [docs](https://perfana.io) not [x](javascript:alert(1))',
      },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('<strong>p95</strong>');
    expect(html).toContain('<a href="https://perfana.io">docs</a>');
    expect(html).not.toContain('javascript:alert(1)"');
    expect(html).not.toContain('<a href="javascript');
  });

  it('should render nothing when the content is only whitespace and there is no comment', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: '   \n\n  ' },
    };

    expect(renderer.renderTextBlockSection(section)).toBe('');
  });

  it('should treat the content as plain text when markdown is disabled', () => {
    // The escape hatch for blocks authored before markdown rendering existed,
    // where a leading dash was meant literally.
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: '- not a list\n**not bold**', markdown: false },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('- not a list');
    expect(html).toContain('**not bold**');
    expect(html).toContain('pre-wrap');
  });

  it('should still escape HTML when markdown is disabled', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: '<script>alert("xss")</script>', markdown: false },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render markdown when the flag is absent, matching the form default', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: '- a list item' },
    };

    expect(renderer.renderTextBlockSection(section)).toContain('<li>a list item</li>');
  });

  it('should not let a crafted alignment break out of the style attribute', () => {
    // config is only validated as @IsObject(), and this HTML is served
    // unauthenticated via report share links and rendered by Puppeteer.
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: {
        content: 'Body',
        alignment: 'left"><img src=x onerror=alert(1)>',
      },
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toContain('text-align: left;');
  });

  it('should fall back to left for an unrecognised alignment', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
      config: { content: 'Body', alignment: 'diagonal' },
    };

    expect(renderer.renderTextBlockSection(section)).toContain('text-align: left;');
  });

  it('should accept every alignment the form offers', () => {
    for (const alignment of ['left', 'center', 'right', 'justify']) {
      const section: ReportSectionConfig = {
        type: 'text_block',
        order: 0,
        config: { content: 'Body', alignment },
      };

      expect(renderer.renderTextBlockSection(section)).toContain(`text-align: ${alignment};`);
    }
  });
});
