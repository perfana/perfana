import { IndexRenderer } from './index-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportSectionConfig } from '@perfana/shared';

describe('IndexRenderer', () => {
  const renderer = new IndexRenderer(new ReportUtilsService());
  const section = { type: 'index', order: 0 } as ReportSectionConfig;

  it('renders one linked entry per section, in order', () => {
    const html = renderer.renderIndexSection(section, [
      { title: 'SLO Results', anchor: 'slo-results' },
      { title: 'Trends', anchor: 'trends' },
    ]);
    expect(html).toContain('href="#slo-results"');
    expect(html).toContain('SLO Results');
    expect(html).toContain('href="#trends"');
    expect(html.indexOf('#slo-results')).toBeLessThan(html.indexOf('#trends'));
  });

  it('renders nothing when there are no entries', () => {
    expect(renderer.renderIndexSection(section, [])).toBe('');
  });

  it('escapes a title that contains markup', () => {
    const html = renderer.renderIndexSection(section, [
      { title: '<img src=x onerror=alert(1)>', anchor: 'img' },
    ]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes an anchor that contains markup', () => {
    const html = renderer.renderIndexSection(section, [
      { title: 'Trends', anchor: '"><script>alert(1)</script>' },
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('href="#&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it('uses the section title override for its own heading', () => {
    const html = renderer.renderIndexSection(
      { type: 'index', order: 0, title: 'Contents' } as ReportSectionConfig,
      [{ title: 'Trends', anchor: 'trends' }],
    );
    expect(html).toContain('Contents');
  });

  it('falls back to the default heading when not overridden', () => {
    const html = renderer.renderIndexSection(section, [
      { title: 'Trends', anchor: 'trends' },
    ]);
    expect(html).toContain('Index');
  });

  describe('accompanying text (SECTION_TYPES_WITH_TEXT includes index)', () => {
    it('renders the section text alongside its entries, like every other renderer', () => {
      const withText = { type: 'index', order: 0, text: 'Jump to any section below.' } as ReportSectionConfig;
      const html = renderer.renderIndexSection(withText, [
        { title: 'Trends', anchor: 'trends' },
      ]);
      expect(html).toContain('Jump to any section below.');
      expect(html).toContain('href="#trends"');
    });

    it('renders the text alone when there are no entries, instead of dropping it', () => {
      // Decision: prose the author wrote must not silently vanish just because the
      // index has nothing to link to yet (e.g. it was added before any linkable
      // section exists). Only "no entries AND no text" renders nothing at all.
      const withText = { type: 'index', order: 0, text: 'More sections coming soon.' } as ReportSectionConfig;
      const html = renderer.renderIndexSection(withText, []);
      expect(html).not.toBe('');
      expect(html).toContain('More sections coming soon.');
      expect(html).not.toContain('<ol');
    });

    it('still renders nothing when there is neither text nor entries', () => {
      const blank = { type: 'index', order: 0, text: '   ' } as ReportSectionConfig;
      expect(renderer.renderIndexSection(blank, [])).toBe('');
    });

    it('reads the legacy `comment` field the same way every other renderer does', () => {
      // getSectionText falls back to the deprecated `comment` key for
      // pre-2026-08-02 templates; the index renderer must go through the same
      // helper as its siblings rather than reading section.text directly.
      const legacy = { type: 'index', order: 0, comment: 'Legacy comment text' } as ReportSectionConfig;
      const html = renderer.renderIndexSection(legacy, []);
      expect(html).toContain('Legacy comment text');
    });
  });
});
