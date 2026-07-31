import { Test, TestingModule } from '@nestjs/testing';
import { TextBlockRenderer } from './text-block-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportSectionConfig } from '@perfana/shared';

describe('TextBlockRenderer', () => {
  let renderer: TextBlockRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TextBlockRenderer, ReportUtilsService],
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
});
