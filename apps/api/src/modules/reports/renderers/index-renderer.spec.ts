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
});
