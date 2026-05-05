import { buildSystemConnectionPreamble } from './system-connection';

describe('buildSystemConnectionPreamble', () => {
  it.each(['worker', 'grafana-sync', 'perfana-report', 'audit-partition-manager'] as const)(
    'produces 5 statements for actor=%s',
    actor => {
      const stmts = buildSystemConnectionPreamble(actor);
      expect(stmts).toHaveLength(5);
      expect(stmts[0]).toBe('SET ROLE perfana_system');
      expect(stmts[1]).toBe(`SELECT set_config('app.current_user_id', 'system:${actor}', false)`);
      expect(stmts[2]).toBe(`SELECT set_config('app.current_user_roles', '["super-admin"]', false)`);
      expect(stmts[3]).toBe(`SELECT set_config('app.current_user_organizations', '[]', false)`);
      expect(stmts[4]).toBe(`SELECT set_config('app.current_user_teams', '[]', false)`);
    },
  );

  it('includes the actor identity literally in user_id GUC', () => {
    const stmts = buildSystemConnectionPreamble('worker');
    expect(stmts[1]).toContain(`'system:worker'`);
  });
});
