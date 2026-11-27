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
