import { htmlToStorage, chartFilename } from './storage-format';
import { deltaChip, pill } from '../reports/renderers/report-style';
import { chartSeriesTable } from '../reports/renderers/chart-tokens';

const page = (body: string) => `<!DOCTYPE html><html><head><style>.x{}</style><script>alert(1)</script></head><body>${body}</body></html>`;

describe('htmlToStorage', () => {
  it('keeps structure and drops scripts, styles, form controls and leftover SVG icons', () => {
    const { storage } = htmlToStorage(page(
      '<h2>SLOs</h2><p>All <b>good</b> &amp; <i>fine</i></p><script>x()</script><input placeholder="Filter rows..."><svg width="12"><path/></svg>',
    ));
    expect(storage).toBe('<h2>SLOs</h2><p>All <strong>good</strong> &amp; <em>fine</em></p>');
  });

  it('escapes text so the output stays well-formed XHTML', () => {
    expect(htmlToStorage(page('<p>p95 &lt; 200 ms &amp;&amp; err &gt; 1%</p>')).storage).toBe('<p>p95 &lt; 200 ms &amp;&amp; err &gt; 1%</p>');
  });

  // Value: protects=control characters a log line carries (ANSI colour codes) never reach the XML 1.0 storage body,
  // which Confluence rejects whole; fails_when=escapeText stops stripping C0 controls or leaves a CSI sequence's
  // tail behind; why_new=no case fed a control character; seam=none; no_claim=Confluence's own parser (string check).
  it('strips control characters and ANSI colour sequences, keeping tab and newline', () => {
    const { storage } = htmlToStorage(page('<pre>\x1b[31mERROR\x1b[0m boom\x07\tat x\nnext</pre><p>a\x00b\x1fc</p>'));
    expect(storage).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/); // eslint-disable-line no-control-regex
    expect(storage).toContain('ERROR boom\tat x\nnext');
    expect(storage).toContain('<p>abc</p>');
  });

  it('turns tables into plain tables, keeping only colspan/rowspan', () => {
    const { storage } = htmlToStorage(page(
      '<table class="t" style="width:100%"><thead><tr><th style="x" colspan="2" onclick="y">Name</th></tr></thead><tbody><tr><td rowspan="3">a</td><td>b</td></tr></tbody></table>',
    ));
    expect(storage).toBe('<table><thead><tr><th colspan="2">Name</th></tr></thead><tbody><tr><td rowspan="3">a</td><td>b</td></tr></tbody></table>');
  });

  it('turns <details> into an expand macro titled by its summary', () => {
    const { storage } = htmlToStorage(page('<details open><summary><h3>Group A</h3><span>3 rows</span></summary><p>body</p></details>'));
    expect(storage).toBe(
      '<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Group A · 3 rows</ac:parameter><ac:rich-text-body><p>body</p></ac:rich-text-body></ac:structured-macro>',
    );
  });

  it('turns rendered charts into attached images and reports which ones it used', () => {
    const { storage, chartIndexes } = htmlToStorage(page('<div><img data-confluence-chart="0" width="900"><img data-confluence-chart="2" width="5000"><img src="https://evil/x.png"></div>'));
    expect(storage).toBe(
      `<ac:image ac:width="900"><ri:attachment ri:filename="${chartFilename(0)}" /></ac:image><ac:image ac:width="1200"><ri:attachment ri:filename="${chartFilename(2)}" /></ac:image>`,
    );
    expect(chartIndexes).toEqual([0, 2]);
  });

  it('maps report status pills to status lozenges', () => {
    const { storage } = htmlToStorage(page(`<p>${pill('FAIL', 'bad')} ${pill('PASS', 'good')}</p>`));
    expect(storage).toContain('<ac:parameter ac:name="colour">Red</ac:parameter><ac:parameter ac:name="title">FAIL</ac:parameter>');
    expect(storage).toContain('<ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">PASS</ac:parameter>');
  });

  it('keeps external links and unwraps in-page anchors and javascript: links', () => {
    const { storage } = htmlToStorage(page('<p><a href="https://perfana.io/x?a=1&b=2">ext</a> <a href="#slo">anchor</a> <a href="javascript:alert(1)">js</a></p>'));
    expect(storage).toBe('<p><a href="https://perfana.io/x?a=1&amp;b=2">ext</a> anchor js</p>');
  });

  it('reads a single label/value tile as one line', () => {
    expect(htmlToStorage(page('<div><div><div>Duration</div><div>6m</div></div><p>after</p></div>')).storage)
      .toBe('<p><strong>Duration</strong>: 6m</p><p>after</p>');
  });

  it('turns a group of short stat tiles into one table, labels across the top', () => {
    const { storage } = htmlToStorage(page(
      '<div class="grid"><div><div>Duration</div><div>6m</div></div> ' +
      '<div><div>P95</div><div>874.75 ms</div><div><span>▲ +9.9%</span> vs previous</div></div></div>',
    ));
    expect(storage).toBe(
      '<table><tbody><tr><th>Duration</th><th>P95</th></tr><tr><td>6m</td><td>874.75 ms ▲ +9.9% vs previous</td></tr></tbody></table>',
    );
  });

  it('reads the scenario tiles (label/value spans, a wrapped pill as the Apdex value) as one table', () => {
    const tile = (l: string, v: string) => `<div style="display:flex; flex-direction:column;"><span>${l}</span> <span>${v}</span></div>`;
    const { storage } = htmlToStorage(page(
      `<div>${tile('Peak VU', '10')} ${tile('Errors', '0.0%')} ${tile('Apdex', pill('Excellent', 'good'))}</div>`,
    ));
    expect(storage).toMatch(/^<table><tbody><tr><th>Peak VU<\/th><th>Errors<\/th><th>Apdex<\/th><\/tr><tr><td>10<\/td><td>0\.0%<\/td><td><ac:structured-macro ac:name="status">/);
  });

  it('lays long values out as label/value rows', () => {
    const tile = (l: string, v: string) => `<div><div>${l}</div><div>${v}</div></div>`;
    const { storage } = htmlToStorage(page(`<div>${tile('Test Run ID', 'PerfanaWebshop-acc-loadTest-00004')}${tile('Workload', 'loadTest')}</div>`));
    expect(storage).toBe(
      '<table><tbody><tr><th>Test Run ID</th><td>PerfanaWebshop-acc-loadTest-00004</td></tr><tr><th>Workload</th><td>loadTest</td></tr></tbody></table>',
    );
  });

  it('merges a grid of tile rows into one table', () => {
    const tile = (l: string, v: string) => `<div><div>${l}</div><div>${v}</div></div>`;
    const row = (...t: string[]) => `<div style="display:grid">${t.join(' ')}</div>`;
    const { storage } = htmlToStorage(page(
      `<div><h2>Summary</h2>${row(tile('A', '1'), tile('B', '2'))} ${row(tile('C', '3'), tile('D', '4'))}</div>`,
    ));
    expect(storage).toBe(
      '<h2>Summary</h2><table><tbody><tr><th>A</th><th>B</th><th>C</th><th>D</th></tr><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></tbody></table>',
    );
  });

  it('keeps a grid with HTML comments between its tiles as one table, badges as lozenges', () => {
    const item = (l: string, v: string) => `<div class="info-item"><div class="info-label">${l}</div><div class="info-value">${v}</div></div>`;
    const { storage } = htmlToStorage(page(
      `<div class="info-grid"><!-- Row 1 -->${item('Duration', '6m')}<!-- Row 2 -->${item('SLO Status', '<span class="badge badge-success">8/8 PASSED</span>')}</div>`,
    ));
    expect(storage).toMatch(/^<table><tbody><tr><th>Duration<\/th><th>SLO Status<\/th><\/tr><tr><td>6m<\/td><td><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green<\/ac:parameter><ac:parameter ac:name="title">8\/8 PASSED</);
  });

  it('puts a space between text and a pill that follows it flush', () => {
    expect(htmlToStorage(page(`<p><span>Apdex 0.999</span>${pill('Excellent', 'good')}</p>`)).storage).toMatch(/^<p>Apdex 0\.999 <ac:structured-macro/);
  });

  it('keeps longer sibling paragraphs apart', () => {
    const long = 'x'.repeat(50);
    expect(htmlToStorage(page(`<div><div>${long}</div><div>second</div></div>`)).storage).toBe(`<p>${long}</p><p>second</p>`);
  });

  it('keeps a chart colour key as coloured squares, hex colours only', () => {
    const { storage } = htmlToStorage(page(
      '<div><span data-series="0"><span style="width:14px; background:#2563eb;"></span>T01</span> ' +
      '<span><span style="background: red; x: expression(alert(1))"></span>T02</span></div>',
    ));
    expect(storage).toBe('<p><span style="color: #2563eb;">■</span>T01 T02</p>');
  });

  it('turns the chart series table (an ARIA-role grid) into a real table, baseline swatch dashed', () => {
    const rows = [
      { name: 'T07 current', color: '#2563eb', dashed: false, unit: 'ms', min: '42 ms', mean: '103.88 ms', max: '257 ms' },
      { name: 'T07 baseline', color: '#6b7280', dashed: true, unit: 'ms', min: '40 ms', mean: '89.33 ms', max: '165 ms' },
    ];
    const { storage } = htmlToStorage(page(chartSeriesTable(rows, (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;'))));
    expect(storage).toContain('<table><tbody><tr><th>Series</th><th>Unit</th><th>Min</th><th>Mean</th><th>Max</th></tr>');
    expect(storage).toContain('<tr><td><span style="color: #2563eb;">■</span> T07 current</td><td>ms</td><td>42 ms</td><td>103.88 ms</td><td>257 ms</td></tr>');
    expect(storage).toContain('<td><span style="color: #6b7280;">- -</span> T07 baseline</td>');
  });

  it('keeps a comparison cell as lines, the delta as a coloured lozenge', () => {
    const { storage } = htmlToStorage(page(
      `<table><tr><td><div><div>288.99</div><div>vs 263.02</div><div>${deltaChip(9.9)}</div></div></td></tr></table>`,
    ));
    expect(storage).toContain('<td><p>288.99</p><p>vs 263.02</p><p> <ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">');
    expect(storage).not.toContain('<strong>288.99</strong>');
  });

  it('recognises pills by their fill in a report generated before data-pill existed', () => {
    const old = deltaChip(9.9).replace(/ data-pill="[^"]*"/, '');
    expect(old).not.toContain('data-pill');
    expect(htmlToStorage(page(`<p>${old}</p>`)).storage).toMatch(/ac:name="status"><ac:parameter ac:name="colour">(Green|Yellow|Red)</);
    // A pill-shaped span in any other colour stays text.
    expect(htmlToStorage(page('<p><span style="border-radius:999px; background:#123456;">x</span></p>')).storage).toBe('<p>x</p>');
  });

  it('drops the Comparisons "Show rows" chip filter', () => {
    expect(htmlToStorage(page('<div class="report-band-filter"><label><input type="checkbox">3 regressions</label></div><p>kept</p>')).storage)
      .toBe('<p>kept</p>');
  });

  it('collapses indentation outside <pre>', () => {
    expect(htmlToStorage(page('<p>a\n      b</p><pre>x\n  y</pre>')).storage).toBe('<p>a b</p><pre>x\n  y</pre>');
  });

  it('skips report chrome and hidden content', () => {
    const { storage } = htmlToStorage(page(
      '<div class="page-header"><span>Report</span></div><p style="display: none">hidden</p><g opacity="0">readout</g><p>kept</p>',
    ));
    expect(storage).toBe('<p>kept</p>');
  });
});
