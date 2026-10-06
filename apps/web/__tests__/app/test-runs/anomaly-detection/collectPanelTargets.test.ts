/**
 * `all-dashboards` scope: one panel-level config row per dashboard that has a panel
 * with this title. ds_compare_config.application_dashboard_id / panel_id are NOT NULL,
 * so there is no wildcard row to write instead.
 */
import { collectPanelTargets } from '@/app/test-runs/[id]/components/anomaly-detection/utils';

type Row = Parameters<typeof collectPanelTargets>[0][number];

const row = (
  application_dashboard_id: string,
  panel_id: string,
  panel_title: string,
  metrics_source_id?: string,
): Row => ({ application_dashboard_id, panel_id, panel_title, metrics_source_id });

describe('collectPanelTargets', () => {
  it('returns one target per (dashboard, panel), not per metric', () => {
    const targets = collectPanelTargets(
      [
        row('dash-be', '12', 'CPU usage', 'src-1'),
        row('dash-be', '12', 'CPU usage', 'src-1'), // second metric on the same panel
        row('dash-fe', '12', 'CPU usage'),
      ],
      'CPU usage',
    );

    expect(targets).toEqual([
      { application_dashboard_id: 'dash-be', panel_id: '12', metrics_source_id: 'src-1' },
      { application_dashboard_id: 'dash-fe', panel_id: '12', metrics_source_id: undefined },
    ]);
  });

  it('matches on panel title, so a different panel id on another dashboard is included', () => {
    const targets = collectPanelTargets(
      [row('dash-be', '12', 'CPU usage'), row('mariadb', '4', 'CPU usage')],
      'CPU usage',
    );

    expect(targets.map((t) => `${t.application_dashboard_id}/${t.panel_id}`)).toEqual([
      'dash-be/12',
      'mariadb/4',
    ]);
  });

  it('ignores panels with another title, including the same id on another dashboard', () => {
    const targets = collectPanelTargets(
      [row('dash-be', '12', 'CPU usage'), row('mariadb', '12', 'Connections')],
      'CPU usage',
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]!.application_dashboard_id).toBe('dash-be');
  });
});
