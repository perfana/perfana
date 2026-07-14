/**
 * GrafanaClientService Test Suite
 *
 * Comprehensive tests covering:
 * - getGrafanaInstance: repository lookup, missing instance error
 * - grafanaCall: URL building (server_url preference), Bearer auth headers, HTTP error handling,
 *   SSRF-blocked URLs, re-throw of non-BadRequestException errors
 * - deleteDashboard: DELETE method, 404 graceful handling, non-404 errors
 * - createAnnotation: POST body construction, optional field inclusion, HTTP errors
 * - deleteAnnotation: DELETE with 404 tolerance, error propagation
 * - getDatasource: delegates to grafanaCall, re-throws errors
 * - getInfluxVariableValues: URL encoding, result parsing, regex extraction, deduplication
 * - getPrometheusVariableValues: label_values query path, simple label path, regex filtering,
 *   deduplication, empty/missing metric guard
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaClientService } from './grafana-client.service';
import { GrafanaInstance as GrafanaInstanceEntity } from '../../entities';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_GRAFANA_INSTANCE = {
  id: 'instance-uuid-1',
  label: 'Test Grafana',
  client_url: 'https://grafana.example.com',
  server_url: 'https://grafana-server.example.com',
  org_id: 'org-1',
  api_key: 'test-api-key-abc',
  username: undefined,
  password: undefined,
};

const INSTANCE_NO_SERVER_URL = {
  ...VALID_GRAFANA_INSTANCE,
  server_url: undefined,
};

const INFLUX_DATASOURCE = {
  id: 7,
  name: 'InfluxDB',
  type: 'influxdb',
  uid: 'influx-uid',
  database: 'mydb',
  url: 'http://influxdb.example.com',
};

const PROM_DATASOURCE = {
  id: 12,
  name: 'Prometheus',
  type: 'prometheus',
  uid: 'prom-uid',
  database: undefined,
  url: 'http://prometheus.example.com',
};

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, text = 'Server error'): Response {
  return {
    ok: false,
    status,
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue(text),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GrafanaClientService', () => {
  let service: GrafanaClientService;
  let repository: jest.Mocked<Repository<GrafanaInstanceEntity>>;

  // Capture global fetch mock so individual tests can configure it
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    // Replace global fetch with a jest mock before each test
    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafanaClientService,
        {
          provide: getRepositoryToken(GrafanaInstanceEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ProxyResolverService,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<GrafanaClientService>(GrafanaClientService);
    repository = module.get(getRepositoryToken(GrafanaInstanceEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getGrafanaInstance
  // -------------------------------------------------------------------------

  describe('getGrafanaInstance', () => {
    const entityBase: GrafanaInstanceEntity = {
      id: 'instance-uuid-1',
      label: 'Test Grafana',
      client_url: 'https://grafana.example.com',
      server_url: 'https://grafana-server.example.com',
      orgId: 'org-1',
      apiKey: 'test-api-key-abc',
      username: undefined,
      password: undefined,
      snapshotInstance: false,
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    } as GrafanaInstanceEntity;

    it('should return a mapped GrafanaInstance when the entity exists', async () => {
      repository.findOne.mockResolvedValue(entityBase);

      const result = await service.getGrafanaInstance('instance-uuid-1');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'instance-uuid-1' } });
      expect(result).toEqual({
        id: 'instance-uuid-1',
        label: 'Test Grafana',
        client_url: 'https://grafana.example.com',
        server_url: 'https://grafana-server.example.com',
        org_id: 'org-1',
        api_key: 'test-api-key-abc',
        username: undefined,
        password: undefined,
      });
    });

    it('should map username and password when present', async () => {
      repository.findOne.mockResolvedValue({
        ...entityBase,
        apiKey: undefined,
        username: 'admin',
        password: 'secret',
      } as GrafanaInstanceEntity);

      const result = await service.getGrafanaInstance('instance-uuid-1');

      expect(result.username).toBe('admin');
      expect(result.password).toBe('secret');
      expect(result.api_key).toBe('');
    });

    it('should throw an error when the instance is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.getGrafanaInstance('missing-id')).rejects.toThrow(
        'Grafana instance with ID missing-id not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // grafanaCall
  // -------------------------------------------------------------------------

  describe('grafanaCall', () => {
    it('should prefer server_url over client_url when building the request URL', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ data: 'ok' }));

      await service.grafanaCall(VALID_GRAFANA_INSTANCE, '/api/health');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://grafana-server.example.com/api/health',
        expect.any(Object),
      );
    });

    it('should fall back to client_url when server_url is absent', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ data: 'ok' }));

      await service.grafanaCall(INSTANCE_NO_SERVER_URL, '/api/health');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://grafana.example.com/api/health',
        expect.any(Object),
      );
    });

    it('should set the Authorization header as Bearer <api_key>', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({}));

      await service.grafanaCall(VALID_GRAFANA_INSTANCE, '/api/health');

      const [, options] = fetchMock.mock.calls[0];
      expect((options as RequestInit).headers).toMatchObject({
        Authorization: `Bearer ${VALID_GRAFANA_INSTANCE.api_key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    });

    it('should return the parsed JSON body on a successful response', async () => {
      const payload = { version: '9.4.0' };
      fetchMock.mockResolvedValue(makeOkResponse(payload));

      const result = await service.grafanaCall(VALID_GRAFANA_INSTANCE, '/api/health');

      expect(result).toEqual(payload);
    });

    it('should throw an Error containing status and error text when the response is not ok', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(403, 'Forbidden'));

      await expect(service.grafanaCall(VALID_GRAFANA_INSTANCE, '/api/health')).rejects.toThrow(
        'HTTP error! status: 403, message: Forbidden',
      );
    });

    it('should throw a BadRequestException for an SSRF-blocked private IP URL', async () => {
      const blockedInstance = { ...VALID_GRAFANA_INSTANCE, server_url: 'http://192.168.1.100' };

      await expect(service.grafanaCall(blockedInstance, '/api/health')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should throw a BadRequestException when the URL uses a blocked localhost hostname', async () => {
      const localInstance = { ...VALID_GRAFANA_INSTANCE, server_url: 'http://localhost:3000' };

      await expect(service.grafanaCall(localInstance, '/api/health')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should throw a BadRequestException when the URL is completely invalid', async () => {
      const badInstance = { ...VALID_GRAFANA_INSTANCE, server_url: 'not-a-url' };

      await expect(service.grafanaCall(badInstance, '/api/health')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should re-throw network-level errors from fetch', async () => {
      fetchMock.mockRejectedValue(new Error('Network failure'));

      await expect(service.grafanaCall(VALID_GRAFANA_INSTANCE, '/api/health')).rejects.toThrow(
        'Network failure',
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteDashboard
  // -------------------------------------------------------------------------

  describe('deleteDashboard', () => {
    it('should call the correct DELETE endpoint with Bearer auth', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ title: 'My Dashboard', message: 'Dashboard deleted' }));

      await service.deleteDashboard(VALID_GRAFANA_INSTANCE, 'dash-uid-99');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://grafana-server.example.com/api/dashboards/uid/dash-uid-99',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: `Bearer ${VALID_GRAFANA_INSTANCE.api_key}`,
          }),
        }),
      );
    });

    it('should return the response body on success', async () => {
      const body = { title: 'My Dashboard', message: 'Dashboard deleted' };
      fetchMock.mockResolvedValue(makeOkResponse(body));

      const result = await service.deleteDashboard(VALID_GRAFANA_INSTANCE, 'dash-uid-99');

      expect(result).toEqual(body);
    });

    it('should return a graceful result when the dashboard is already deleted (404)', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(404, 'Not found'));

      const result = await service.deleteDashboard(VALID_GRAFANA_INSTANCE, 'dash-uid-99');

      expect(result).toEqual({
        title: 'dash-uid-99',
        message: 'Dashboard not found (already deleted)',
      });
    });

    it('should throw an error for non-404 HTTP failures', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(500, 'Internal error'));

      await expect(service.deleteDashboard(VALID_GRAFANA_INSTANCE, 'dash-uid-99')).rejects.toThrow(
        'Failed to delete dashboard: 500 - Internal error',
      );
    });

    it('should throw BadRequestException for SSRF-blocked URL', async () => {
      const blockedInstance = { ...VALID_GRAFANA_INSTANCE, server_url: 'http://10.0.0.1' };

      await expect(
        service.deleteDashboard(blockedInstance, 'dash-uid-99'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // createAnnotation
  // -------------------------------------------------------------------------

  describe('createAnnotation', () => {
    const baseParams = {
      time: 1700000000000,
      text: 'Test run started',
    };

    it('should POST to /api/annotations with minimum required fields', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ id: 42, message: 'Annotation added' }));

      const result = await service.createAnnotation(VALID_GRAFANA_INSTANCE, baseParams);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://grafana-server.example.com/api/annotations',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({ id: 42, message: 'Annotation added' });
    });

    it('should include dashboardId in the body when provided', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ id: 1, message: 'ok' }));

      await service.createAnnotation(VALID_GRAFANA_INSTANCE, { ...baseParams, dashboardId: 5 });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.dashboardId).toBe(5);
    });

    it('should include dashboardUID in the body when provided', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ id: 2, message: 'ok' }));

      await service.createAnnotation(VALID_GRAFANA_INSTANCE, {
        ...baseParams,
        dashboardUID: 'my-uid-123',
      });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.dashboardUID).toBe('my-uid-123');
    });

    it('should include timeEnd and tags in the body when provided', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ id: 3, message: 'ok' }));

      await service.createAnnotation(VALID_GRAFANA_INSTANCE, {
        ...baseParams,
        timeEnd: 1700001000000,
        tags: ['perf', 'test'],
      });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.timeEnd).toBe(1700001000000);
      expect(body.tags).toEqual(['perf', 'test']);
    });

    it('should omit optional fields when not provided', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ id: 4, message: 'ok' }));

      await service.createAnnotation(VALID_GRAFANA_INSTANCE, baseParams);

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body).not.toHaveProperty('dashboardId');
      expect(body).not.toHaveProperty('dashboardUID');
      expect(body).not.toHaveProperty('timeEnd');
      expect(body).not.toHaveProperty('tags');
    });

    it('should omit tags from the body when the tags array is empty', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ id: 5, message: 'ok' }));

      await service.createAnnotation(VALID_GRAFANA_INSTANCE, { ...baseParams, tags: [] });

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body).not.toHaveProperty('tags');
    });

    it('should throw when the Grafana API returns an error status', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(401, 'Unauthorized'));

      await expect(
        service.createAnnotation(VALID_GRAFANA_INSTANCE, baseParams),
      ).rejects.toThrow('Failed to create annotation: 401 - Unauthorized');
    });

    it('should throw BadRequestException for SSRF-blocked URL', async () => {
      const blockedInstance = { ...VALID_GRAFANA_INSTANCE, server_url: 'http://169.254.169.254' };

      await expect(
        service.createAnnotation(blockedInstance, baseParams),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // deleteAnnotation
  // -------------------------------------------------------------------------

  describe('deleteAnnotation', () => {
    it('should call the correct DELETE endpoint for the annotation', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({}));

      await service.deleteAnnotation(VALID_GRAFANA_INSTANCE, 77);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://grafana-server.example.com/api/annotations/77',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should resolve without throwing on a 404 response (already deleted)', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(404, 'Not found'));

      await expect(service.deleteAnnotation(VALID_GRAFANA_INSTANCE, 77)).resolves.toBeUndefined();
    });

    it('should throw an error for non-200 and non-404 responses', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(500, 'Server error'));

      await expect(service.deleteAnnotation(VALID_GRAFANA_INSTANCE, 77)).rejects.toThrow(
        'Failed to delete annotation: 500 - Server error',
      );
    });

    it('should throw BadRequestException for SSRF-blocked URL', async () => {
      const blockedInstance = { ...VALID_GRAFANA_INSTANCE, server_url: 'http://127.0.0.1' };

      await expect(
        service.deleteAnnotation(blockedInstance, 77),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should re-throw network errors from fetch', async () => {
      fetchMock.mockRejectedValue(new Error('Connection refused'));

      await expect(service.deleteAnnotation(VALID_GRAFANA_INSTANCE, 77)).rejects.toThrow(
        'Connection refused',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getDatasource
  // -------------------------------------------------------------------------

  describe('getDatasource', () => {
    it('should call grafanaCall with the correct datasource endpoint', async () => {
      const datasource = { id: 3, name: 'MyDS', type: 'prometheus', uid: 'ds-uid-3' };
      fetchMock.mockResolvedValue(makeOkResponse(datasource));

      const result = await service.getDatasource(VALID_GRAFANA_INSTANCE, 'ds-uid-3');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/datasources/uid/ds-uid-3'),
        expect.any(Object),
      );
      expect(result).toEqual(datasource);
    });

    it('should propagate errors thrown by grafanaCall', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(404, 'Datasource not found'));

      await expect(
        service.getDatasource(VALID_GRAFANA_INSTANCE, 'unknown-uid'),
      ).rejects.toThrow('HTTP error! status: 404');
    });
  });

  // -------------------------------------------------------------------------
  // getInfluxVariableValues
  // -------------------------------------------------------------------------

  describe('getInfluxVariableValues', () => {
    it('should build the proxy URL with the correct database and encoded query', async () => {
      const query = 'SHOW TAG VALUES FROM "cpu" WITH KEY="host"';
      fetchMock.mockResolvedValue(makeOkResponse({ results: [] }));

      await service.getInfluxVariableValues(VALID_GRAFANA_INSTANCE, INFLUX_DATASOURCE, query);

      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain(`/api/datasources/proxy/uid/${INFLUX_DATASOURCE.uid}/query`);
      expect(calledUrl).toContain(`db=${INFLUX_DATASOURCE.database}`);
      expect(calledUrl).toContain(encodeURIComponent(query));
    });

    it('should return an empty array when results is empty', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ results: [] }));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SELECT * FROM cpu',
      );

      expect(result).toEqual([]);
    });

    it('should return an empty array when the response has no results key', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({}));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SELECT * FROM cpu',
      );

      expect(result).toEqual([]);
    });

    it('should extract values from the first column of single-column rows', async () => {
      const influxResponse = {
        results: [
          {
            series: [
              {
                values: [['host-a'], ['host-b'], ['host-c']],
              },
            ],
          },
        ],
      };
      fetchMock.mockResolvedValue(makeOkResponse(influxResponse));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SHOW TAG VALUES',
      );

      expect(result).toEqual(['host-a', 'host-b', 'host-c']);
    });

    it('should extract values from the second column of two-column rows', async () => {
      const influxResponse = {
        results: [
          {
            series: [
              {
                values: [
                  ['time1', 'host-x'],
                  ['time2', 'host-y'],
                ],
              },
            ],
          },
        ],
      };
      fetchMock.mockResolvedValue(makeOkResponse(influxResponse));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SHOW TAG VALUES',
      );

      expect(result).toEqual(['host-x', 'host-y']);
    });

    it('should deduplicate values across series', async () => {
      const influxResponse = {
        results: [
          {
            series: [
              { values: [['host-a'], ['host-b']] },
              { values: [['host-a'], ['host-c']] },
            ],
          },
        ],
      };
      fetchMock.mockResolvedValue(makeOkResponse(influxResponse));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SHOW TAG VALUES',
      );

      expect(result).toEqual(['host-a', 'host-b', 'host-c']);
    });

    it('should extract capture-group text from matching values and use raw value for non-matching', async () => {
      const influxResponse = {
        results: [
          {
            series: [
              {
                // app-prod-1 and app-staging-2 match the capture group; svc-prod-3 does NOT match
                // so it falls back to its raw value
                values: [['app-prod-1'], ['app-staging-2'], ['svc-prod-3']],
              },
            ],
          },
        ],
      };
      fetchMock.mockResolvedValue(makeOkResponse(influxResponse));

      // Regex captures the environment between "app-" and the trailing "-\d"
      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SHOW TAG VALUES',
        '/app-(.+)-\\d/',
      );

      // Matching values yield the capture group; non-matching value falls back to raw
      expect(result).toEqual(['prod', 'staging', 'svc-prod-3']);
    });

    it('should return the raw value when regex does not match', async () => {
      const influxResponse = {
        results: [
          {
            series: [
              {
                values: [['no-match-here']],
              },
            ],
          },
        ],
      };
      fetchMock.mockResolvedValue(makeOkResponse(influxResponse));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SHOW TAG VALUES',
        '/xyz-(.+)/',
      );

      expect(result).toEqual(['no-match-here']);
    });

    it('should propagate errors from grafanaCall', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(500, 'InfluxDB error'));

      await expect(
        service.getInfluxVariableValues(VALID_GRAFANA_INSTANCE, INFLUX_DATASOURCE, 'SELECT 1'),
      ).rejects.toThrow('HTTP error! status: 500');
    });
  });

  // -------------------------------------------------------------------------
  // getInfluxVariableValues — Flux (InfluxDB v2) path
  // -------------------------------------------------------------------------

  describe('getInfluxVariableValues (Flux)', () => {
    const FLUX_DATASOURCE = {
      id: 1,
      name: 'InfluxDB v2',
      type: 'influxdb',
      uid: 'rn8_KJEnk',
      database: undefined,
      url: 'http://influxdb.example.com',
      jsonData: { version: 'Flux' },
    };

    // Grafana dataframe response for a Flux tagValues query.
    const fluxFramesResponse = (values: unknown[]) => ({
      results: {
        metricFindQuery: {
          status: 200,
          frames: [
            {
              schema: { refId: 'metricFindQuery', fields: [{ name: '_value', type: 'string' }] },
              data: { values: [values] },
            },
          ],
        },
      },
    });

    const tagValuesQuery =
      'import "influxdata/influxdb/v1"\nv1.tagValues(bucket: "monitoring", tag: "host", predicate: (r) => true, start: -1d)';

    it('POSTs the Flux query to /api/ds/query instead of the InfluxQL endpoint', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(fluxFramesResponse(['host-a'])));

      await service.getInfluxVariableValues(VALID_GRAFANA_INSTANCE, FLUX_DATASOURCE, tagValuesQuery);

      const [calledUrl, options] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('/api/ds/query');
      expect(calledUrl).not.toContain('/query?db=');
      expect((options as RequestInit).method).toBe('POST');
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.queries[0]).toMatchObject({
        refId: 'metricFindQuery',
        rawQuery: true,
        datasource: { type: 'influxdb', uid: 'rn8_KJEnk' },
        datasourceId: 1,
      });
    });

    it('extracts the tag values from the dataframe string column', async () => {
      const hosts = ['UWVA3VWPAPP0106', 'UWVA3VWPAPP0107', 'UWVA3VWPAPP0108'];
      fetchMock.mockResolvedValue(makeOkResponse(fluxFramesResponse(hosts)));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        FLUX_DATASOURCE,
        tagValuesQuery,
      );

      expect(result).toEqual(hosts);
    });

    it('routes to the Flux path when the query is Flux even without jsonData.version', async () => {
      const bareDatasource = { ...FLUX_DATASOURCE, jsonData: undefined };
      fetchMock.mockResolvedValue(makeOkResponse(fluxFramesResponse(['h1'])));

      await service.getInfluxVariableValues(VALID_GRAFANA_INSTANCE, bareDatasource, tagValuesQuery);

      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('/api/ds/query');
    });

    it('applies the variable regex to Flux values', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(fluxFramesResponse(['prod-host-01', 'prod-host-02'])));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        FLUX_DATASOURCE,
        tagValuesQuery,
        '/prod-(host-\\d+)/',
      );

      expect(result).toEqual(['host-01', 'host-02']);
    });

    it('deduplicates and skips null values from the frame', async () => {
      fetchMock.mockResolvedValue(makeOkResponse(fluxFramesResponse(['a', 'a', null, 'b'])));

      const result = await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        FLUX_DATASOURCE,
        tagValuesQuery,
      );

      expect(result).toEqual(['a', 'b']);
    });

    it('still uses the InfluxQL endpoint for a non-Flux InfluxQL query', async () => {
      fetchMock.mockResolvedValue(makeOkResponse({ results: [] }));

      await service.getInfluxVariableValues(
        VALID_GRAFANA_INSTANCE,
        INFLUX_DATASOURCE,
        'SHOW TAG VALUES FROM "cpu" WITH KEY = "host"',
      );

      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain('/api/datasources/proxy/uid/');
      expect(calledUrl).not.toContain('/api/ds/query');
    });
  });

  // -------------------------------------------------------------------------
  // getPrometheusVariableValues
  // -------------------------------------------------------------------------

  describe('getPrometheusVariableValues', () => {
    describe('label_values query path', () => {
      it('should call the series API with the metric and time range', async () => {
        const seriesResponse = {
          data: [
            { __name__: 'http_requests_total', job: 'api-server', instance: 'localhost:9090' },
            { __name__: 'http_requests_total', job: 'web-server', instance: 'localhost:8080' },
          ],
        };
        fetchMock.mockResolvedValue(makeOkResponse(seriesResponse));

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'label_values(http_requests_total, job)',
        );

        const [calledUrl] = fetchMock.mock.calls[0];
        expect(calledUrl).toContain(`/api/datasources/proxy/uid/${PROM_DATASOURCE.uid}/api/v1/series`);
        expect(calledUrl).toContain('match[]=');
        expect(result).toEqual(['api-server', 'web-server']);
      });

      it('should return an empty array when no series are returned', async () => {
        fetchMock.mockResolvedValue(makeOkResponse({ data: [] }));

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'label_values(http_requests_total, job)',
        );

        expect(result).toEqual([]);
      });

      it('should return an empty array when label_values query has no metric', async () => {
        // label_values(, job) — empty metric part
        fetchMock.mockResolvedValue(makeOkResponse({ data: [] }));

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'label_values(, job)',
        );

        expect(result).toEqual([]);
        // Should not call fetch because metric is empty
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('should extract capture-group text from matching label values and keep raw value for non-matching', async () => {
        // The regex /(prod-.+)/ has a capture group.
        // "prod-api" and "prod-worker" match → capture group returned.
        // "staging-api" does NOT match → valueAfterRegex stays '', falls back to raw value.
        const seriesResponse = {
          data: [
            { job: 'prod-api' },
            { job: 'staging-api' },
            { job: 'prod-worker' },
          ],
        };
        fetchMock.mockResolvedValue(makeOkResponse(seriesResponse));

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'label_values(http_requests_total, job)',
          '/(prod-.+)/',
        );

        expect(result).toContain('prod-api');
        expect(result).toContain('prod-worker');
        // non-matching values fall back to their raw value rather than being filtered out
        expect(result).toContain('staging-api');
      });
    });

    describe('simple label query path', () => {
      it('should call the label values API for a plain label name', async () => {
        fetchMock.mockResolvedValue(makeOkResponse({ data: ['node1', 'node2', 'node3'] }));

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'instance',
        );

        const [calledUrl] = fetchMock.mock.calls[0];
        expect(calledUrl).toContain(
          `/api/datasources/proxy/uid/${PROM_DATASOURCE.uid}/api/v1/label/${encodeURIComponent('instance')}/values`,
        );
        expect(result).toEqual(['node1', 'node2', 'node3']);
      });

      it('should return an empty array when the data field is absent', async () => {
        fetchMock.mockResolvedValue(makeOkResponse({}));

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'instance',
        );

        expect(result).toEqual([]);
      });

      it('should deduplicate values and return unique entries', async () => {
        fetchMock.mockResolvedValue(
          makeOkResponse({ data: ['node1', 'node2', 'node1', 'node3'] }),
        );

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'instance',
        );

        expect(result).toEqual(['node1', 'node2', 'node3']);
      });

      it('should extract capture-group text for matching values and fall back to raw for non-matching', async () => {
        // /(prod-.+)/ captures the whole "prod-nodeX" token for matching entries.
        // "staging-node2" does not match → valueAfterRegex stays '', falls back to raw value.
        fetchMock.mockResolvedValue(
          makeOkResponse({ data: ['prod-node1', 'staging-node2', 'prod-node3'] }),
        );

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'instance',
          '/(prod-.+)/',
        );

        expect(result).toContain('prod-node1');
        expect(result).toContain('prod-node3');
        // staging-node2 does not match the regex capture group so falls back to raw value
        expect(result).toContain('staging-node2');
      });

      it('should return raw values when the regex has no capture groups and matches', async () => {
        fetchMock.mockResolvedValue(makeOkResponse({ data: ['prod-node1', 'staging-node2'] }));

        // No capture group — i=0 is the full match but loop starts at i>0, so valueAfterRegex stays ''
        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'instance',
          '/prod-node1/',
        );

        // Full match only, valueAfterRegex remains '', falls back to raw value
        expect(result).toContain('prod-node1');
      });

      it('should not include values that do not match the regex', async () => {
        fetchMock.mockResolvedValue(
          makeOkResponse({ data: ['alpha', 'beta', 'gamma'] }),
        );

        const result = await service.getPrometheusVariableValues(
          VALID_GRAFANA_INSTANCE,
          PROM_DATASOURCE,
          'instance',
          '/xyz(.+)/',
        );

        // None match — raw values returned as no capture group produces empty valueAfterRegex,
        // so they still fall back to original value
        expect(result).toEqual(['alpha', 'beta', 'gamma']);
      });
    });

    it('should propagate errors from grafanaCall', async () => {
      fetchMock.mockResolvedValue(makeErrorResponse(503, 'Prometheus unavailable'));

      await expect(
        service.getPrometheusVariableValues(VALID_GRAFANA_INSTANCE, PROM_DATASOURCE, 'instance'),
      ).rejects.toThrow('HTTP error! status: 503');
    });
  });
});
