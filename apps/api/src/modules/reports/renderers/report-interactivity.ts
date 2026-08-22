/**
 * Perfana Report — client-side table interactivity.
 *
 * The generated report is one self-contained HTML file. Opened from disk (the
 * "Download as HTML" path) it is a normal page, so a single inline script can
 * give every data table the sort + filter the compare card has.
 *
 * Two other consumers see the same string and must not change:
 *
 * - The in-app viewer and the public share page render it via `srcDoc` into an
 *   iframe with `sandbox="allow-same-origin allow-popups"` — no `allow-scripts`.
 *   The script never runs there. That is why the controls are *injected by the
 *   script* rather than emitted as markup: no scripts, no controls, instead of a
 *   dead filter box sitting inert in the modal.
 * - PDF generation runs the page through Puppeteer, which does execute JS. The
 *   print rules below hide the controls and restore any filtered-out rows, so
 *   the PDF is what it always was.
 */

/**
 * Styles for the injected controls. Interpolated into the report's single
 * <style> block *before* a template's customCss, so custom CSS still wins.
 */
export const REPORT_INTERACTIVITY_CSS = `
    /* Injected by report-interactivity.ts — only ever visible when the script ran. */
    .report-table-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 10px;
    }

    .report-table-tools input {
      flex: 0 1 260px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 13px;
      color: #1f2933;
      background: #ffffff;
      border: 1px solid #e9ecef;
      border-radius: 6px;
    }

    .report-table-tools input:focus {
      outline: 2px solid var(--primary-color, #1976d2);
      outline-offset: -1px;
      border-color: transparent;
    }

    .report-table-count {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8a929c;
      white-space: nowrap;
    }

    .report-sortable th {
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }

    .report-sortable th:hover,
    .report-sortable th:focus {
      color: #1f2933;
    }

    .report-sort-arrow {
      margin-left: 4px;
      font-size: 9px;
    }

    .report-row-hidden {
      display: none;
    }

    /* Only added once the chips are wired, so a script-blocked viewer keeps
       plain, unclickable count chips. */
    .report-bands-live [data-band-filter] {
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }

    .report-chip-off {
      opacity: 0.35;
    }

    @media print {
      /* Paper has no controls, and a filtered view must still print whole. */
      .report-table-tools {
        display: none;
      }

      .report-row-hidden {
        display: table-row;
      }

      /* A chip deselected on screen is still just a count on paper. */
      .report-chip-off {
        opacity: 1;
      }
    }
`;

/**
 * The inline <script>. Plain DOM code, no build step and no dependencies —
 * it is emitted verbatim into the document just before </body>.
 *
 * Deliberately contains no backticks and no `$\{` so it survives being a
 * template literal here.
 */
