import { readFileSync } from 'fs';
import { join } from 'path';
import { renderMarkdown, renderPlainText } from '../markdown';

describe('renderMarkdown', () => {
  it('renders paragraphs, keeping single newlines as line breaks', () => {
    expect(renderMarkdown('one\ntwo\n\nthree')).toContain('one<br>two');
    expect(renderMarkdown('one\ntwo\n\nthree').match(/<p /g)).toHaveLength(2);
  });

  it('renders headings, bold, italic, inline code and links', () => {
    const html = renderMarkdown(
      '## Summary\n\n**bold** and *italic* and `code` and [docs](https://perfana.io)',
    );

    expect(html).toContain('<h2 ');
    expect(html).toContain('Summary');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('>code</code>');
    expect(html).toContain('<a href="https://perfana.io">docs</a>');
  });

  it('renders bullet and ordered lists as separate lists', () => {
    const html = renderMarkdown('- a\n- b\n\n1. x\n2. y');

    expect(html).toContain('<ul');
    expect(html).toContain('<li>a</li><li>b</li>');
    expect(html).toContain('<ol');
    expect(html).toContain('<li>x</li><li>y</li>');
  });

  it('escapes author HTML before emitting any tags', () => {
    const html = renderMarkdown('<script>alert("xss")</script>\n\n<img onerror=x>');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops unsafe link protocols but keeps the visible text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');

    expect(html).not.toContain('<a href');
    expect(html).toContain('click');
  });

  it('leaves underscores alone so metric names survive', () => {
    expect(renderMarkdown('http_req_duration_p95')).toContain('http_req_duration_p95');
  });

  it('ignores a link whose label exceeds the 200-char cap', () => {
    const html = renderMarkdown(`[${'x'.repeat(201)}](https://perfana.io)`);

    expect(html).not.toContain('<a href');
  });

  it('still linkifies a label right at the cap', () => {
    const label = 'x'.repeat(200);
    const html = renderMarkdown(`[${label}](https://perfana.io)`);

    expect(html).toContain(`<a href="https://perfana.io">${label}</a>`);
  });

  it('does not degrade quadratically on many unclosed brackets', () => {
    // Unbounded `[^\]]+` backtracked to end-of-string from every stray `[`.
    // 50k of them took multiple seconds; the capped label keeps it near-instant.
    // Generous bound so this pins the complexity class, not the machine speed.
    const started = Date.now();
    renderMarkdown('['.repeat(50_000));

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns an empty string for blank input', () => {
    expect(renderMarkdown('   \n\n  ')).toBe('');
  });

  it('normalises CRLF and lone CR line endings', () => {
    // Text pasted from Windows/Excel arrives with \r\n; a stray \r must not become a literal.
    expect(renderMarkdown('one\r\ntwo')).toContain('one<br>two');
    expect(renderMarkdown('one\rtwo')).toContain('one<br>two');
    expect(renderMarkdown('- a\r\n- b')).toContain('<li>a</li><li>b</li>');
  });

  it('renders every heading level and leaves near-misses as text', () => {
    expect(renderMarkdown('# H1')).toContain('<h1 ');
    expect(renderMarkdown('###### H6')).toContain('<h6 ');
    // Seven hashes is not a heading, and neither is a hash with no space after it.
    expect(renderMarkdown('####### H7')).toContain('<p ');
    expect(renderMarkdown('####### H7')).not.toContain('<h7');
    expect(renderMarkdown('#NoSpace')).toContain('<p ');
    expect(renderMarkdown('#NoSpace')).not.toContain('<h1');
  });

  it('accepts asterisk bullets and paren-style ordered markers', () => {
    expect(renderMarkdown('* a\n* b')).toContain('<ul');
    expect(renderMarkdown('* a\n* b')).toContain('<li>a</li><li>b</li>');
    expect(renderMarkdown('1) x\n2) y')).toContain('<ol');
    expect(renderMarkdown('1) x\n2) y')).toContain('<li>x</li><li>y</li>');
  });

  it('closes the open list when the list type switches with no blank line between', () => {
    const html = renderMarkdown('- a\n1. x');

    expect(html).toContain('<ul');
    expect(html).toContain('</ul>');
    expect(html).toContain('<ol');
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<ol'));
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it('closes the open list when a paragraph or heading follows it directly', () => {
    const afterParagraph = renderMarkdown('- a\nnot a list item');
    expect(afterParagraph.indexOf('</ul>')).toBeLessThan(afterParagraph.indexOf('<p '));
    expect(afterParagraph).not.toContain('<li>not a list item</li>');

    const afterHeading = renderMarkdown('- a\n## Next');
    expect(afterHeading.indexOf('</ul>')).toBeLessThan(afterHeading.indexOf('<h2 '));
  });

  it('keeps relative, anchor, mailto and uppercase http links', () => {
    expect(renderMarkdown('[a](/reports/1)')).toContain('<a href="/reports/1">a</a>');
    expect(renderMarkdown('[a](#top)')).toContain('<a href="#top">a</a>');
    expect(renderMarkdown('[a](mailto:perf@perfana.io)')).toContain(
      '<a href="mailto:perf@perfana.io">a</a>',
    );
    expect(renderMarkdown('[a](HTTPS://Perfana.io)')).toContain('<a href="HTTPS://Perfana.io">a</a>');
  });

  it('drops data:/vbscript: hrefs and cannot be used to break out of the href attribute', () => {
    expect(renderMarkdown('[a](data:text/html,<b>)')).not.toContain('<a href');
    expect(renderMarkdown('[a](vbscript:msgbox)')).not.toContain('<a href');

    // Quotes are escaped before any tag is emitted, so an injected handler stays inert text.
    const injected = renderMarkdown('[a](/x"onmouseover="alert(1))');
    expect(injected).not.toMatch(/onmouseover="/);
    expect(injected).toContain('&quot;');
  });

  it('gives inline code precedence over bold and italic inside it', () => {
    const html = renderMarkdown('`**not bold**`');

    expect(html).toContain('<code');
    expect(html).toContain('**not bold**');
    expect(html).not.toContain('<strong>');
  });

  it('escapes ampersands and apostrophes, and flattens indented list items', () => {
    expect(renderMarkdown('tom & jerry')).toContain('tom &amp; jerry');
    expect(renderMarkdown("it's fine")).toContain('it&#039;s fine');

    // Nested lists are explicitly unsupported: indented items flatten into one list.
    const nested = renderMarkdown('- a\n  - b');
    expect(nested.match(/<ul/g)).toHaveLength(1);
    expect(nested).toContain('<li>a</li><li>b</li>');
  });

  describe('emphasis only fires on real emphasis', () => {
    it('leaves standalone asterisks alone so arithmetic and globs survive', () => {
      expect(renderMarkdown('2 * 3 * 4 = 24')).not.toContain('<em>');
      expect(renderMarkdown('2 * 3 * 4 = 24')).toContain('2 * 3 * 4 = 24');
      expect(renderMarkdown('match a * wildcard * here')).not.toContain('<em>');
    });

    it('still emphasises when the delimiters hug the text', () => {
      expect(renderMarkdown('an *italic* word')).toContain('<em>italic</em>');
      expect(renderMarkdown('a **bold** word')).toContain('<strong>bold</strong>');
    });

    it('does not emphasise when a delimiter is followed or preceded by a space', () => {
      expect(renderMarkdown('* leading space*')).not.toContain('<em>');
      expect(renderMarkdown('*trailing space *')).not.toContain('<em>');
    });
  });

  describe('malformed markdown stays literal', () => {
    it.each(['**unclosed bold', '*unclosed italic', '`unclosed code', '[label](', '[label]()'])(
      'leaves %s as text without emitting a partial tag',
      (source) => {
        expect(renderMarkdown(source)).not.toMatch(/<(strong|em|code|a)\b/);
      },
    );
  });

  it('does not truncate a url containing balanced parentheses', () => {
    // Grafana and wiki URLs routinely carry them.
    const html = renderMarkdown('[panel](https://grafana.example/d/abc/x(1))');

    expect(html).toContain('<a href="https://grafana.example/d/abc/x(1)">panel</a>');
    expect(html).not.toContain('</a>)');
  });

  it('rejects protocol-relative hrefs, which are not same-origin relative paths', () => {
    const html = renderMarkdown('[click](//evil.example/steal)');

    expect(html).not.toContain('<a href');
    expect(html).toContain('click');
  });

  it('keeps one list when a blank line separates bullets', () => {
    const html = renderMarkdown('- a\n\n- b');

    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html).toContain('<li>a</li><li>b</li>');
  });

  it('ends the list when a paragraph follows the blank line', () => {
    const html = renderMarkdown('- a\n\nback to prose');

    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html).toContain('<p');
    expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('back to prose'));
  });

  it('renders an empty bullet as an empty item, not a stray paragraph', () => {
    expect(renderMarkdown('- \n- b')).not.toContain('<p');
  });

  it('cannot leak a renderer-emitted <br> into a link href', () => {
    // inline() runs per line and the <br> is added afterwards, so the INLINE
    // regex never sees the renderer's own markup.
    const html = renderMarkdown('[x](/\rjavascript:alert(1))');

    expect(html).not.toMatch(/href="[^"]*<br>/);
  });

  it('rejects the backslash form of a protocol-relative href', () => {
    // WHATWG URL resolution treats U+005C as U+002F for special schemes, so
    // `/\evil.com` resolves off-origin exactly like `//evil.com`.
    const html = renderMarkdown('[click](/\\evil.example/steal)');

    expect(html).not.toContain('<a href');
    expect(html).toContain('click');
  });

  it('renders an empty ordered marker as an empty item, not a stray paragraph', () => {
    // The Numbered list button produces a bare `1.` on an empty field.
    const html = renderMarkdown('1. \n2. b');

    expect(html).not.toContain('<p');
    expect(html).toContain('<ol');
    expect(html).toContain('<li></li><li>b</li>');
  });

  it('uses no regex lookbehind, which is a SyntaxError on Safari before 16.4', () => {
    // This module is imported into browser code at module scope, so an
    // unsupported browser would fail to evaluate the whole chunk.
    const code = readFileSync(join(__dirname, '..', 'markdown.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\(\?<[!=]/);
  });

  describe('heading chrome', () => {
    it('neutralises the report stylesheet so a heading is not a fake section title', () => {
      // `section h2` in the report stylesheet paints the brand colour and a
      // full-width underline. An inline style attribute outranks it.
      const html = renderMarkdown('## Summary');

      expect(html).toContain('color:inherit');
      expect(html).toContain('border:0');
      expect(html).toContain('padding:0');
    });

    it('keeps h1 larger than h2 so the hierarchy reads correctly', () => {
      const h1 = /font-size:(\d+)px/.exec(renderMarkdown('# One'))![1]!;
      const h2 = /font-size:(\d+)px/.exec(renderMarkdown('## Two'))![1]!;

      expect(Number(h1)).toBeGreaterThan(Number(h2));
    });
  });

  it('never emits a script tag or an inline event handler attribute', () => {
    // The web preview injects this output into the app-origin DOM without a
    // sandbox, so this invariant is load-bearing for any new syntax added here.
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[x](javascript:alert(1))',
      '**<svg onload=alert(1)>**',
      '`<iframe src=evil>`',
      '# <body onload=alert(1)>',
    ].join('\n\n');

    const html = renderMarkdown(hostile);

    // Every real `<` in the output is one the renderer emitted, because author
    // angle brackets became &lt; first. So assert on the emitted tag set rather
    // than on substrings, which escaped text would match harmlessly.
    const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1]!.toLowerCase());
    const allowed = new Set(['p', 'br', 'strong', 'em', 'code', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

    expect([...new Set(tags)].filter((t) => !allowed.has(t))).toEqual([]);

    // And no event-handler attribute inside any emitted tag.
    for (const tag of html.match(/<[^>]*>/g) ?? []) {
      expect(tag).not.toMatch(/\son\w+\s*=/i);
    }
  });

  describe('styled: false (web preview)', () => {
    it('emits the same structure with no inline style attributes', () => {
      const html = renderMarkdown('## Summary\n\n- a\n\n`code` and **bold**', { styled: false });

      expect(html).toContain('<h2>');
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>a</li>');
      expect(html).toContain('<code>code</code>');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).not.toContain('style=');
    });

    it('keeps escaping when unstyled', () => {
      expect(renderMarkdown('<script>x</script>', { styled: false })).toContain('&lt;script&gt;');
    });
  });

  describe('renderPlainText', () => {
    it('escapes and pre-wraps, so a leading dash stays a dash', () => {
      const html = renderPlainText('- not a list\n**not bold**');

      expect(html).toContain('white-space:pre-wrap');
      expect(html).toContain('- not a list\n**not bold**');
      expect(html).not.toContain('<ul');
      expect(html).not.toContain('<strong>');
    });

    it('escapes author HTML', () => {
      expect(renderPlainText('<script>alert(1)</script>')).toContain('&lt;script&gt;');
      expect(renderPlainText('<script>alert(1)</script>')).not.toContain('<script>');
    });

    it('drops the print margin when unstyled but keeps pre-wrap', () => {
      const html = renderPlainText('a\nb', { styled: false });

      expect(html).toContain('white-space:pre-wrap');
      expect(html).not.toContain('margin:');
    });
  });
});
