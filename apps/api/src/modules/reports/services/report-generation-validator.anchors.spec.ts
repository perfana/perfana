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
    it('never throws, whatever it finds', () => {
      expect(() =>
        service.warnOnAnchorProblems('<a href="#gone">x</a>', ['Graphs', 'Graphs']),
      ).not.toThrow();
    });

    it('logs a dead anchor and a duplicate title', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems('<a href="#gone">x</a>', ['Graphs', 'Graphs']);

      const messages = warn.mock.calls.map(c => String(c[0])).join(' | ');
      expect(messages).toContain('gone');
      expect(messages).toContain('Graphs');
      warn.mockRestore();
    });

    it('logs nothing when the report is clean', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems(
        '<a id="trends"></a><a href="#trends">x</a>',
        ['Trends', 'Graphs'],
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
        service.warnOnAnchorProblems('<a href="#gone">x</a>', ['Graphs', 'Graphs']),
      ).not.toThrow();

      warn.mockRestore();
    });
  });
});