export const REPORT_INTERACTIVITY_SCRIPT = `<script>
(function () {
  'use strict';

  // A cell sorts as a number only when it *starts* with one, after any leading
  // glyph (the delta arrows). "api-v2" and "/checkout" must NOT parse as -2 and
  // 0, which a bare strip-the-letters would do. Anchoring at the start also
  // handles the composite comparison cells, "5 vs 47.99 \\u25BC -89.6%", where the
  // leading number is the value the column is about.
  var NUMERIC_LEAD = /^[^0-9A-Za-z]*[-+]?[0-9][0-9,]*(\\.[0-9]+)?/;

  function cellText(row, index) {
    var cell = row.cells[index];
    return cell ? cell.textContent.replace(/\\s+/g, ' ').trim() : '';
  }

  // ponytail: sorts by the number, so "900 MB" outranks "3.2 GB". Renderers
  // would have to emit a data-sort attribute to fix it; not worth it yet.
  function toNumber(text) {
    var match = NUMERIC_LEAD.exec(text);
    if (!match) return NaN;
    var cleaned = match[0].replace(/[^0-9.\\-]/g, '');
    return cleaned === '' || cleaned === '-' || cleaned === '.' ? NaN : parseFloat(cleaned);
  }

  // A detail row (one cell spanning the table, e.g. the SLO failing-targets
  // block) belongs to the row above it and travels with it.
  function collectUnits(tbody) {
    var units = [];
    var rows = tbody.rows;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var first = row.cells[0];
      var isDetail = units.length > 0 && row.cells.length === 1 && first && first.colSpan > 1;
      if (isDetail) units[units.length - 1].rows.push(row);
      else units.push({ leader: row, rows: [row], order: units.length });
    }
    return units;
  }

  function isNumericColumn(units, index) {
    var parsed = 0;
    var total = 0;
    for (var i = 0; i < units.length; i++) {
      var text = cellText(units[i].leader, index);
      if (!text) continue;
      total++;
      if (!isNaN(toNumber(text))) parsed++;
    }
    return total > 0 && parsed * 2 >= total;
  }

  function enhance(table) {
    var wrapper = table.parentNode;
    var tbody = table.tBodies[0];
    var head = table.tHead;
    if (!tbody || !head || !head.rows.length) return null;

    var units = collectUnits(tbody);
    if (!units.length) return null;

    var original = units.slice();
    var headers = head.rows[0].cells;
    var sortIndex = -1;
    var sortDir = 0;

    // The band filter is owned by the surrounding group and shared with the
    // other tables under the same chips; wireBands swaps in that shared array.
    // Empty means "no band filter", which is also what deselecting every chip
    // leaves behind — never an empty table.
    var entry = { scope: table.closest ? table.closest('[data-band-scope]') : null, bands: [] };

    table.className = table.className ? table.className + ' report-sortable' : 'report-sortable';

    // A table too short to be worth searching still needs to answer to the
    // band chips, so only the toolbar is conditional — never the registration.
    var input = null;
    var count = null;
    if (units.length >= 3) {
      var tools = document.createElement('div');
      tools.className = 'report-table-tools';
      input = document.createElement('input');
      input.type = 'search';
      input.placeholder = 'Filter rows...';
      input.setAttribute('aria-label', 'Filter table rows');
      count = document.createElement('span');
      count.className = 'report-table-count';
      tools.appendChild(input);
      tools.appendChild(count);
      wrapper.parentNode.insertBefore(tools, wrapper);
    }

    function applyFilter() {
      var query = input ? input.value.toLowerCase().trim() : '';
      var bands = entry.bands;
      var shown = 0;
      for (var i = 0; i < units.length; i++) {
        var unit = units[i];
        var band = unit.leader.getAttribute('data-band');
        var bandOk = !band || !bands.length || bands.indexOf(band) !== -1;
        var match = bandOk && (!query || unit.leader.textContent.toLowerCase().indexOf(query) !== -1);
        if (match) shown++;
        for (var r = 0; r < unit.rows.length; r++) {
          if (match) unit.rows[r].classList.remove('report-row-hidden');
          else unit.rows[r].classList.add('report-row-hidden');
        }
      }
      if (!count) return;
      count.textContent = shown === units.length
        ? units.length + ' rows'
        : 'showing ' + shown + ' of ' + units.length;
    }

    function applyOrder() {
      for (var i = 0; i < units.length; i++) {
        for (var r = 0; r < units[i].rows.length; r++) tbody.appendChild(units[i].rows[r]);
      }
    }

    function markHeaders() {
      for (var i = 0; i < headers.length; i++) {
        var arrow = headers[i].querySelector('.report-sort-arrow');
        if (arrow) arrow.parentNode.removeChild(arrow);
        headers[i].removeAttribute('aria-sort');
      }
      if (sortDir === 0 || !headers[sortIndex]) return;
      var span = document.createElement('span');
      span.className = 'report-sort-arrow';
      span.textContent = sortDir > 0 ? '\\u25B2' : '\\u25BC';
      headers[sortIndex].appendChild(span);
      headers[sortIndex].setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
    }

    function sortBy(index) {
      if (sortIndex === index) sortDir = sortDir === 1 ? -1 : sortDir === -1 ? 0 : 1;
      else { sortIndex = index; sortDir = 1; }

      if (sortDir === 0) {
        units = original.slice();
      } else {
        var numeric = isNumericColumn(units, index);
        var dir = sortDir;
        units = units.slice().sort(function (a, b) {
          var left = cellText(a.leader, index);
          var right = cellText(b.leader, index);
          var result;
          if (numeric) {
            var ln = toNumber(left);
            var rn = toNumber(right);
            // Unparseable cells sink to the bottom in both directions, the way
            // the compare card sinks its NaNs.
            if (isNaN(ln) && isNaN(rn)) result = 0;
            else if (isNaN(ln)) return 1;
            else if (isNaN(rn)) return -1;
            else result = ln - rn;
          } else if (!left && !right) result = 0;
          else if (!left) return 1;
          else if (!right) return -1;
          else result = left.localeCompare(right, undefined, { numeric: true });
          return result !== 0 ? result * dir : a.order - b.order;
        });
      }

      markHeaders();
      applyOrder();
      applyFilter();
    }

    for (var h = 0; h < headers.length; h++) {
      (function (index) {
        var th = headers[index];
        th.setAttribute('role', 'button');
        th.setAttribute('tabindex', '0');
        th.addEventListener('click', function () { sortBy(index); });
        th.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            sortBy(index);
          }
        });
      })(h);
    }

    if (input) input.addEventListener('input', applyFilter);
    applyFilter();

    entry.refresh = applyFilter;
    return entry;
  }

  // The group's summary chips ("4 warnings", "37 within range") become toggles
  // over the rows their counts describe.
  function wireBands(scope, entries) {
    var chips = scope.querySelectorAll('[data-band-filter]');
    if (!chips.length || !entries.length) return;

    var bands = [];
    for (var e = 0; e < entries.length; e++) entries[e].bands = bands;

    function paint() {
      for (var c = 0; c < chips.length; c++) {
        var on = !bands.length || bands.indexOf(chips[c].getAttribute('data-band-filter')) !== -1;
        chips[c].setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) chips[c].classList.remove('report-chip-off');
        else chips[c].classList.add('report-chip-off');
      }
      for (var i = 0; i < entries.length; i++) entries[i].refresh();
    }

    function toggle(band) {
      // All-on is the empty set, so the first click means "just this one" and
      // clearing the last selection goes back to showing everything.
      var at = bands.indexOf(band);
      if (at !== -1) bands.splice(at, 1);
      else bands.push(band);
      paint();
    }

    for (var c = 0; c < chips.length; c++) {
      (function (element) {
        var band = element.getAttribute('data-band-filter');
        element.setAttribute('role', 'button');
        element.setAttribute('tabindex', '0');
        element.addEventListener('click', function () { toggle(band); });
        element.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle(band);
          }
        });
      })(chips[c]);
    }

    // Only now do the chips look clickable — a script-blocked viewer keeps the
    // plain count chips it has always shown.
    scope.classList.add('report-bands-live');
    paint();
  }

  function init() {
    var tables = document.querySelectorAll('.table-scroll table');
    var entries = [];
    for (var i = 0; i < tables.length; i++) {
      // A nested table is a detail block inside another table's row; the outer
      // table already owns those rows.
      if (tables[i].parentNode.closest && tables[i].parentNode.closest('table')) continue;
      var entry = enhance(tables[i]);
      if (entry) entries.push(entry);
    }

    var scopes = document.querySelectorAll('[data-band-scope]');
    for (var s = 0; s < scopes.length; s++) {
      var owned = [];
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].scope === scopes[s]) owned.push(entries[e]);
      }
      wireBands(scopes[s], owned);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;
