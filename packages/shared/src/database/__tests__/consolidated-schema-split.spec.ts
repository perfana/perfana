// These specs live OUTSIDE src/database/migrations on purpose: that directory is globbed
// as migrations by Dockerfile.migrations, apps/api/src/data-source.ts and the RLS test
// harness — a compiled *.spec.js there gets require()d as a migration and dies on
// describe() ("Cannot add a test after tests have started" / "describe is not defined").
import { ConsolidatedSchema1700000000000 } from '../migrations/1700000000000-ConsolidatedSchema';
import { SCHEMA_SQL } from '../migrations/schema-sql';

// splitStatements is private; the split behaviour is what the migration lives or
// dies on, so reach it directly rather than standing up a query runner.
const split = (sql: string): string[] =>
  (
    new ConsolidatedSchema1700000000000() as unknown as {
      splitStatements(sql: string): string[];
    }
  ).splitStatements(sql);

describe('ConsolidatedSchema splitStatements', () => {
  it('keeps a semicolon inside a quoted literal in its statement', () => {
    const sql = "COMMENT ON COLUMN t.c IS 'kept because x; no longer written';\nSELECT 1;";
    expect(split(sql)).toEqual([
      "COMMENT ON COLUMN t.c IS 'kept because x; no longer written';",
      'SELECT 1;',
    ]);
  });

  it('handles a doubled quote escape inside a literal', () => {
    const sql = "COMMENT ON COLUMN t.c IS 'it''s fine; really';\nSELECT 1;";
    expect(split(sql)).toHaveLength(2);
  });

  it('does not open a dollar-quote inside a string literal', () => {
    // the $$ check must respect inSingleQuote, or 'a$$b' opens a phantom body
    expect(split("SELECT 'a$$b; c';\nSELECT 1;")).toEqual(["SELECT 'a$$b; c';", 'SELECT 1;']);
  });

  it('ignores quoted semicolons inside a $$ body', () => {
    // the quote tracker must stay off inside $$, or the body's literal desyncs it
    expect(
      split("CREATE FUNCTION f() RETURNS void AS $$ SELECT 'a;b'; $$ LANGUAGE sql;\nSELECT 1;"),
    ).toHaveLength(2);
  });

  it('does not let an indented comment apostrophe poison quote tracking', () => {
    // the line filter only drops column-0 comments; an indented `-- don't`
    // reaching the parser must not toggle inSingleQuote and swallow the rest
    const sql = "SELECT 1;\n  -- don't trip on this\nSELECT 2;\nSELECT 3;";
    expect(split(sql)).toEqual(['SELECT 1;', 'SELECT 2;', 'SELECT 3;']);
  });

  it('strips a trailing inline comment without eating the statement', () => {
    const sql = "SELECT 1; -- don't trip here either\nSELECT 2;";
    expect(split(sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('keeps -- sequences inside literals and $$ bodies', () => {
    expect(split("SELECT 'a--b';\nSELECT 1;")).toEqual(["SELECT 'a--b';", 'SELECT 1;']);
    expect(
      split('CREATE FUNCTION f() RETURNS void AS $$ -- inner\nSELECT 1; $$ LANGUAGE sql;\nSELECT 2;'),
    ).toHaveLength(2);
  });

  it('still splits on $$ function bodies', () => {
    const sql = 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN; END; $$ LANGUAGE plpgsql;\nSELECT 1;';
    expect(split(sql)).toHaveLength(2);
  });

  it('keeps the real schema dump COMMENT that contains a semicolon intact', () => {
    // requests_raw.parent_controllers: "...still read through it; no longer
    // written by any listener." A splitter that ignores quotes cuts it at the
    // semicolon and the migration dies on an unterminated string (42601).
    const comment = split(SCHEMA_SQL).filter((s) =>
      s.includes('public.requests_raw.parent_controllers IS'),
    );
    expect(comment).toHaveLength(1);
    expect(comment[0]).toMatch(/no longer written by any listener\.';$/);
  });
});
