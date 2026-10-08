/**
 * A dashboard whose panels reference a datasource template variable (`${datasource}`).
 * Grafana resolves it to a concrete uid from the variable's `current.value`; Perfana has to
 * do the same before the query is stored, or /api/ds/query answers "Data source not found"
 * for every query on the dashboard (issue #657).
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createPanelDocuments } from '../../../pipelines/panels/helpers.js';
import { testRunFixtures } from '../../fixtures/test-data.js';

const requestedUids: string[] = [];

/** The datasources the mocked Grafana instance knows about, by uid. */
const DATASOURCES: Record<string, { id: number; uid: string; name: string; type: string }> = {
  'prometheus-main': { id: 7, uid: 'prometheus-main', name: 'Prometheus', type: 'prometheus' },
  'loki-main': { id: 9, uid: 'loki-main', name: 'Loki', type: 'loki' },
  'prometheus-override': {
    id: 11,
    uid: 'prometheus-override',
    name: 'Prometheus (override)',
    type: 'prometheus'
  },
  'prom-a': { id: 13, uid: 'prom-a', name: 'Prometheus A', type: 'prometheus' }
};

vi.mock('../../../config/grafana-client-factory.js', () => ({
  createGrafanaClient: vi.fn(async () => ({
    getDatasourceByUid: vi.fn(async (uid: string) => {
      requestedUids.push(uid);
      return DATASOURCES[uid] ?? null;
    })
  }))
}));

function perfanaData(options: {
  templating: unknown[];
  panels: unknown[];
  appDashboardVariables?: { name: string; values: string[] }[];
}) {
  const testRun = testRunFixtures.basic();
  return {
    test_run_id: testRun.test_run_id,
    test_run: testRun,
    application_dashboards: [
      {
        id: 'app-dash-ecommerce',
        name: 'E-commerce API Dashboard',
        system_under_test_id: 'ecommerce-api',
        test_environment: 'staging',
        workload: 'load-test',
        dashboard_uid: 'templated-ds-abc123',
        dashboard_label: 'Templated datasource',
        variables: options.appDashboardVariables ?? []
      }
    ],
    benchmarks: [],
    dashboards: [
      {
        id: 'grafana-templated-001',
        uid: 'templated-ds-abc123',
        title: 'Templated datasource',
        grafana_instance_id: 'instance-1',
        dashboard: {
          dashboard: {
            id: 1,
            uid: 'templated-ds-abc123',
            title: 'Templated datasource',
            templating: { list: options.templating },
            panels: options.panels
          }
        }
      }
    ]
  };
}

function perfanaDataWithTemplatedDatasource(
  variableCurrentValue: string | undefined,
  appDashboardVariables?: { name: string; values: string[] }[]
) {
  return perfanaData({
    templating: [
      {
        name: 'datasource',
        type: 'datasource',
        query: 'prometheus',
        ...(variableCurrentValue === undefined
          ? {}
          : { current: { text: 'Prometheus', value: variableCurrentValue } })
      }
    ],
    panels: [
      {
        id: 2,
        title: 'Request Rate',
        type: 'timeseries',
        datasource: { type: 'prometheus', uid: '${datasource}' },
        targets: [
          {
            refId: 'A',
            expr: 'rate(http_requests_total[5m])',
            datasource: { type: 'prometheus', uid: '${datasource}' }
          }
        ]
      }
    ],
    appDashboardVariables
  });
}

type StoredRequest = { request_body: { queries: Record<string, unknown>[] } };
type PanelDoc = { requests: StoredRequest[]; query_variables: Record<string, string> };

async function runCreatePanelDocuments(data: unknown): Promise<PanelDoc[]> {
  return (await createPanelDocuments(data as never, 'ecommerce-api')) as PanelDoc[];
}

// requestedUids is module-level state written from inside the vi.mock factory. Resetting it
// here rather than in the helper keeps the isolation from depending on every test calling the
// helper first — which a concurrent run would break.
beforeEach(() => {
  requestedUids.length = 0;
});

