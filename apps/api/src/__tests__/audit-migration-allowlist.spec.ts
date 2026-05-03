import * as fs from 'fs';
import * as path from 'path';

/**
 * The audit-mutation-must-log ESLint rule reads
 * apps/api/.audit-migration-allowlist.json on every lint run. Every entry must
 * be a real file at the recorded path — a typo or stale entry would silently
 * un-grandfather a service. This smoke test makes those failure modes loud.
 */
describe('apps/api/.audit-migration-allowlist.json', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const allowlistPath = path.join(repoRoot, 'apps/api/.audit-migration-allowlist.json');

  let raw: string;
  let parsed: unknown;

  beforeAll(() => {
    raw = fs.readFileSync(allowlistPath, 'utf8');
    parsed = JSON.parse(raw);
  });

  it('exists and is valid JSON', () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('is an array of strings', () => {
    expect(Array.isArray(parsed)).toBe(true);
    for (const entry of parsed as unknown[]) {
      expect(typeof entry).toBe('string');
    }
  });

  it('every entry resolves to an existing file', () => {
    for (const rel of parsed as string[]) {
      const abs = path.join(repoRoot, rel);
      expect(fs.existsSync(abs)).toBe(true);
    }
  });

  it('contains no duplicates', () => {
    const arr = parsed as string[];
    expect(new Set(arr).size).toBe(arr.length);
  });

  it('every entry uses forward-slash POSIX paths', () => {
    for (const rel of parsed as string[]) {
      expect(rel.includes('\\')).toBe(false);
    }
  });

  it('every entry lives under apps/api/src', () => {
    for (const rel of parsed as string[]) {
      expect(rel.startsWith('apps/api/src/')).toBe(true);
    }
  });
});
