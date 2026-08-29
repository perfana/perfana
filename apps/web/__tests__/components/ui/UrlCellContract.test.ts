/**
 * The call-site half of the URL-clipping contract.
 *
 * `ClippedUrl` used to carry its own `maxWidth: 360` so it could not blow out a
 * table no matter who rendered it. That cap was the wrong instrument — it cut
 * URLs off while most of a wide column sat empty — so it was removed, and the
 * constraint moved out to `URL_CELL_SX` on the TableCell.
 *
 * That trade is deliberate, but it converts an invariant the component enforced
 * on its own into a convention each call site has to remember. Forgetting it is
 * invisible to every other gate: it type-checks, it lints, it renders, and jsdom
 * performs no layout so no render test can see the difference. The only symptom
 * is a table that widens past the viewport in a real browser and pushes the
 * measurement columns off screen — exactly the bug the cap was added for.
 *
 * So this is a source scan, not a render test. It is the only mechanism that can
 * catch this class of mistake before a human sees the page.
 *
 * Scope: a `ClippedUrl` rendered inside a MUI `TableCell` must have `URL_CELL_SX` — or
 * `URL_CELL_MAX_WIDTH_SX`, its half for tables that size their own columns — on that cell.
 * A `ClippedUrl` outside a table is not covered —
 * CSS grid tracks (`minmax(180px, 2fr)`) already cap their own width, which is
 * why the compare view's grid-based URL row is legitimately not in scope.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/** apps/web — this file lives at apps/web/__tests__/components/ui/. */
const WEB_ROOT = join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['app', 'components'];

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (entry.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Index just past the `>` that closes the JSX opening tag starting at `start`.
 *
 * Brace depth and quotes are tracked so that a `>` inside an sx expression
 * (`sx={{ '&:hover': ... }}`) or inside a string is not mistaken for the end of
 * the tag — the opening tags in question routinely span several lines.
 */
function endOfOpeningTag(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

const TOKEN = /<TableCell\b|<\/TableCell>|<ClippedUrl\b/g;

/**
 * Either half of the contract satisfies it. A table whose header already assigns every column a
 * width wants `URL_CELL_MAX_WIDTH_SX` alone — adding `width: '100%'` there would compete with
 * those percentages instead of complementing them.
 */
const CONSTRAINT = /URL_CELL_(MAX_WIDTH_)?SX/;

/** Walks one file's JSX, tracking enclosing TableCells, and reports unconstrained URL cells. */
function findViolations(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('<ClippedUrl')) return [];

  const stack: { tag: string; line: number }[] = [];
  const violations: string[] = [];

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(src)) !== null) {
    if (match[0] === '</TableCell>') {
      stack.pop();
      continue;
    }

    if (match[0].startsWith('<TableCell')) {
      const end = endOfOpeningTag(src, match.index);
      const tag = src.slice(match.index, end);
      TOKEN.lastIndex = end;
      // A self-closing cell has no children, so it can never contain a ClippedUrl.
      if (!tag.endsWith('/>')) stack.push({ tag, line: lineOf(src, match.index) });
      continue;
    }

    const cell = stack[stack.length - 1];
    if (cell && !CONSTRAINT.test(cell.tag)) {
      violations.push(
        `${relative(WEB_ROOT, file)}:${lineOf(src, match.index)} — ClippedUrl sits in the ` +
          `TableCell opened on line ${cell.line}, whose sx carries neither URL_CELL_SX nor ` +
          `URL_CELL_MAX_WIDTH_SX. Without one of them the cell reports the full URL width as ` +
          `the column's intrinsic width and the table blows out. Add \`...URL_CELL_SX\` to ` +
          `that cell's sx, or \`...URL_CELL_MAX_WIDTH_SX\` if the table's header already ` +
          `assigns every column a width.`
      );
    }
  }

  return violations;
}

describe('ClippedUrl call sites constrain their table cell', () => {
  const files = SCAN_DIRS.flatMap((d) => collectTsx(join(WEB_ROOT, d)));
  const urlCellFiles = files.filter((f) => {
    const src = readFileSync(f, 'utf8');
    return src.includes('<ClippedUrl') && src.includes('<TableCell');
  });

  it('finds the URL tables it is supposed to be guarding', () => {
    // Guards the guard: if a refactor moves these components and the scan silently
    // matches nothing, the contract test above would pass vacuously forever.
    expect(urlCellFiles.length).toBeGreaterThanOrEqual(5);
  });

  it('puts URL_CELL_SX on every TableCell that renders a ClippedUrl', () => {
    expect(files.flatMap(findViolations)).toEqual([]);
  });
});
