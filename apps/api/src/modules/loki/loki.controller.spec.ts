import { BadRequestException } from '@nestjs/common';
import { LokiController } from './loki.controller';

// Value: protects=label-value lookups take only a Loki label name, so `..` cannot reach another resource path on the datasource; fails_when=the label check is removed; why_new=review fix, no controller spec existed; seam=none; no_claim=Grafana's own path handling
describe('LokiController label values', () => {
  const ID = '00000000-0000-4000-8000-000000000001';
  const ctx = { userId: 'u', roles: [] } as never;
  const service = { listLabelValues: jest.fn(async () => ['a']) };
  const controller = new LokiController(service as never);

  it.each(['..', '../values', 'a/b', '1abc', ''])('refuses %p as a label name', (label) => {
    expect(() => controller.listLabelValues(ID, label, ctx)).toThrow(BadRequestException);
    expect(service.listLabelValues).not.toHaveBeenCalled();
  });

  it('passes a label name through', async () => {
    await expect(controller.listLabelValues(ID, 'service_name', ctx)).resolves.toEqual(['a']);
    expect(service.listLabelValues).toHaveBeenCalledWith(ID, 'service_name', 'u', [], expect.any(Number), undefined);
  });
});

// Value: protects=panel-links refuses an empty or over-255-char service before the service runs (the column is varchar(255)); fails_when=the guard is removed or the bound moves; why_new=new route; seam=none; no_claim=the global ValidationPipe
describe('LokiController panel links', () => {
  const ctx = { userId: 'u', roles: ['r'] } as never;
  const service = { runPanelLinks: jest.fn(async () => []) };
  const controller = new LokiController(service as never);
  beforeEach(() => service.runPanelLinks.mockClear());

  it.each([['empty', ''], ['256 characters', 'a'.repeat(256)], ['absent', undefined]])('refuses a %s service', (_name, value) => {
    expect(() => controller.runPanelLinks('run-1', value as never, ctx)).toThrow(BadRequestException);
    expect(service.runPanelLinks).not.toHaveBeenCalled();
  });

  it('passes 1 and 255 characters through, with the caller', () => {
    controller.runPanelLinks('run-1', '(none)', ctx);
    controller.runPanelLinks('run-1', 'a'.repeat(255), ctx);
    expect(service.runPanelLinks).toHaveBeenNthCalledWith(1, 'run-1', '(none)', 'u', ['r']);
    expect(service.runPanelLinks).toHaveBeenCalledTimes(2);
  });
});
