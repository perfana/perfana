import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';

function make(enabled: string) {
  const config = { get: (k: string, d?: string) => (k === 'LOG_VIEWER_ENABLED' ? enabled : d) } as unknown as ConfigService;
  const service = { listContainers: jest.fn().mockResolvedValue([{ id: 'a', name: 'perfana-api-1', service: 'api', state: 'running' }]) } as unknown as LogsService;
  return { ctrl: new LogsController(service, config), service };
}

describe('LogsController', () => {
  it('lists containers when enabled', async () => {
    const { ctrl } = make('true');
    await expect(ctrl.list()).resolves.toEqual([{ id: 'a', name: 'perfana-api-1', service: 'api', state: 'running' }]);
  });

  it('throws Forbidden when the toggle is off', async () => {
    const { ctrl } = make('false');
    await expect(ctrl.list()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
