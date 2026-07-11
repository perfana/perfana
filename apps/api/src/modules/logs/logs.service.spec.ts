import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import { LogsService } from './logs.service';

const listContainersMock = jest.fn();
const getContainerMock = jest.fn();
const demuxStreamMock = jest.fn((src: Readable, out: NodeJS.WritableStream) => {
  src.on('data', (c) => (out as PassThrough).write(c));
  src.on('end', () => (out as PassThrough).end());
});

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    listContainers: listContainersMock,
    getContainer: getContainerMock,
    modem: { demuxStream: demuxStreamMock },
  })),
);

function makeService() {
  const config = { get: (k: string, d?: string) => (k === 'LOG_VIEWER_COMPOSE_PROJECT' ? 'perfana' : d) };
  return new LogsService(config as unknown as ConfigService);
}

describe('LogsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists only perfana-project containers, mapped to {id,name,service,state}', async () => {
    listContainersMock.mockResolvedValue([
      { Id: 'abc', Names: ['/perfana-api-1'], State: 'running', Labels: { 'com.docker.compose.service': 'api' } },
    ]);
    const svc = makeService();
    const result = await svc.listContainers();
    expect(listContainersMock).toHaveBeenCalledWith({
      all: false,
      filters: { label: ['com.docker.compose.project=perfana'] },
    });
    expect(result).toEqual([{ id: 'abc', name: 'perfana-api-1', service: 'api', state: 'running' }]);
  });

  it('rejects a container id not in the allowlist', async () => {
    listContainersMock.mockResolvedValue([]);
    const svc = makeService();
    await expect(svc.openLogStream('nope', { tail: 100, follow: false })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a demuxed stream for an allowed id', async () => {
    listContainersMock.mockResolvedValue([
      { Id: 'abc', Names: ['/perfana-api-1'], State: 'running', Labels: { 'com.docker.compose.service': 'api' } },
    ]);
    const source = Readable.from([Buffer.from('hello\n')]);
    getContainerMock.mockReturnValue({ logs: jest.fn().mockResolvedValue(source) });
    const svc = makeService();
    const out = await svc.openLogStream('abc', { tail: 100, follow: true });
    const text = await new Promise<string>((resolve) => {
      let acc = '';
      out.on('data', (c) => (acc += c.toString()));
      out.on('end', () => resolve(acc));
    });
    expect(text).toBe('hello\n');
  });
});
