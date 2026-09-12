import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogsController } from './logs.controller';
import { PassThrough } from 'stream';
import { gunzipSync } from 'zlib';
import { LogsService } from './logs.service';

function make(enabled: string) {
  const config = { get: (k: string, d?: string) => (k === 'LOG_VIEWER_ENABLED' ? enabled : d) } as unknown as ConfigService;
  const service = {
    listContainers: jest.fn().mockResolvedValue([{ id: 'a', name: 'perfana-api-1', service: 'api', state: 'running' }]),
    openLogStream: jest.fn(),
  } as unknown as LogsService;
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

  function fakeRes(headersSent = false) {
    const res = new PassThrough();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    Object.assign(res, { set: jest.fn(), headersSent, status, json, removeHeader: jest.fn() });
    const destroy = jest.spyOn(res, 'destroy');
    res.on('error', () => undefined); // a real PassThrough re-emits destroy(err)
    return { res, status, json, destroy };
  }

  it('downloads the full log gzipped with an attachment filename', async () => {
    const { ctrl, service } = make('true');
    const src = new PassThrough();
    (service.openLogStream as jest.Mock).mockResolvedValue(src);
    const { res } = fakeRes();
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    const ended = new Promise<void>((r) => res.on('end', () => r()));
    await ctrl.download('a', res as never);
    src.end('line1\nline2\n');
    await ended;
    expect(service.openLogStream).toHaveBeenCalledWith('a', { tail: 'all', follow: false });
    expect((res as unknown as { set: jest.Mock }).set).toHaveBeenCalledWith(expect.objectContaining({
      'Content-Type': 'application/gzip',
      'Content-Disposition': expect.stringMatching(/^attachment; filename="api-\d{4}-\d{2}-\d{2}\.log\.gz"$/),
      'X-Accel-Buffering': 'no',
    }));
    expect(gunzipSync(Buffer.concat(chunks)).toString()).toBe('line1\nline2\n');
  });

  it('refuses the download when the toggle is off, before opening anything', async () => {
    const { ctrl, service } = make('false');
    await expect(ctrl.download('a', fakeRes().res as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.openLogStream).not.toHaveBeenCalled();
  });

  it('404s an unknown container before opening a stream', async () => {
    const { ctrl, service } = make('true');
    await expect(ctrl.download('nope', fakeRes().res as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.openLogStream).not.toHaveBeenCalled();
  });

  it('falls back to the container name and sanitises it for the filename', async () => {
    const { ctrl, service } = make('true');
    (service.listContainers as jest.Mock).mockResolvedValue([{ id: 'a', name: 'odd name/1', service: '', state: 'running' }]);
    (service.openLogStream as jest.Mock).mockResolvedValue(new PassThrough());
    const { res } = fakeRes();
    await ctrl.download('a', res as never);
    expect((res as unknown as { set: jest.Mock }).set).toHaveBeenCalledWith(expect.objectContaining({
      'Content-Disposition': expect.stringMatching(/filename="odd-name-1-/),
    }));
  });

  it('answers a JSON 500 without the download headers when the source fails before headers are sent', async () => {
    const { ctrl, service } = make('true');
    const src = new PassThrough();
    (service.openLogStream as jest.Mock).mockResolvedValue(src);
    const { res, status, json, destroy } = fakeRes(false);
    await ctrl.download('a', res as never);
    src.destroy(new Error('daemon gone'));
    await new Promise((r) => setImmediate(r));
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ message: 'Log download failed' });
    expect((res as unknown as { removeHeader: jest.Mock }).removeHeader).toHaveBeenCalledWith('Content-Disposition');
    expect(destroy).not.toHaveBeenCalledWith(expect.any(Error));
  });

  it('tears the socket down when the source fails after headers are sent', async () => {
    const { ctrl, service } = make('true');
    const src = new PassThrough();
    (service.openLogStream as jest.Mock).mockResolvedValue(src);
    const { res, status, destroy } = fakeRes(true);
    await ctrl.download('a', res as never);
    const err = new Error('boom');
    src.destroy(err);
    await new Promise((r) => setImmediate(r));
    expect(destroy).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
  });

  it('destroys the source and the gzip when the client hangs up', async () => {
    const { ctrl, service } = make('true');
    const src = new PassThrough();
    (service.openLogStream as jest.Mock).mockResolvedValue(src);
    const { res } = fakeRes(true);
    await ctrl.download('a', res as never);
    res.destroy();
    await new Promise((r) => setImmediate(r));
    expect(src.destroyed).toBe(true);
  });
});
