/**
 * @jest-environment jsdom
 */
import { REPORT_INTERACTIVITY_SCRIPT } from './report-interactivity';

/**
 * The script ships as a string, so the only honest check is to run it against a
 * document shaped like a real report table and drive it.
 */
function runScript(): void {
  const body = REPORT_INTERACTIVITY_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');
  // eslint-disable-next-line no-new-func
  new Function(body)();
}

const TABLE = `
  <div class="table-scroll">
    <table>
      <thead><tr><th>Transaction</th><th>Avg</th></tr></thead>
      <tbody>
        <tr id="r-checkout"><td>/checkout</td><td>1,200 ms</td></tr>
        <tr id="r-checkout-detail"><td colspan="2">failing target detail</td></tr>
        <tr id="r-login"><td>/login</td><td>98 ms</td></tr>
        <tr id="r-search"><td>/search</td><td>340 ms</td></tr>
        <tr id="r-missing"><td>/health</td><td>&mdash;</td></tr>
      </tbody>
    </table>
  </div>`;

/** Leader rows in DOM order (detail rows excluded). */
const leaderOrder = (): string[] =>
  Array.from(document.querySelectorAll('tbody tr'))
    .filter((row) => !row.querySelector('td[colspan]'))
    .map((row) => row.id);

const visibleLeaders = (): string[] =>
  Array.from(document.querySelectorAll('tbody tr'))
    .filter((row) => !row.querySelector('td[colspan]') && !row.classList.contains('report-row-hidden'))
    .map((row) => row.id);

const header = (index: number): HTMLElement =>
  document.querySelectorAll('thead th')[index] as HTMLElement;

const filterInput = (): HTMLInputElement =>
  document.querySelector('.report-table-tools input') as HTMLInputElement;

