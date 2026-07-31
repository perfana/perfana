/**
 * Minimal markdown -> HTML for report text blocks.
 *
 * Lives in shared because two places must agree on the STRUCTURE of the output:
 * the API renders it into the report/PDF, and the web editor renders the live
 * preview beside the input. A second implementation would drift.
 *
 * ponytail: escape-then-transform, so no sanitizer (and no marked/DOMPurify/jsdom)
 * is needed — every `<` in the source is already `&lt;` before the first tag is
 * emitted, so no author-supplied HTML can survive. Supported: headings, bold,
 * italic, inline code, links, bullet/ordered lists, paragraphs. Not supported:
 * tables, images, blockquotes, nested lists, nested emphasis, `_underscore_`
 * emphasis (metric names are full of underscores). Swap in marked + a sanitizer
 * if those are asked for.
 *
 * Typography is NOT shared: `styled: true` (the default) bakes the print-oriented
 * inline styles the PDF needs; the web preview passes `styled: false` and styles
 * the tags via the theme, so it stays readable in dark mode.
 */

export interface RenderMarkdownOptions {
  /** Bake print inline styles into the output. Off for themed web rendering. */
  styled?: boolean;
}

/** The "Enable Markdown" switch default. One source of truth across api + web. */
export const TEXT_BLOCK_MARKDOWN_DEFAULT = true;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

export const escapeHtml = (text: string): string =>
  (text ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char] || char);

// Inline styles rather than a stylesheet: the print/PDF path has no cascade of
// its own to hook into, and every other report renderer does the same.
const H_STYLE: Record<number, string> = {
  1: 'font-size:18px; font-weight:700; margin:0 0 10px;',
  2: 'font-size:15px; font-weight:700; margin:14px 0 8px;',
  3: 'font-size:13px; font-weight:700; margin:12px 0 6px;',
  4: 'font-size:12px; font-weight:700; margin:12px 0 6px;',
  5: 'font-size:12px; font-weight:600; margin:10px 0 6px;',
  6: 'font-size:11px; font-weight:600; margin:10px 0 6px;',
};
const P_STYLE = 'margin:0 0 10px;';
const LIST_STYLE = 'margin:0 0 10px; padding-left:22px;';
const CODE_STYLE =
  'font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.92em; background:#f3f4f6; padding:1px 4px; border-radius:3px;';

const attr = (style: string, styled: boolean): string => (styled ? ` style="${style}"` : '');

// Relative, anchor, http(s) and mailto only. `\/(?!\/)` excludes protocol-relative
// `//evil.com`, which would otherwise ride in on the relative-path branch.
const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

// Single pass with alternation so precedence falls out of match order:
// code wins over bold wins over italic.
//
// Emphasis requires a non-space character adjacent to both delimiters, so prose
// like `2 * 3 * 4 = 24` and glob patterns keep their literal asterisks.
//
// The link label is bounded to one line and 200 chars on purpose: unbounded
// `[^\]]+` backtracks char-by-char from every unclosed `[` to end-of-string,
// which is O(n^2) (20k stray `[` measured at 582ms), and this runs on every
// keystroke in the editor preview as well as server-side in the PDF render.
//
// The href allows one level of balanced parens so Grafana/wiki URLs survive.
const INLINE =
  /`([^`]+)`|\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*|\[([^\]\n]{1,200})\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

function inline(text: string, styled: boolean): string {
  return text.replace(INLINE, (match, code, bold, italic, label, href) => {
    if (code) return `<code${attr(CODE_STYLE, styled)}>${code}</code>`;
    if (bold) return `<strong>${bold}</strong>`;
    if (italic) return `<em>${italic}</em>`;
    return SAFE_HREF.test(href) ? `<a href="${href}">${label}</a>` : match;
  });
}

/**
 * Render the content as plain text — the "Enable Markdown = off" branch.
 * Shared so the API renderer and the web preview cannot disagree about it.
 */
export function renderPlainText(source: string, options: RenderMarkdownOptions = {}): string {
  const styled = options.styled ?? true;
  const margin = styled ? 'margin:0 0 10px; ' : '';
  return `<p style="${margin}white-space:pre-wrap;">${escapeHtml(source)}</p>`;
}

export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
  const styled = options.styled ?? true;
  const escaped = escapeHtml(source).replace(/\r\n?/g, '\n');

  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    // inline() runs per line, THEN the lines are joined, so the renderer's own
    // `<br>` can never be swallowed into a link href by the INLINE regex.
    const html = paragraph.map(line => inline(line, styled)).join('<br>');
    out.push(`<p${attr(P_STYLE, styled)}>${html}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const items = list.items.map(item => `<li>${inline(item, styled)}</li>`).join('');
    out.push(`<${tag}${attr(LIST_STYLE, styled)}>${items}</${tag}>`);
    list = null;
  };

  for (const raw of escaped.split('\n')) {
    const line = raw.trim();

    if (!line) {
      // Deliberately does NOT flush the list: a blank line between bullets keeps
      // one list, matching CommonMark's loose lists. Only a non-list line ends it.
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      out.push(
        `<h${level}${attr(H_STYLE[level]!, styled)}>${inline(heading[2]!, styled)}</h${level}>`,
      );
      continue;
    }

    // The optional-content form keeps an empty bullet (`- `) an empty list item
    // rather than a stray paragraph containing a dash.
    const bullet = /^[-*](?:\s+(.*))?$/.exec(line);
    const ordered = /^\d+[.)](?:\s+(.*))?$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !!ordered;
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push((bullet?.[1] ?? ordered?.[1]) || '');
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return out.join('\n');
}
