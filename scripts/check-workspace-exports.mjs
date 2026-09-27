#!/usr/bin/env node
/**
 * Fails when an import names an internal workspace subpath that the package's
 * `exports` map does not declare.
 *
 * Every app maps `"@perfana/shared/*": ["../../packages/shared/src/*"]` in its tsconfig
 * `paths`. An undeclared subpath resolves through that alias to a `.ts` file under
 * `packages/shared/src`, and because that file is outside the app's `rootDir`, tsc
 * emits a RELATIVE require to where it thinks the output will land. Reproduce it:
 *
 *   # point the import at an undeclared subpath, then
 *   cd apps/grafana-sync && npx nest build
 *   grep duplicate-slo-target dist/src/modules/auto-config/auto-config-updates.service.js
 *   # → require("../../../../../packages/shared/src/utils/duplicate-slo-target")
 *
 * A DECLARED subpath stays bare in that same build (`require("@perfana/shared/utils")`),
 * so the image's `packages/shared/dist` satisfies it. The relative one points at
 * `packages/shared/src`, which the image does not contain, and the service exits at boot
 * with MODULE_NOT_FOUND naming that exact path. `nest-cli.json` has `"webpack": false`,
 * so this is plain tsc — no bundler is involved. v0.2.96.15 shipped it in grafana-sync
 * with lint, type-check and 11k unit tests all green: jest maps the same alias, so no
 * test can see it either.
 *
 * The legal set is not a list maintained here. It is derived from each package's own
 * `exports` map, which is what Node consults at runtime: add an export and the import
 * becomes legal with no edit to this file.
 *
 * Scanned: the working tree AND `HEAD`. A pre-push gate that read only the working tree
 * would pass a branch whose COMMITTED code is broken but whose worktree is already fixed,
 * and that broken commit is what ships.
 *
 * Known limits, all in the direction of a missed import rather than a false block:
 *   - A `"./*"` wildcard export is taken at face value; the target is not resolved on
 *     disk, so such a key legalises its whole subtree.
 *   - A specifier built at runtime (`require(base + name)`) is invisible, as it is to
 *     every other static check.
 *   - A declared export whose `default` points at a file the build never emits needs a
 *     real build to catch, not a static read.
 *
 *   node scripts/check-workspace-exports.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES_DIR = 'packages';
const SOURCE_GLOBS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'];
// git ls-files alone is ~160 kB on this repo and git grep output is larger; the 1 MB
// default would start failing pushes with ENOBUFS as the repo grows.
const MAX_BUFFER = 64 * 1024 * 1024;

const problems = new Map();
const notes = [];

const fail = (msg) => {
  console.error(`\nworkspace exports check FAILED\n\n${msg}\n`);
  process.exit(1);
};

// Resolve the repo root and run every git command there. `git ls-files` and `git grep`
// are both cwd-relative, so invoking this from a subdirectory would otherwise scan a
// fraction of the repo and find no packages at all.
let root;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
  fail('Not inside a git repository (git rev-parse --show-toplevel failed).');
}

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', cwd: root, maxBuffer: MAX_BUFFER });

// ---------------------------------------------------------------------------
// Build the legal specifier set from each workspace package's exports map
// ---------------------------------------------------------------------------

/** @type {Map<string, {legal: Set<string>, blocked: Set<string>, wildcards: Array<[string,string]>, manifest: string}>} */
const packages = new Map();

const manifests = git('ls-files', '-z', '--', `${PACKAGES_DIR}/*/package.json`)
  .split('\0')
  .filter(Boolean);

