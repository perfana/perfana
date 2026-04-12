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

  it('should handle missing config gracefully', () => {
    const section: ReportSectionConfig = {
      type: 'text_block',
      order: 0,
    };

    const html = renderer.renderTextBlockSection(section);

    expect(html).toContain('text-align: left');
    expect(html).toContain('class="text-block"');
  });
});
