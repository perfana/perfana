import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import { DockerLogDemux, LogsService } from './logs.service';

const listContainersMock = jest.fn();
const dialMock = jest.fn();
/** One docker multiplex frame: [type, 0, 0, 0, len BE32] + payload. */
function frame(type: number, text: string): Buffer {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = type;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function collect(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = '';
    stream.on('data', (c) => (acc += c.toString()));
    stream.on('end', () => resolve(acc));
    stream.on('error', reject);
  });
}

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    listContainers: listContainersMock,
    modem: { dial: dialMock },
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
    const source = Readable.from([frame(1, 'hello\n'), frame(2, 'oops\n')]);
    dialMock.mockImplementation((_o: unknown, cb: (e: null, s: Readable) => void) => cb(null, source));
    const svc = makeService();
    const out = await svc.openLogStream('abc', { tail: 100, follow: true });
    expect(await collect(out)).toBe('hello\noops\n');
    expect(dialMock.mock.calls[0][0]).toMatchObject({ isStream: true, options: { follow: true, tail: 100 } });
  });

  it('streams a full non-follow log instead of buffering it', async () => {
    listContainersMock.mockResolvedValue([{ Id: 'abc', Names: ['/x'], State: 'running', Labels: {} }]);
    dialMock.mockImplementation((_o: unknown, cb: (e: null, s: Readable) => void) => cb(null, Readable.from([])));
    await makeService().openLogStream('abc', { tail: 'all', follow: false });
    expect(dialMock.mock.calls[0][0]).toMatchObject({ isStream: true, options: { follow: false, tail: 'all' } });
  });

  it('rejects when the docker modem reports an error', async () => {
    listContainersMock.mockResolvedValue([{ Id: 'abc', Names: ['/x'], State: 'running', Labels: {} }]);
    dialMock.mockImplementation((_o: unknown, cb: (e: Error) => void) => cb(new Error('no such container')));
    await expect(makeService().openLogStream('abc', { tail: 'all', follow: false })).rejects.toThrow('no such container');
  });

  it('destroys the docker stream when the consumer closes, and forwards a source error', async () => {
    listContainersMock.mockResolvedValue([{ Id: 'abc', Names: ['/x'], State: 'running', Labels: {} }]);
    const source = new PassThrough();
    dialMock.mockImplementation((_o: unknown, cb: (e: null, s: Readable) => void) => cb(null, source));
    const out = await makeService().openLogStream('abc', { tail: 'all', follow: false });
    out.destroy();
    await new Promise((r) => setImmediate(r));
    expect(source.destroyed).toBe(true);

    const source2 = new PassThrough();
    dialMock.mockImplementation((_o: unknown, cb: (e: null, s: Readable) => void) => cb(null, source2));
    const out2 = await makeService().openLogStream('abc', { tail: 'all', follow: false });
    const failed = collect(out2);
    source2.destroy(new Error('socket reset'));
    await expect(failed).rejects.toThrow('socket reset');
  });
});

describe('DockerLogDemux', () => {
  it('reassembles frames split across chunks and drops the headers', async () => {
    const bytes = Buffer.concat([frame(1, 'abc'), frame(2, 'defgh'), frame(1, '')]);
    const demux = new DockerLogDemux();
    const done = collect(demux);
    for (let i = 0; i < bytes.length; i += 3) demux.write(bytes.subarray(i, i + 3));
    demux.end();
    expect(await done).toBe('abcdefgh');
  });

  it('passes a TTY (unframed) stream through untouched', async () => {
    const demux = new DockerLogDemux();
    const done = collect(demux);
    demux.write(Buffer.from('plain text line\n'));
    demux.end(Buffer.from('more\n'));
    expect(await done).toBe('plain text line\nmore\n');

    // A control byte first is still raw when the 3 pad bytes are not zero.
    const ctl = new DockerLogDemux();
    const ctlDone = collect(ctl);
    ctl.end(Buffer.from('\x01abcdefghij'));
    expect(await ctlDone).toBe('\x01abcdefghij');
  });

  it('does not drop a TTY log shorter than a frame header, or a truncated trailing frame', async () => {
    const short = new DockerLogDemux();
    const shortDone = collect(short);
    short.end(Buffer.from('hi\n'));
    expect(await shortDone).toBe('hi\n');

    const cut = new DockerLogDemux();
    const cutDone = collect(cut);
    cut.end(Buffer.concat([frame(1, 'complete\n'), frame(1, 'cut off').subarray(0, 12)]));
    expect(await cutDone).toBe('complete\ncut ');
  });

  it('applies backpressure instead of buffering a fast source', () => {
    const demux = new DockerLogDemux({ highWaterMark: 64 });
    // Nobody reads: writes must report a full buffer so pipe() pauses the docker source.
    let ok = true;
    for (let i = 0; i < 50 && ok; i++) ok = demux.write(frame(1, 'x'.repeat(32)));
    expect(ok).toBe(false);
  });
});
