/**
 * Unit tests for ReportUtilsService.getSectionTitle
 *
 * Pins the value for every ReportSectionType so that a change to either
 * `SECTION_RENDER_TITLES` (packages/shared/src/types/reports.types.ts) or
 * this service's read of it is caught immediately. The expected strings are
 * literals here, not imports of the map under test, so the test fails if
 * either copy drifts.
 */

import { ReportUtilsService } from './report-utils.service';
import { ReportSectionType } from '@perfana/shared';

describe('ReportUtilsService.getSectionTitle', () => {
  let service: ReportUtilsService;

  beforeEach(() => {
    service = new ReportUtilsService();
  });

  const expectedTitles: Record<ReportSectionType, string> = {
    header: 'Report Header',
    text_block: 'Text',
    slo: 'SLO Results',
    apdex: 'Apdex Report',
    transaction_response_times: 'Transaction Response Times',
    regressions: 'Anomaly Detection',
    awr: 'AWR Analysis',
    trends: 'Trends',
    comparisons: 'Comparisons',
    graphs: 'Custom Graphs',
    top_10_lists: 'Top 10 Lists',
    error_analysis: 'Error Analysis',
    index: 'Index',
  };

  it.each(Object.entries(expectedTitles) as [ReportSectionType, string][])(
    'returns %s for section type %s',
    (type, expected) => {
      expect(service.getSectionTitle(type)).toBe(expected);
    },
  );

  it('covers every ReportSectionType', () => {
    expect(Object.keys(expectedTitles).sort()).toEqual(
      [
        'header',
        'text_block',
        'slo',
        'apdex',
        'transaction_response_times',
        'regressions',
        'awr',
        'trends',
        'comparisons',
        'graphs',
        'top_10_lists',
        'error_analysis',
        'index',
      ].sort(),
    );
  });
});
