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

  describe('a group\'s band chips', () => {
    /** A group as the comparisons renderer emits it: chips above a table of banded rows. */
    const GROUP = `<details class="report-group" data-band-scope open><summary>Checkout</summary>
      <div class="report-band-filter">
        <label data-band-filter="regression"><input type="checkbox" value="regression">1 regressions</label>
        <label data-band-filter="ok"><input type="checkbox" value="ok">3 within range</label>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Transaction</th><th>Avg</th></tr></thead>
          <tbody>
            <tr data-band="ok"><td>/login</td><td>98 ms</td></tr>
            <tr data-band="regression"><td>/checkout</td><td>1,200 ms</td></tr>
            <tr data-band="ok"><td>/search</td><td>340 ms</td></tr>
            <tr data-band="ok"><td>/health</td><td>12 ms</td></tr>
          </tbody>
        </table>
      </div>
    </details>`;

    const chip = (band: string): HTMLElement =>
      document.querySelector(`[data-band-filter="${band}"]`) as HTMLElement;
    const counter = (): string | null => document.querySelector('.report-table-count')!.textContent;

    beforeEach(() => {
      document.body.innerHTML = GROUP;
      runScript();
    });

    it('leaves them alone: a click ticks the box, and the group stays open', () => {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      chip('regression').dispatchEvent(click);

      // preventDefault here would stop the box from ticking, which is the whole filter.
      expect(click.defaultPrevented).toBe(false);
      expect(chip('regression').querySelector('input')!.checked).toBe(true);
      expect(document.querySelector('details')!.open).toBe(true);
      expect(chip('regression').getAttribute('role')).toBeNull();
    });

    // Value: protects=the row counter in a downloaded report counts only rows the ticked chips leave visible; fails_when=applyFilter stops reading the ticked chips or the change listener is dropped; why_new=the band filter moved to CSS and the counter kept counting every row; seam=none; no_claim=that the CSS hides those rows (comparisons-renderer contract spec)
    it('counts only the rows the ticked chips leave visible', () => {
      expect(counter()).toBe('4 rows');

      chip('regression').click();
      expect(counter()).toBe('showing 1 of 4');

      chip('ok').click();
      expect(counter()).toBe('4 rows');

      chip('regression').click();
      chip('ok').click();
      expect(counter()).toBe('4 rows');
    });

    it('combines the ticked chips with the text filter', () => {
      chip('ok').click();
      const input = filterInput();
      input.value = 'search';
      input.dispatchEvent(new Event('input'));

      expect(counter()).toBe('showing 1 of 4');

      input.value = 'checkout';
      input.dispatchEvent(new Event('input'));
      // The one match is a regression row, which the ok chip hides.
      expect(counter()).toBe('showing 0 of 4');
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
