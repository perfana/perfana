import { Test, TestingModule } from '@nestjs/testing';
import { PlaceholderRenderer } from './placeholder-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportSectionConfig } from '@perfana/shared';

describe('PlaceholderRenderer', () => {
  let renderer: PlaceholderRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlaceholderRenderer, ReportUtilsService],
    }).compile();

    renderer = module.get(PlaceholderRenderer);
  });

  describe('renderPlaceholderSection', () => {
    it('should render placeholder with title and type', () => {
      const html = renderer.renderPlaceholderSection('My Section', 'custom_widget');

      expect(html).toContain('My Section');
      expect(html).toContain("custom_widget");
      expect(html).toContain('not yet implemented');
      expect(html).toContain('class="placeholder-section"');
    });

    it('should escape HTML in title and type', () => {
      const html = renderer.renderPlaceholderSection('<b>Title</b>', '<script>');

      expect(html).not.toContain('<b>Title</b>');
      expect(html).toContain('&lt;b&gt;Title&lt;/b&gt;');
      expect(html).not.toContain('<script>');
    });
  });

  describe('renderErrorSection', () => {
    it('should render error message with section title', () => {
      const section: ReportSectionConfig = {
        type: 'slo',
        order: 0,
        title: 'SLO Results',
      };

      const html = renderer.renderErrorSection(section, 'Connection timeout');

      expect(html).toContain('SLO Results');
      expect(html).toContain('Connection timeout');
      expect(html).toContain('class="error-section"');
      expect(html).toContain('Failed to render section');
    });

    it('should fall back to section type when title is missing', () => {
      const section: ReportSectionConfig = {
        type: 'graphs',
        order: 0,
      };

      const html = renderer.renderErrorSection(section, 'Data unavailable');

      expect(html).toContain('graphs');
      expect(html).toContain('Data unavailable');
    });

    it('should escape HTML in error messages', () => {
      const section: ReportSectionConfig = {
        type: 'slo',
        order: 0,
        title: 'Test',
      };

      const html = renderer.renderErrorSection(section, '<img onerror="alert(1)">');

      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });
  });
});
