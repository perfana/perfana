/**
 * A dashboard whose panels reference a datasource template variable (`${datasource}`).
 * Grafana resolves it to a concrete uid from the variable's `current.value`; Perfana has to
 * do the same before the query is stored, or /api/ds/query answers "Data source not found"
 * for every query on the dashboard (issue #657).
 */

import { describe, test, expect, vi } from 'vitest';
import { createPanelDocuments } from '../../../pipelines/panels/helpers.js';
import { testRunFixtures } from '../../fixtures/test-data.js';

const requestedUids: string[] = [];

vi.mock('../../../config/grafana-client-factory.js', () => ({
  createGrafanaClient: vi.fn(async () => ({
    getDatasourceByUid: vi.fn(async (uid: string) => {
      requestedUids.push(uid);
      return uid === 'prometheus-main'
        ? { id: 7, uid: 'prometheus-main', name: 'Prometheus', type: 'prometheus' }
        : null;
    })
  }))
}));

function perfanaDataWithTemplatedDatasource(variableCurrentValue: string | undefined) {
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
        variables: []
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
            templating: {
              list: [
                {
                  name: 'datasource',
                  type: 'datasource',
                  query: 'prometheus',
                  ...(variableCurrentValue === undefined
                    ? {}
                    : { current: { text: 'Prometheus', value: variableCurrentValue } })
                }
              ]
            },
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
          }
        }
      }
    ]
  };
}

type StoredRequest = { request_body: { queries: Record<string, unknown>[] } };

describe('templated datasource (${datasource})', () => {
  test('resolves to the concrete uid and numeric datasourceId', async () => {
    requestedUids.length = 0;

    const docs = (await createPanelDocuments(
      perfanaDataWithTemplatedDatasource('prometheus-main') as never,
      'ecommerce-api'
    )) as { requests: StoredRequest[]; query_variables: Record<string, string> }[];

    expect(docs).toHaveLength(1);
    const query = docs[0].requests[0].request_body.queries[0];

    expect(query.datasource).toEqual({ type: 'prometheus', uid: 'prometheus-main' });
    expect(query.datasourceId).toBe(7);
    expect(docs[0].query_variables.datasource).toBe('prometheus-main');
    // The templated uid must never reach /api/datasources/uid/ — it is a guaranteed 404.
    expect(requestedUids).toEqual(['prometheus-main']);
  });

  test('leaves the uid alone when the variable has no current value', async () => {
    requestedUids.length = 0;

    const docs = (await createPanelDocuments(
      perfanaDataWithTemplatedDatasource(undefined) as never,
      'ecommerce-api'
    )) as { requests: StoredRequest[] }[];

    const query = docs[0].requests[0].request_body.queries[0];
    expect(query.datasource).toEqual({ type: 'prometheus', uid: '${datasource}' });
    expect(requestedUids).toEqual([]);
  });
});
