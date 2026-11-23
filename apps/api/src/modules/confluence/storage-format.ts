import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/**
 * Converts a compiled report (as returned by perfana-report's Confluence render, charts already
 * swapped for `<img data-confluence-chart="N">`) into Confluence storage format.
 *
 * One generic converter rather than a Confluence variant of every section renderer: it keeps the
 * structure Confluence can show (headings, paragraphs, lists, tables, links, `<details>` as expand
 * macros, status pills as status lozenges, charts as attached images) and drops what it cannot
 * (scripts, styles, form controls, leftover SVG icons, hover readouts). Any element it does not know
 * is unwrapped, so a new renderer's content still arrives as text.
 *
 * Storage format is XHTML: every tag is closed and text is escaped, so the output is built by hand
 * rather than serialised by cheerio.
 */

export const chartFilename = (index: number): string => `chart-${String(index + 1).padStart(3, '0')}.png`;

const DROP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'input', 'button', 'select', 'textarea', 'head', 'title', 'meta', 'link', 'iframe', 'object', 'canvas']);
const KEEP_INLINE = new Set(['strong', 'em', 'code', 'sub', 'sup', 'u', 's', 'del']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em', strike: 's', ins: 'u' };
const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'blockquote', 'pre', 'hr', 'details', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'img']);
const PILL_COLOUR: Record<string, string> = { good: 'Green', bad: 'Red', warn: 'Yellow', info: 'Blue', neutral: 'Grey' };
// The compiler's `.badge-*` classes (header summary) carry the same meaning as pill kinds.
const BADGE_PILL: Record<string, string> = { success: 'good', error: 'bad', warning: 'warn', info: 'info' };
// Pill and delta-chip fills (PILL_FILLS in reports/renderers/report-style.ts). Reports are stored as
// HTML when generated, so one generated before the pills carried data-pill is recognised by its fill.
const FILL_PILL: Record<string, string> = {
  '#e7f4ea': 'good', '#fdf0dd': 'warn', '#fbe6e4': 'bad', '#eaf1fb': 'info', '#f1f1f3': 'neutral',
};
const pillKindByFill = (style: string): string | undefined => {
  if (!/border-radius\s*:\s*999px/.test(style)) return undefined;
  const fill = /background\s*:\s*(#[0-9a-f]{6})\b/i.exec(style)?.[1]?.toLowerCase();
  return fill ? FILL_PILL[fill] : undefined;
};

// Report chrome that is not content: the print header, the screen-only hover band, and the
// Comparisons "Show rows" chip filter, which is CSS checkboxes and nothing but loose words without them.
const SKIP_CLASSES = ['page-header', 'chart-hover-band', 'report-band-filter', 'no-confluence'];

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

export interface StorageConversion {
  storage: string;
  /** Chart indexes the storage references, so only those PNGs are uploaded. */
  chartIndexes: number[];
}

export function htmlToStorage(html: string): StorageConversion {
  const $ = cheerio.load(html);
  const chartIndexes: number[] = [];

  // Comments count as whitespace: the report puts "<!-- Row 2 -->" between the tiles of one grid.
  const isWhitespace = (c: AnyNode): boolean =>
    c.type === 'comment' || (c.type === 'text' && !(c as unknown as { data: string }).data.trim());

  /** Converts an element's children; consecutive label/value tiles become one table. */
  const children = (el: AnyNode): string => {
    if (!('children' in el)) return '';
    const out: string[] = [];
    let run: Pair[] = [];
    const flush = () => {
      if (run.length >= 2) out.push(pairTable(run));
      else if (run.length === 1) out.push(wrap('p', `<strong>${escapeText(run[0]!.label)}</strong>: ${run[0]!.value}`));
      run = [];
    };
    for (const c of el.children as AnyNode[]) {
      if (isWhitespace(c)) {
        if (!run.length) out.push(convert(c));
        continue;
      }
      const pair = c.type === 'tag' && !skipped(c as Element) ? pairOf(c as Element) : null;
      if (pair) {
        run.push(pair);
        continue;
      }
      // A grid laid out as several row containers of tiles is still one group, so one table.
      const row = c.type === 'tag' && !skipped(c as Element) ? rowOf(c as Element) : null;
      if (row) {
        run.push(...row);
        continue;
      }
      flush();
      out.push(convert(c));
    }
    flush();
    return out.join('');
  };

  const isBlockish = (el: Element): boolean =>
    el.children.some((c) => c.type === 'tag' && BLOCK.has((c as Element).name));

  const skipped = (el: Element): boolean =>
    SKIP_CLASSES.some((c) => (el.attribs.class ?? '').split(/\s+/).includes(c)) ||
    /\bdisplay\s*:\s*none\b/.test(el.attribs.style ?? '') ||
    // CSS-only hover readouts sit in the markup at opacity 0.
    el.attribs.opacity === '0';

  /**
   * A label/value tile ("Duration" / "6m", or a stat tile with a delta under the value): a block of
   * 2-4 text-only children whose first is a short label. Children are divs/ps that are not tiles
   * themselves, or spans holding text or a wrapped status pill (the Apdex tile). A chart key's
   * entries hold a swatch span, and the scenario header puts a bare pill beside its chip, so
   * neither is read as a tile.
   */
  const pairOf = (el: Element): Pair | null => {
    // Inside a table cell those blocks are lines ("288.99" / "vs 263.02" / "+9.9%"), not a label and a value.
    if (!BLOCK.has(el.name) || $(el).closest('td, th, [role=cell]').length) return null;
    const parts = el.children.filter((c) => !isWhitespace(c));
    if (parts.length < 2 || parts.length > 4) return null;
    const textOnly = (c: AnyNode): boolean => {
      if (c.type !== 'tag') return false;
      const e = c as Element;
      if (pillKindOf(e)) return false;
      if (e.name === 'span') return e.children.every((g) => g.type !== 'tag' || !!pillKindOf(g as Element));
      return ['div', 'p'].includes(e.name) && !isBlockish(e) && !pairOf(e);
    };
    if (!parts.every(textOnly)) return null;
    const label = textOf(parts[0]!);
    const value = parts
      .slice(1)
      .map((c) => ((c as Element).name === 'span' ? convert(c) : children(c)).trim())
      .filter(Boolean)
      .join(' ');
    if (!label || label.length > 40 || !value || textOf(el).length > 200) return null;
    return { label, value };
  };

  /** A row container whose children are all tiles: its tiles, else null. */
  const rowOf = (el: Element): Pair[] | null => {
    if (!BLOCK.has(el.name)) return null;
    const parts = el.children.filter((c) => !isWhitespace(c));
    if (parts.length < 2) return null;
    const pairs = parts.map((c) => (c.type === 'tag' && !skipped(c as Element) ? pairOf(c as Element) : null));
    return pairs.every(Boolean) ? (pairs as Pair[]) : null;
  };

  // Text nodes joined with a space: cheerio's .text() runs "<h3>Group A</h3><span>3 rows</span>" together.
  const textOf = (el: AnyNode): string => {
    const parts: string[] = [];
    const walk = (n: AnyNode): void => {
      if (n.type === 'text') parts.push((n as unknown as { data: string }).data);
      else if ('children' in n) (n.children as AnyNode[]).forEach(walk);
    };
    walk(el);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };

  /** A status pill, a `.badge-*`, or (in a report generated before data-pill) a pill-coloured chip. */
  const pillKindOf = (el: Element): string | undefined =>
    el.attribs['data-pill'] ??
    BADGE_PILL[/\bbadge-(\w+)/.exec(el.attribs.class ?? '')?.[1] ?? ''] ??
    (el.name === 'span' && textOf(el) ? pillKindByFill(el.attribs.style ?? '') : undefined);

  const textParts = (el: AnyNode): string[] => {
    const parts: string[] = [];
    const walk = (n: AnyNode): void => {
      if (n.type === 'text') {
        const t = (n as unknown as { data: string }).data.replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
      } else if ('children' in n) (n.children as AnyNode[]).forEach(walk);
    };
    walk(el);
    return parts;
  };

  function convert(node: AnyNode): string {
    if (node.type === 'text') {
      const data = (node as unknown as { data: string }).data;
      // The report's indentation is a third of its size; collapse it everywhere but <pre>.
      return escapeText($(node).closest('pre').length ? data : data.replace(/\s+/g, ' '));
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return '';
    const el = node as Element;
    const name = el.name.toLowerCase();
    if (DROP.has(name)) return '';

    if (skipped(el)) return '';

    const pillKind = pillKindOf(el);
    if (pillKind) {
      const colour = PILL_COLOUR[pillKind] ?? 'Grey';
      // Leading space: the report puts a pill flush against the text before it ("Apdex 0.999Excellent").
      return ` <ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${escapeText(textOf(el))}</ac:parameter></ac:structured-macro>`;
    }

    // A chart's colour key (an empty span painted with a background) becomes a coloured square, so
    // the names under a chart still say which line is which. Hex only: nothing else reaches the style.
    // A baseline's swatch is a dashed line (border-top: 2px dashed), so it stays told apart as "- -".
    if (name === 'span' && !textOf(el)) {
      const style = el.attribs.style ?? '';
      const dashed = /border-top\s*:[^;]*\bdashed\s+(#[0-9a-f]{3,8})\b/i.exec(style);
      if (dashed) return `<span style="color: ${dashed[1]};">- -</span>`;
      const swatch = /background(?:-color)?\s*:\s*(#[0-9a-f]{3,8})\b/i.exec(style);
      return swatch ? `<span style="color: ${swatch[1]};">■</span>` : '';
    }

    // The report's series tables are CSS grids with ARIA table roles (a real <table> there would be
    // picked up by the report's own row filter); in Confluence they become the table they describe.
    if (el.attribs.role === 'table') {
      const rows = el.children.filter((c) => c.type === 'tag' && (c as Element).attribs.role === 'row') as Element[];
      const body = rows
        .map((row) => {
          const cells = row.children.filter((c) => c.type === 'tag' && !skipped(c as Element)) as Element[];
          return `<tr>${cells
            .map((cell) => {
              const tag = ['columnheader', 'rowheader'].includes(cell.attribs.role ?? '') ? 'th' : 'td';
              return `<${tag}>${children(cell).trim()}</${tag}>`;
            })
            .join('')}</tr>`;
        })
        .join('');
      return `<table><tbody>${body}</tbody></table>`;
    }

    if (name === 'img') {
      const index = Number(el.attribs['data-confluence-chart']);
      if (!Number.isInteger(index) || index < 0) return ''; // external images would not load inside Confluence
      chartIndexes.push(index);
      const width = Number(el.attribs.width);
      const widthAttr = Number.isFinite(width) && width > 0 ? ` ac:width="${Math.min(Math.round(width), 1200)}"` : '';
      return `<ac:image${widthAttr}><ri:attachment ri:filename="${chartFilename(index)}" /></ac:image>`;
    }

    if (name === 'details') {
      const summary = el.children.find((c) => c.type === 'tag' && (c as Element).name === 'summary');
      // A summary is a heading plus count chips; " · " keeps "Checkout" and "1 panels" apart.
      const title = summary ? textParts(summary).join(' · ') : 'Details';
      const body = el.children.filter((c) => c !== summary).map(convert).join('');
      return `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">${escapeText(title)}</ac:parameter><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
    }

    if (name === 'a') {
      const href = el.attribs.href ?? '';
      // In-page anchors point into the original HTML; Confluence would render them as dead links.
      return /^https?:\/\//i.test(href) ? `<a href="${escapeAttr(href)}">${children(el)}</a>` : children(el);
    }

    if (name === 'br') return '<br />';
    if (name === 'hr') return '<hr />';
    if (/^h[1-6]$/.test(name) || ['p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'thead', 'tbody', 'tfoot', 'tr'].includes(name)) {
      return wrap(name, children(el));
    }
    if (name === 'table') return wrap('table', children(el));
    if (name === 'th' || name === 'td') {
      const span = ['colspan', 'rowspan']
        .filter((a) => /^\d+$/.test(el.attribs[a] ?? ''))
        .map((a) => ` ${a}="${el.attribs[a]}"`)
        .join('');
      return `<${name}${span}>${children(el)}</${name}>`;
    }
    if (name === 'caption' || name === 'figcaption' || name === 'dt') return wrap('p', `<strong>${children(el)}</strong>`);
    if (name === 'dd') return wrap('p', children(el));
    if (name === 'summary') return wrap('p', `<strong>${children(el)}</strong>`);
    if (KEEP_INLINE.has(name) || RENAME[name]) {
      const tag = RENAME[name] ?? name;
      return `<${tag}>${children(el)}</${tag}>`;
    }

    // div, section, span and anything unknown. A block container with only inline content becomes a
    // paragraph, so two adjacent stat tiles do not run together as "P95844 ms".
    if (BLOCK.has(name) && !isBlockish(el)) {
      const inner = children(el);
      return inner.trim() ? wrap('p', inner) : '';
    }
    return children(el);
  }

  const storage = convert($('body').get(0) ?? $.root().get(0)!)
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/\n{2,}/g, '\n');
  return { storage, chartIndexes };
}

function wrap(tag: string, inner: string): string {
  return `<${tag}>${inner}</${tag}>`;
}

interface Pair {
  label: string;
  /** Already storage format. */
  value: string;
}

/**
 * A group of label/value tiles as a table. Short values (metric tiles) read across, labels as the
 * header row; long ones (run details) read down, one label/value row each.
 */
function pairTable(pairs: Pair[]): string {
  const across = pairs.length <= 8 && pairs.every((p) => p.value.replace(/<[^>]+>/g, '').length <= 30);
  if (across) {
    return `<table><tbody><tr>${pairs.map((p) => `<th>${escapeText(p.label)}</th>`).join('')}</tr>` +
      `<tr>${pairs.map((p) => `<td>${p.value}</td>`).join('')}</tr></tbody></table>`;
  }
  return `<table><tbody>${pairs.map((p) => `<tr><th>${escapeText(p.label)}</th><td>${p.value}</td></tr>`).join('')}</tbody></table>`;
}
