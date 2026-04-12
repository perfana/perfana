/**
 * Tests for stub renderers that currently output placeholder content.
 * Covers: AwrRenderer, TrendsRenderer, ComparisonsRenderer, GraphsRenderer
 *
 * All follow the same pattern: title + optional comment + placeholder message.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ReportUtilsService } from '../services/report-utils.service';
import { AwrRenderer } from './awr-renderer';
import { TrendsRenderer } from './trends-renderer';
import { ComparisonsRenderer } from './comparisons-renderer';
import { GraphsRenderer } from './graphs-renderer';
import type { ReportSectionConfig, TestRun } from '@perfana/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSection = (
  type: ReportSectionConfig['type'],
  overrides?: Partial<ReportSectionConfig>,
): ReportSectionConfig => ({ type, order: 0, ...overrides });

const nullTestRun = null as TestRun | null;

// ---------------------------------------------------------------------------
// Shared test factory
// ---------------------------------------------------------------------------

interface RendererCase {
  name: string;
  rendererClass: any;
  methodName: string;
  sectionType: ReportSectionConfig['type'];
  defaultTitle: string;
  cssClass: string;
}

const rendererCases: RendererCase[] = [
  {
    name: 'AwrRenderer',
    rendererClass: AwrRenderer,
    methodName: 'renderAwrSection',
    sectionType: 'awr',
    defaultTitle: 'AWR Analysis',
    cssClass: 'awr-section',
  },
  {
    name: 'TrendsRenderer',
    rendererClass: TrendsRenderer,
    methodName: 'renderTrendsSection',
    sectionType: 'trends',
    defaultTitle: 'Trends',
    cssClass: 'trends-section',
  },
  {
    name: 'ComparisonsRenderer',
    rendererClass: ComparisonsRenderer,
    methodName: 'renderComparisonsSection',
    sectionType: 'comparisons',
    defaultTitle: 'Comparisons',
    cssClass: 'comparisons-section',
  },
  {
    name: 'GraphsRenderer',
    rendererClass: GraphsRenderer,
    methodName: 'renderGraphsSection',
    sectionType: 'graphs',
    defaultTitle: 'Custom Graphs',
    cssClass: 'graphs-section',
  },
];

describe.each(rendererCases)(
  '$name',
  ({ rendererClass, methodName, sectionType, defaultTitle, cssClass }) => {
    let renderer: any;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [rendererClass, ReportUtilsService],
      }).compile();

      renderer = module.get(rendererClass);
    });

    it('should render with default title', () => {
      const section = makeSection(sectionType);
      const html = renderer[methodName](section, nullTestRun);

      expect(html).toContain(defaultTitle);
      expect(html).toContain(`class="${cssClass}"`);
      expect(html).toContain('placeholder-message');
    });

    it('should render with custom title', () => {
      const section = makeSection(sectionType, { title: 'Custom Title' });
      const html = renderer[methodName](section, nullTestRun);

      expect(html).toContain('Custom Title');
    });

    it('should render comment when provided', () => {
      const section = makeSection(sectionType, { comment: 'Stakeholder note' });
      const html = renderer[methodName](section, nullTestRun);

      expect(html).toContain('Stakeholder note');
      expect(html).toContain('section-comment');
    });

    it('should not render comment div when comment is missing', () => {
      const section = makeSection(sectionType);
      const html = renderer[methodName](section, nullTestRun);

      expect(html).not.toContain('section-comment');
    });

    it('should escape HTML in title', () => {
      const section = makeSection(sectionType, { title: '<img src=x>' });
      const html = renderer[methodName](section, nullTestRun);

      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('&lt;img src=x&gt;');
    });

    it('should escape HTML in comment', () => {
      const section = makeSection(sectionType, { comment: '<script>alert(1)</script>' });
      const html = renderer[methodName](section, nullTestRun);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  },
);