describe('templated datasource (${datasource})', () => {
  // Both ref forms Grafana writes. The bare `$name` form is the shape older dashboards carry,
  // and it exercises the second alternation of TEMPLATE_REF_RE plus the `?? match?.[2]` fallback.
  test.each(['${datasource}', '$datasource'])('resolves the %s ref form', async (ref) => {
    const data = perfanaDataWithTemplatedDatasource('prometheus-main');
    const panel = data.dashboards[0].dashboard.dashboard.panels[0] as Record<string, unknown>;
    panel.datasource = { type: 'prometheus', uid: ref };
    (panel.targets as Record<string, unknown>[])[0].datasource = { type: 'prometheus', uid: ref };

    const docs = await runCreatePanelDocuments(data);
    const query = docs[0].requests[0].request_body.queries[0];

    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'prometheus-main' });
    expect(query.datasourceId).toBe(7);
    expect(requestedUids).toEqual(['prometheus-main']);
  });

  test('resolves to the concrete uid and numeric datasourceId', async () => {
    const docs = await runCreatePanelDocuments(
      perfanaDataWithTemplatedDatasource('prometheus-main')
    );

    expect(docs).toHaveLength(1);
    const query = docs[0].requests[0].request_body.queries[0];

    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'prometheus-main' });
    expect(query.datasourceId).toBe(7);
    expect(docs[0].query_variables.datasource).toBe('prometheus-main');
    // The templated uid must never reach /api/datasources/uid/ — it is a guaranteed 404.
    expect(requestedUids).toEqual(['prometheus-main']);
  });

  test.each(['interval', '__interval', 'timeFilter', 'system_under_test', 'test_environment'])(
    'refuses to let a datasource variable named %s overwrite the run variable',
    async (reservedName) => {
      // Every resolved variable is substituted into the stored query. A dashboard author who
      // names a datasource variable `interval` would otherwise replace the run's own value and
      // ship a malformed or wrong-scoped query with nothing logged.
      const data = perfanaDataWithTemplatedDatasource('prometheus-main');
      const list = data.dashboards[0].dashboard.dashboard.templating.list as Record<string, unknown>[];
      list[0].name = reservedName;
      const panel = data.dashboards[0].dashboard.dashboard.panels[0] as Record<string, unknown>;
      const ref = `\${${reservedName}}`;
      panel.datasource = { type: 'prometheus', uid: ref };
      (panel.targets as Record<string, unknown>[])[0].datasource = { type: 'prometheus', uid: ref };

      const docs = await runCreatePanelDocuments(data);

      expect(docs[0].query_variables[reservedName]).not.toBe('prometheus-main');
      expect(requestedUids).toEqual([]);
      // The residue of refusing it: the ref is left in place, so the ordinary substitution
      // loop replaces it with the RUN's value and the panel ends up with a nonsense uid and
      // the generic map-miss warning. Strictly better than the run's own variable being
      // overwritten for every query on the dashboard, and pinned here so it stays deliberate.
      const query = docs[0].requests[0].request_body.queries[0];
      expect((query.datasource as { uid: string }).uid).toBe(
        docs[0].query_variables[reservedName]
      );
    }
  );

  test.each(['All', '$__all', '.*'])(
    'treats a current.value of %s as no selection, not as a uid',
    async (sentinel) => {
      const data = perfanaDataWithTemplatedDatasource(sentinel);

      const docs = await runCreatePanelDocuments(data);
      const query = docs[0].requests[0].request_body.queries[0];

      expect(query.datasource).toEqual({ type: 'prometheus', uid: '${datasource}' });
      expect(requestedUids).toEqual([]);
    }
  );

  test('does not resolve a template ref off Object.prototype', async () => {
    // `${constructor}` on a plain {} map returns a Function, which would land in a Set<string>
    // and be interpolated into the Grafana API URL.
    const data = perfanaDataWithTemplatedDatasource('prometheus-main');
    const panel = data.dashboards[0].dashboard.dashboard.panels[0] as Record<string, unknown>;
    panel.datasource = { type: 'prometheus', uid: '${constructor}' };
    (panel.targets as Record<string, unknown>[])[0].datasource = {
      type: 'prometheus',
      uid: '${constructor}'
    };

    const docs = await runCreatePanelDocuments(data);
    const query = docs[0].requests[0].request_body.queries[0];

    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${constructor}' });
    expect(requestedUids).toEqual([]);
    expect(requestedUids.every((uid) => typeof uid === 'string')).toBe(true);
  });

  test('resolves an override even when the dashboard variable has no current value', async () => {
    // The case the unresolved-variable warning tells the operator to fix. Gating the override
    // collection on the RESOLVED map made this the one case it did not cover.
    const data = perfanaDataWithTemplatedDatasource(undefined);
    data.application_dashboards[0].variables = [
      { name: 'datasource', values: ['prometheus-override'] }
    ] as never;

    const docs = await runCreatePanelDocuments(data);
    const query = docs[0].requests[0].request_body.queries[0];

    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'prometheus-override' });
    expect(query.datasourceId).toBe(11);
    expect(requestedUids).toEqual(['prometheus-override']);
  });

  test('does not send an All override to Grafana as a uid', async () => {
    // Substitution maps `All` to `.*`, so neither is ever a datasource to look up.
    const data = perfanaDataWithTemplatedDatasource('prometheus-main');
    data.application_dashboards[0].variables = [
      { name: 'datasource', values: ['All'] }
    ] as never;

    await runCreatePanelDocuments(data);

    expect(requestedUids).toEqual(['prometheus-main']);
  });

  test('leaves the uid alone when the variable has no current value', async () => {
    const docs = await runCreatePanelDocuments(perfanaDataWithTemplatedDatasource(undefined));

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${datasource}' });
    // Nothing resolved it, so the unresolved-variable branch keeps the literal as the id
    // rather than silently sending a query Grafana will reject without a tell.
    expect(query.datasourceId).toBe('${datasource}');
    expect(requestedUids).toEqual([]);
  });

  test('takes the first selection of a multi-select datasource variable', async () => {
    // Grafana allows multi-select on a datasource variable (for repeated panels) and then
    // sends `current.value` as an array. Letting the array through makes substitution
    // stringify it as `prom-a,prom-b`, a uid Grafana cannot resolve.
    const docs = await runCreatePanelDocuments(
      perfanaData({
        templating: [
          {
            name: 'datasource',
            type: 'datasource',
            query: 'prometheus',
            current: { text: ['Prom A', 'Prom B'], value: ['prom-a', 'prom-b'] }
          }
        ],
        panels: [
          {
            id: 2,
            title: 'Request Rate',
            type: 'timeseries',
            datasource: { type: 'prometheus', uid: '${datasource}' },
            targets: [
              {
                refId: 'A',
                expr: 'rate(http_requests_total[5m])',
                datasource: { type: 'prometheus', uid: '${datasource}' }
              }
            ]
          }
        ]
      })
    );

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'prom-a' });
    expect(query.datasourceId).toBe(13);
    expect(requestedUids).toEqual(['prom-a']);
  });

  test('an empty multi-select leaves the variable unresolved rather than resolving to ""', async () => {
    const docs = await runCreatePanelDocuments(
      perfanaData({
        templating: [
          { name: 'datasource', type: 'datasource', query: 'prometheus', current: { value: [] } }
        ],
        panels: [
          {
            id: 2,
            title: 'Request Rate',
            type: 'timeseries',
            datasource: { type: 'prometheus', uid: '${datasource}' },
            targets: [
              {
                refId: 'A',
                expr: 'rate(http_requests_total[5m])',
                datasource: { type: 'prometheus', uid: '${datasource}' }
              }
            ]
          }
        ]
      })
    );

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${datasource}' });
    expect(query.datasourceId).toBe('${datasource}');
    expect(requestedUids).toEqual([]);
  });

  test('ignores a non-string current.value rather than stringifying it', async () => {
    // firstCurrentValue's `typeof first === 'string'` guard. A number here would otherwise
    // reach a Record<string, string> and substitute as "42".
    const data = perfanaDataWithTemplatedDatasource('prometheus-main');
    const variable = data.dashboards[0].dashboard.dashboard.templating.list[0] as Record<string, unknown>;
    variable.current = { text: '42', value: 42 };

    const docs = await runCreatePanelDocuments(data);
    const query = docs[0].requests[0].request_body.queries[0];

    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${datasource}' });
    expect(requestedUids).toEqual([]);
  });

  test('an application dashboard variable of the same name overrides the dashboard, with its own numeric id', async () => {
    // The pre-0.2.97.9 workaround: a `datasource` variable configured on the application
    // dashboard in Perfana. The seeded dashboard value must stay below it in queryVariables,
    // and the override's uid has to be collected too — otherwise it resolves in the target
    // and then misses the datasource map, degrading datasourceId to a string.
    const docs = await runCreatePanelDocuments(
      perfanaDataWithTemplatedDatasource('prometheus-main', [
        { name: 'datasource', values: ['prometheus-override'] }
      ])
    );

    const query = docs[0].requests[0].request_body.queries[0];
    expect(docs[0].query_variables.datasource).toBe('prometheus-override');
    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'prometheus-override' });
    expect(query.datasourceId).toBe(11);
    expect(requestedUids.sort()).toEqual(['prometheus-main', 'prometheus-override']);
  });

  test('does not send an unrelated or templated application dashboard variable to /api/datasources', async () => {
    // The override collection is gated twice: the variable must name a datasource variable of
    // the dashboard, and its value must not itself be a template ref. Without either gate,
    // every application dashboard variable value becomes a datasource uid lookup.
    const docs = await runCreatePanelDocuments(
      perfanaDataWithTemplatedDatasource('prometheus-main', [
        { name: 'pod', values: ['pod-1'] },
        { name: 'datasource', values: ['${another_variable}'] }
      ])
    );

    expect(requestedUids).toEqual(['prometheus-main']);
    // The templated override still wins at substitution time — it is the user's value — but
    // it is left unresolved rather than looked up.
    expect(docs[0].query_variables.datasource).toBe('${another_variable}');
  });

  test('does not read a non-datasource variable as a datasource uid', async () => {
    // Only `type: 'datasource'` variables carry a uid in `current.value`. A query variable's
    // current value is a metric label — substituting it into `datasource.uid` would point the
    // query at a datasource that does not exist, and resolve to a numeric id by accident.
    const docs = await runCreatePanelDocuments(
      perfanaData({
        templating: [
          { name: 'pod', type: 'query', query: 'label_values(pod)', current: { value: 'pod-1' } }
        ],
        panels: [
          {
            id: 2,
            title: 'Pod CPU',
            type: 'timeseries',
            datasource: { type: 'prometheus', uid: '${pod}' },
            targets: [
              {
                refId: 'A',
                expr: 'rate(cpu[5m])',
                datasource: { type: 'prometheus', uid: '${pod}' }
              }
            ]
          }
        ]
      })
    );

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${pod}' });
    expect(query.datasourceId).toBe('${pod}');
    expect(docs[0].query_variables.pod).toBeUndefined();
    expect(requestedUids).toEqual([]);
  });

  test('resolves a templated datasource given as a bare string, in the `$name` form', async () => {
    // Grafana 8 and earlier wrote `"datasource": "$datasource"` rather than an object — both
    // the unbraced ref and the string-valued datasource key have to be handled.
    const docs = await runCreatePanelDocuments(
      perfanaData({
        templating: [
          {
            name: 'datasource',
            type: 'datasource',
            query: 'prometheus',
            current: { text: 'Prometheus', value: 'prometheus-main' }
          }
        ],
        panels: [
          {
            id: 2,
            title: 'Request Rate',
            type: 'timeseries',
            datasource: { type: 'prometheus', uid: '${datasource}' },
            targets: [
              { refId: 'A', expr: 'rate(http_requests_total[5m])', datasource: '$datasource' }
            ]
          }
        ]
      })
    );

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toBe('prometheus-main');
    expect(query.datasourceId).toBe(7);
    expect(requestedUids).toEqual(['prometheus-main']);
  });

  test('resolves each datasource variable independently when a dashboard has several', async () => {
    // resolveDatasourceVariables builds a map keyed by variable name — it must not collapse
    // to the first datasource variable on the dashboard.
    const docs = await runCreatePanelDocuments(
      perfanaData({
        templating: [
          {
            name: 'ds_metrics',
            type: 'datasource',
            query: 'prometheus',
            current: { text: 'Prometheus', value: 'prometheus-main' }
          },
          {
            name: 'ds_logs',
            type: 'datasource',
            query: 'loki',
            current: { text: 'Loki', value: 'loki-main' }
          }
        ],
        panels: [
          {
            id: 2,
            title: 'Request Rate',
            type: 'timeseries',
            datasource: { type: 'prometheus', uid: '${ds_metrics}' },
            targets: [
              {
                refId: 'A',
                expr: 'rate(http_requests_total[5m])',
                datasource: { type: 'prometheus', uid: '${ds_metrics}' }
              }
            ]
          },
          {
            id: 3,
            title: 'Error Log Rate',
            type: 'timeseries',
            datasource: { type: 'loki', uid: '${ds_logs}' },
            targets: [
              {
                refId: 'A',
                expr: '{app="api"} |= "error"',
                datasource: { type: 'loki', uid: '${ds_logs}' }
              }
            ]
          }
        ]
      })
    );

    expect(docs).toHaveLength(2);

    const metrics = docs[0].requests[0].request_body.queries[0];
    expect(metrics.datasource).toEqual({ type: 'prometheus', uid: 'prometheus-main' });
    expect(metrics.datasourceId).toBe(7);

    const logs = docs[1].requests[0].request_body.queries[0];
    expect(logs.datasource).toEqual({ type: 'loki', uid: 'loki-main' });
    expect(logs.datasourceId).toBe(9);

    expect(requestedUids.sort()).toEqual(['loki-main', 'prometheus-main']);
  });

  test('a Grafana 8 datasource NAME in current.value degrades to the string uid', async () => {
    // Grafana 8 and earlier stored the datasource *name* here. It is substituted (so the
    // query carries a name, not a template ref) but misses the uid map, which is the
    // documented pre-fix behaviour — there is no lookup by name on this path.
    const docs = await runCreatePanelDocuments(
      perfanaDataWithTemplatedDatasource('Prometheus')
    );

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'Prometheus' });
    expect(query.datasourceId).toBe('Prometheus');
    expect(requestedUids).toEqual(['Prometheus']);
  });

  test('a corrupted target datasource falls back to the panel ref, which is not substituted', async () => {
    // The corrupted-datasource fallback reads `panel.datasource.uid` off the raw panel, which
    // substitution never touched — so a templated panel uid stays a literal on this path even
    // though the variable resolves. Narrow (it needs an already-corrupt dashboard import) and
    // pinned here so a change in either direction is visible.
    const docs = await runCreatePanelDocuments(
      perfanaData({
        templating: [
          {
            name: 'datasource',
            type: 'datasource',
            query: 'prometheus',
            current: { text: 'Prometheus', value: 'prometheus-main' }
          }
        ],
        panels: [
          {
            id: 2,
            title: 'Request Rate',
            type: 'timeseries',
            datasource: { type: 'prometheus', uid: '${datasource}' },
            targets: [
              { refId: 'A', expr: 'rate(http_requests_total[5m])', datasource: { type: 'prometheus' } }
            ]
          }
        ]
      })
    );

    const query = docs[0].requests[0].request_body.queries[0];
    // The pre-flight collection DID resolve the ref off the panel, so the uid was fetched.
    expect(requestedUids).toEqual(['prometheus-main']);
    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${datasource}' });
    expect(query.datasourceId).toBe('${datasource}');
  });
});
