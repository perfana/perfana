import { ReportGenerationValidatorService } from './report-generation-validator.service';

describe('ReportGenerationValidatorService anchor checks', () => {
  let service: ReportGenerationValidatorService;

  beforeEach(() => {
    service = new ReportGenerationValidatorService();
  });

  describe('findDeadAnchors', () => {
    it('finds a link whose target was never emitted', () => {
      const html = `
        <a id="slo-results" class="section-anchor"></a>
        <p><a href="#trends">see trends</a></p>
      `;
      expect(service.findDeadAnchors(html)).toEqual(['trends']);
    });

    it('finds nothing when every target exists', () => {
      const html = `
        <a id="trends" class="section-anchor"></a>
        <p><a href="#trends">see trends</a></p>
      `;
      expect(service.findDeadAnchors(html)).toEqual([]);
    });

    it('reports a repeated dead target once', () => {
      const html = `<a href="#gone">a</a><a href="#gone">b</a>`;
      expect(service.findDeadAnchors(html)).toEqual(['gone']);
    });

    it('ignores non-anchor hrefs', () => {
      const html = `<a href="https://example.com/#frag">x</a>`;
      expect(service.findDeadAnchors(html)).toEqual([]);
    });
  });

  describe('warnOnAnchorProblems', () => {
    const duplicateGraphs = [
      { title: 'Graphs', type: 'graphs' },
      { title: 'Graphs', type: 'graphs' },
    ];

    it('never throws, whatever it finds', () => {
      expect(() =>
        service.warnOnAnchorProblems('<a href="#gone">x</a>', duplicateGraphs),
      ).not.toThrow();
    });

    it('logs a dead anchor and a slug collision', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems('<a href="#gone">x</a>', duplicateGraphs);

      const messages = warn.mock.calls.map(c => String(c[0])).join(' | ');
      expect(messages).toContain('gone');
      expect(messages).toContain('graphs');
      warn.mockRestore();
    });

    it('logs a titleless-section warning, distinct from the slug-collision one', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems('', [
        { title: '图表一', type: 'graphs' },
        { title: '图表二', type: 'graphs' },
      ]);

      const messages = warn.mock.calls.map(c => String(c[0])).join(' | ');
      expect(messages).toContain('cannot produce an anchor');
      expect(messages).not.toContain('Give them distinct titles');
      warn.mockRestore();
    });

    it('logs nothing when the report is clean', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems(
        '<a id="trends"></a><a href="#trends">x</a>',
        [
          { title: 'Trends', type: 'trends' },
          { title: 'Graphs', type: 'graphs' },
        ],
      );

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not let a logging failure fail report generation', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {
          throw new Error('log transport is down');
        });

      // Must actually reach `warn` (dead anchor present), or this proves nothing.
      expect(() =>
        service.warnOnAnchorProblems('<a href="#gone">x</a>', duplicateGraphs),
      ).not.toThrow();

      warn.mockRestore();
    });
  });
});