describe('report interactivity script', () => {
  beforeEach(() => {
    document.body.innerHTML = TABLE;
    runScript();
  });

  it('injects a tools bar above the table', () => {
    const tools = document.querySelector('.report-table-tools');
    expect(tools).not.toBeNull();
    expect(tools!.nextElementSibling!.className).toBe('table-scroll');
    expect(document.querySelector('.report-table-count')!.textContent).toBe('4 rows');
  });

  it('sorts a numeric column ascending, sinking unparseable cells', () => {
    header(1).click();
    expect(leaderOrder()).toEqual(['r-login', 'r-search', 'r-checkout', 'r-missing']);
  });

  it('reverses on a second click, still sinking unparseable cells', () => {
    header(1).click();
    header(1).click();
    expect(leaderOrder()).toEqual(['r-checkout', 'r-search', 'r-login', 'r-missing']);
  });

  it('restores the original order on a third click', () => {
    header(1).click();
    header(1).click();
    header(1).click();
    expect(leaderOrder()).toEqual(['r-checkout', 'r-login', 'r-search', 'r-missing']);
  });

  it('sorts a text column without misreading names as numbers', () => {
    header(0).click();
    expect(leaderOrder()).toEqual(['r-checkout', 'r-missing', 'r-login', 'r-search']);
  });

  it('keeps a colspan detail row attached to its leader after sorting', () => {
    header(1).click();
    const rows = Array.from(document.querySelectorAll('tbody tr')).map((row) => row.id);
    expect(rows[rows.indexOf('r-checkout') + 1]).toBe('r-checkout-detail');
  });

  it('sorts composite comparison cells by their leading value', () => {
    // The comparisons renderer packs current, baseline and delta into one cell.
    document.body.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Metric</th><th>P95</th></tr></thead>
          <tbody>
            <tr id="c-mid"><td>cpu</td><td>47.9 vs 50.1 \u25BC -4.4%</td></tr>
            <tr id="c-high"><td>mem</td><td>510.3 vs 516.4 \u25BC -1.2%</td></tr>
            <tr id="c-low"><td>io</td><td>5 vs 47.9 \u25BC -89.6%</td></tr>
          </tbody>
        </table>
      </div>`;
    runScript();
    header(1).click();

    expect(leaderOrder()).toEqual(['c-low', 'c-mid', 'c-high']);
  });

  it('sorts a comparison cell whose leading value carries grouped thousands', () => {
    // The unit lives in the panel heading now, so the cells read "1,510.3 vs 516.4 ...".
    // The sorter reads the LEADING number out of the cell text, and it has to read the
    // separator as grouping rather than stopping at it — truncating "1,510.3" to 1 would
    // sink the worst row to the top of the column.
    document.body.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Metric</th><th>P95</th></tr></thead>
          <tbody>
            <tr id="u-mid"><td>cpu</td><td>47.9 vs 50.1 ▼ -4.4%</td></tr>
            <tr id="u-high"><td>mem</td><td>1,510.3 vs 516.4 ▲ 192.5%</td></tr>
            <tr id="u-low"><td>io</td><td>5 vs 47.9 ▼ -89.6%</td></tr>
          </tbody>
        </table>
      </div>`;
    runScript();
    header(1).click();

    expect(leaderOrder()).toEqual(['u-low', 'u-mid', 'u-high']);
  });

  it('sorts a percentunit column by its value, not by the delta chip trailing the cell', () => {
    // percentunit values are scaled into 0-100 and rendered bare ("42 vs 40"), with the
    // only "%" left in the cell belonging to the delta at the end. Sorting must key on the
    // leading value — keying on the delta would order these p-high, p-mid, p-low.
    document.body.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Metric</th><th>Avg</th></tr></thead>
          <tbody>
            <tr id="p-mid"><td>cpu</td><td>42 vs 40 ▲ 5%</td></tr>
            <tr id="p-high"><td>heap</td><td>91.5 vs 88 ▲ 4%</td></tr>
            <tr id="p-low"><td>io</td><td>3 vs 9 ▼ -66.7%</td></tr>
          </tbody>
        </table>
      </div>`;
    runScript();
    header(1).click();

    expect(leaderOrder()).toEqual(['p-low', 'p-mid', 'p-high']);
  });

  it('filters rows and updates the counter', () => {
    const input = filterInput();
    input.value = 'log';
    input.dispatchEvent(new Event('input'));

    expect(visibleLeaders()).toEqual(['r-login']);
    expect(document.querySelector('.report-table-count')!.textContent).toBe('showing 1 of 4');
  });

  it('hides a detail row together with its leader', () => {
    const input = filterInput();
    input.value = 'login';
    input.dispatchEvent(new Event('input'));

    expect(document.getElementById('r-checkout-detail')!.classList.contains('report-row-hidden')).toBe(true);
  });

  describe('band chips', () => {
    /** A group whose chips govern two panel tables, as the dashboard branch renders it. */
    const GROUP = `
      <div data-band-scope>
        <span data-band-filter="regression">1 regressions</span>
        <span data-band-filter="warning">1 warnings</span>
        <span data-band-filter="ok">2 within range</span>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Metric</th><th>P95</th></tr></thead>
            <tbody>
              <tr id="b-reg" data-band="regression"><td>cpu</td><td>500</td></tr>
              <tr id="b-warn" data-band="warning"><td>mem</td><td>300</td></tr>
              <tr id="b-ok1" data-band="ok"><td>io</td><td>100</td></tr>
            </tbody>
          </table>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Metric</th><th>P95</th></tr></thead>
            <tbody><tr id="b-ok2" data-band="ok"><td>net</td><td>50</td></tr></tbody>
          </table>
        </div>
      </div>`;

    const chip = (band: string): HTMLElement =>
      document.querySelector(`[data-band-filter="${band}"]`) as HTMLElement;

    beforeEach(() => {
      document.body.innerHTML = GROUP;
      runScript();
    });

    it('shows every band until a chip is clicked', () => {
      expect(visibleLeaders()).toEqual(['b-reg', 'b-warn', 'b-ok1', 'b-ok2']);
      expect(chip('regression').getAttribute('aria-pressed')).toBe('true');
    });

    it('narrows to the clicked band', () => {
      chip('regression').click();

      expect(visibleLeaders()).toEqual(['b-reg']);
      expect(chip('warning').classList.contains('report-chip-off')).toBe(true);
      expect(chip('regression').classList.contains('report-chip-off')).toBe(false);
    });

    it('accumulates bands across clicks', () => {
      chip('regression').click();
      chip('warning').click();

      expect(visibleLeaders()).toEqual(['b-reg', 'b-warn']);
    });

    it('returns to showing everything when the last chip is switched off', () => {
      chip('regression').click();
      chip('regression').click();

      expect(visibleLeaders()).toEqual(['b-reg', 'b-warn', 'b-ok1', 'b-ok2']);
      expect(chip('ok').classList.contains('report-chip-off')).toBe(false);
    });

    it('governs every table in its group, including ones too short for a toolbar', () => {
      expect(document.querySelectorAll('.report-table-tools')).toHaveLength(1);

      chip('regression').click();

      expect(document.getElementById('b-ok2')!.classList.contains('report-row-hidden')).toBe(true);
    });

    it('combines the band filter with the text filter', () => {
      chip('ok').click();
      const input = filterInput();
      input.value = 'net';
      input.dispatchEvent(new Event('input'));

      expect(visibleLeaders()).toEqual(['b-ok2']);
    });

    it('only makes chips look clickable once they are wired', () => {
      expect(document.querySelector('[data-band-scope]')!.classList.contains('report-bands-live')).toBe(true);

      document.body.innerHTML = GROUP;
      expect(document.querySelector('[data-band-scope]')!.classList.contains('report-bands-live')).toBe(false);
    });
  });

  it('leaves a nested table to its parent', () => {
    document.body.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Check</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>a</td><td>1</td></tr>
            <tr><td>b</td><td>2</td></tr>
            <tr><td>c</td><td>3</td></tr>
            <tr><td colspan="2">
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Target</th></tr></thead>
                  <tbody><tr><td>x</td></tr><tr><td>y</td></tr><tr><td>z</td></tr></tbody>
                </table>
              </div>
            </td></tr>
          </tbody>
        </table>
      </div>`;
    runScript();

    expect(document.querySelectorAll('.report-table-tools')).toHaveLength(1);
  });

  it('skips tables too short to be worth sorting', () => {
    document.body.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Metric</th></tr></thead>
          <tbody><tr><td>only</td></tr><tr><td>two</td></tr></tbody>
        </table>
      </div>`;
    runScript();

    expect(document.querySelector('.report-table-tools')).toBeNull();
  });
});
