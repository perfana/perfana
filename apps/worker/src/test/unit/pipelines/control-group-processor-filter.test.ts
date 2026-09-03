import { describe, it, expect } from 'vitest';
import type { Logger } from 'pino';
import { ControlGroupProcessor } from '../../../pipelines/helpers/adapt/control-group-processor.js';

/**
 * buildValidDashboardFilterSQL() is a pure string builder whose only value is the SHAPE of the
 * SQL it emits. It used to be `IN (a) OR IN (b)`; an OR between two subqueries cannot be pulled
 * up into a semi-join, so Postgres emitted `(hashed SubPlan 1) OR (hashed SubPlan 2)` and
 * re-evaluated both per candidate row — 102 s and 5.2 M buffer hits on the ADAPT insert path.
 *
 * Nothing else in the suite referenced this method, so without these assertions the rewrite can
 * be reverted by anyone "simplifying" the UNION back into an OR, with the suite still green.
 */
describe('buildValidDashboardFilterSQL', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
  const sql = new ControlGroupProcessor(logger).buildValidDashboardFilterSQL();

  it('emits a single IN over a UNION, never an OR of two subqueries', () => {
    expect(sql.match(/\bIN\s*\(/g)).toHaveLength(1);
    expect(sql).toContain('UNION');
    expect(sql).not.toMatch(/\bOR\b/);
  });

  it('excludes NULL dynatrace dashboard ids', () => {
    // application_dashboards.id is a PK so its arm cannot yield NULL; dynatrace_queries can.
    expect(sql).toContain('WHERE application_dashboard_id IS NOT NULL');
  });

  it('is a WHERE fragment its caller can concatenate', () => {
    // results-processor.ts pushes this straight into filterConditions.
    expect(sql.trim().startsWith('AND ')).toBe(true);
    expect((sql.match(/\(/g) ?? []).length).toBe((sql.match(/\)/g) ?? []).length);
  });
});