for (const manifest of manifests) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  } catch (e) {
    // JSON.parse does not name the file it choked on, and a raw stack trace in the
    // middle of a push tells the developer nothing actionable.
    fail(`Could not read ${manifest}: ${e && e.message ? e.message : e}`);
  }
  if (!pkg.name) continue;

  if (!pkg.exports) {
    notes.push(`${pkg.name} (${manifest}) declares no exports map — its subpaths are NOT checked`);
    continue;
  }

  const legal = new Set();
  const blocked = new Set();
  const wildcards = [];

  // Two legal sugar forms are not subpath maps: a bare string ("exports": "./x.js")
  // and conditions at the root ("exports": {"types": …, "default": …}). Treating
  // either as a key set invents subpaths and rejects the root import.
  const isSubpathMap =
    typeof pkg.exports === 'object' &&
    !Array.isArray(pkg.exports) &&
    Object.keys(pkg.exports).some((k) => k.startsWith('.'));

  if (!isSubpathMap) {
    legal.add(pkg.name);
  } else {
    for (const [key, target] of Object.entries(pkg.exports)) {
      if (!key.startsWith('.')) continue; // a condition name sitting beside subpaths
      const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, '')}`;
      const stars = (specifier.match(/\*/g) || []).length;
      if (stars > 1) {
        notes.push(`${manifest}: ignoring exports key "${key}" — more than one "*"`);
        continue;
      }
      // `"./internal/*": null` is how Node BLOCKS a subpath. Reading it as legal would
      // wave through the one thing the package author explicitly forbade.
      const set = target === null ? blocked : legal;
      if (stars === 1) {
        const [prefix, suffix = ''] = specifier.split('*');
        if (target !== null) wildcards.push([prefix, suffix]);
        else blocked.add(specifier);
      } else {
        set.add(specifier);
      }
    }
  }
  packages.set(pkg.name, { legal, blocked, wildcards, manifest });
}

if (packages.size === 0) {
  // Never the green branch: this repo has workspace packages, so an empty set means the
  // scan was misconfigured, not that everything is fine.
  fail(
    `No workspace package under ${PACKAGES_DIR}/ declares a name.\n` +
      'That is a misconfigured scan, not a pass.',
  );
}

const isLegal = (specifier, { legal, blocked, wildcards }) => {
  if (blocked.has(specifier)) return false;
  if (legal.has(specifier)) return true;
  return wildcards.some(
    ([prefix, suffix]) =>
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      // The star must match at least one character, or "@perfana/shared/" passes.
      specifier.length > prefix.length + suffix.length,
  );
};

// Longest name first, so a package whose name is a prefix of another cannot claim the
// other's specifiers just by being listed first.
const owners = [...packages.keys()].sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------------------
// Scan the working tree and HEAD for imports of those packages
// ---------------------------------------------------------------------------

// `from '…'` covers import and re-export; `require(` / `import(` cover the call forms;
// a bare `import '…'` is a side-effect import, which tsc preserves verbatim and is
// therefore exactly the shape that reaches runtime. The paren forms come first so
// `import(` is never consumed by the bare alternative.
const SPECIFIER =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;

/**
 * Drop lines that are prose, and trailing `//` comments, before matching. Three doc
 * comments in packages/shared already read `//   import { X } from '@perfana/shared/…'`;
 * without this, consolidating one of those exports would turn every push in the repo
 * into a hard failure telling the developer to fix an import that does not exist.
 */
const codeOf = (line) => {
  const trimmed = line.trimStart();
  if (/^(\/\/|\*|\/\*|#|>)/.test(trimmed)) return '';
  // Cut at `//`, but not at the `//` in a scheme like https:// .
  const at = line.search(/(^|[^:])\/\//);
  return at === -1 ? line : line.slice(0, line.indexOf('//', at));
};

const scan = (ref) => {
  const args = ['-c', 'core.quotepath=false', 'grep', '-I', '-n', '-z', '-F'];
  for (const name of owners) args.push('-e', name);
  if (ref) args.push(ref);
  // Source files only. Without this, a code sample in a markdown doc is a hard push
  // block: docs/superpowers/plans/2026-07-15-compare-normalized-url.md and
  // packages/shared/GRAFANA_SHARED_CODE_GUIDE.md both quote `@perfana/shared/dist/…`.
  args.push('--', ...SOURCE_GLOBS);
  let out;
  try {
    out = git(...args);
  } catch (e) {
    // git grep exits 1 when nothing matched, which is not an error here.
    if (e && e.status === 1) return;
    throw e;
  }
  for (const record of out.split('\n')) {
    if (!record) continue;
    const [rawPath, lineNo, ...rest] = record.split('\0');
    const content = rest.join('\0');
    if (lineNo === undefined) continue;
    const path = ref ? rawPath.slice(ref.length + 1) : rawPath;
    for (const match of codeOf(content).matchAll(SPECIFIER)) {
      const specifier = match[1];
      const owner = owners.find((n) => specifier === n || specifier.startsWith(`${n}/`));
      if (!owner) continue;
      if (isLegal(specifier, packages.get(owner))) continue;
      if (!problems.has(specifier)) problems.set(specifier, { owner, sites: new Set() });
      problems.get(specifier).sites.add(`${path}:${lineNo}${ref ? ` (in ${ref})` : ''}`);
    }
  }
};

scan(null);
scan('HEAD');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (problems.size === 0) {
  console.log(`workspace exports check OK (${[...packages.keys()].join(', ')})`);
  for (const n of notes) console.log(`  · ${n}`);
  process.exit(0);
}

console.error('\nworkspace exports check FAILED\n');
console.error('Imported subpaths that no package `exports` map declares:\n');
for (const [specifier, { owner, sites }] of problems) {
  console.error(`  - ${specifier}`);
  for (const site of sites) console.error(`      ${site}`);
  const { legal, blocked, manifest } = packages.get(owner);
  console.error(`      declared by ${manifest}: ${[...legal].sort().join(', ')}`);
  if (blocked.has(specifier)) console.error('      NOTE: that subpath is explicitly blocked (null target)');
}
console.error(
  '\nThese resolve through the tsconfig `@perfana/*` path alias, so tsc and jest accept\n' +
    'them, but in a compiled service (api, worker, grafana-sync, perfana-report) tsc emits\n' +
    'a relative require into packages/shared/src, which the built image does not contain,\n' +
    'and the service exits at boot with MODULE_NOT_FOUND.\n' +
    'Import a declared subpath, or add this one to the package `exports` map\n' +
    '(types / development / default, as the neighbouring entries do).\n' +
    '\nA hit in apps/web, in a spec file, or in an `import type` cannot fail at runtime —\n' +
    'Next bundles from source, jest maps the alias, and a type import is erased. It is\n' +
    'still refused: one undeclared subpath per package surface is what the last outage\n' +
    'was, and "it happens to be erased here" is not a property the next edit preserves.\n',
);
for (const n of notes) console.error(`  · ${n}`);
console.error('');
process.exit(1);
