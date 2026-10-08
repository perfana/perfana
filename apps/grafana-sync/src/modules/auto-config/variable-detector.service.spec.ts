/**
 * A query variable's OWN datasource can itself be a template ref. On a dashboard that leaves
 * its datasource to a variable, Grafana writes `datasource: { uid: '${datasource}' }` onto
 * every query variable — so the lookup has to resolve the ref first or it 404s against the
 * literal, the caller swallows the throw, and the variable is stored with no values (#657).
 */

jest.mock('@perfana/shared/entities', () => ({
  TestRun: class TestRun {},
  GrafanaDashboard: class GrafanaDashboard {},
  GrafanaInstance: class GrafanaInstance {},
  ProxyServer: class ProxyServer {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { VariableDetectorService } from './variable-detector.service';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

describe('VariableDetectorService — templated datasource on a query variable', () => {
  let service: VariableDetectorService;
  let grafanaApiService: jest.Mocked<GrafanaApiService>;
  let loggerWarnSpy: jest.SpyInstance;

  const instance = { label: 'Grafana Production' } as never;

  const dashboardWith = (currentValue?: unknown): never =>
    ({
      name: 'Test Dashboard',
      grafanaJson: {
        dashboard: {
          templating: {
            list: [
              {
                name: 'datasource',
                type: 'datasource',
                query: 'prometheus',
                ...(currentValue === undefined ? {} : { current: { value: currentValue } }),
              },
            ],
          },
        },
      },
    }) as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VariableDetectorService,
        {
          provide: GrafanaApiService,
          useValue: {
            getDatasourceByUidWithLabel: jest.fn(),
            getDatasourceByNameWithLabel: jest.fn(),
            postByLabel: jest.fn().mockResolvedValue({ data: { result: [] } }),
            getByLabel: jest.fn().mockResolvedValue({ data: [] }),
          },
        },
      ],
    }).compile();

    service = module.get(VariableDetectorService);
    grafanaApiService = module.get(GrafanaApiService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.clearAllMocks());

  it('resolves ${datasource} to the concrete uid before looking it up', async () => {
    grafanaApiService.getDatasourceByUidWithLabel.mockResolvedValue({
      uid: 'prometheus-main',
      type: 'prometheus',
      name: 'Prometheus',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: '${datasource}' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(grafanaApiService.getDatasourceByUidWithLabel).toHaveBeenCalledWith(
      'Grafana Production',
      'prometheus-main',
    );
    expect(grafanaApiService.getDatasourceByUidWithLabel).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('$'),
    );
  });

  it('skips the lookup entirely when the ref cannot be resolved', async () => {
    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith(undefined),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: '${datasource}' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(result).toEqual([]);
    expect(grafanaApiService.getDatasourceByUidWithLabel).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('did not resolve'));
  });

  it('resolves a legacy bare-string "$datasource" instead of looking it up by name', async () => {
    grafanaApiService.getDatasourceByUidWithLabel.mockResolvedValue({
      uid: 'prometheus-main',
      type: 'prometheus',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      { name: 'pod', type: 'query', datasource: '$datasource', query: 'label_values(pod)' },
      'label_values(pod)',
    );

    expect(grafanaApiService.getDatasourceByUidWithLabel).toHaveBeenCalledWith(
      'Grafana Production',
      'prometheus-main',
    );
    expect(grafanaApiService.getDatasourceByNameWithLabel).not.toHaveBeenCalled();
  });

  it('still looks a real datasource NAME up by name', async () => {
    grafanaApiService.getDatasourceByNameWithLabel.mockResolvedValue({
      uid: 'influx-uid',
      type: 'influxdb',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      { name: 'pod', type: 'query', datasource: 'InfluxDB', query: 'SHOW TAG VALUES' },
      'SHOW TAG VALUES',
    );

    expect(grafanaApiService.getDatasourceByNameWithLabel).toHaveBeenCalledWith(
      'Grafana Production',
      'InfluxDB',
    );
  });

  it('passes a concrete uid through untouched', async () => {
    grafanaApiService.getDatasourceByUidWithLabel.mockResolvedValue({
      uid: 'prometheus-uid',
      type: 'prometheus',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: 'prometheus-uid' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(grafanaApiService.getDatasourceByUidWithLabel).toHaveBeenCalledWith(
      'Grafana Production',
      'prometheus-uid',
    );
  });
});
