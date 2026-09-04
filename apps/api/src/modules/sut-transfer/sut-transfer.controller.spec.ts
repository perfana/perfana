import { ForbiddenException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { SutTransferController } from './sut-transfer.controller';
import { SutExportService } from './sut-export.service';
import { SutImportService } from './sut-import.service';
import { ExportSutDto } from './dto/export-sut.dto';

describe('SutTransferController.export', () => {
  const sutId = '11111111-1111-1111-1111-111111111111';
  const dto = { testRunIds: [], includeOptional: true, includeRaw: false } as unknown as ExportSutDto;

  function build(enabled = 'true') {
    const stream = new PassThrough();
    // res is a plain mock, not a Writable, so a real pipe() would reject it.
    stream.pipe = jest.fn() as never;
    const exportService = { export: jest.fn().mockResolvedValue(stream) } as unknown as SutExportService;
    const importService = {} as SutImportService;
    const config = { get: jest.fn().mockReturnValue(enabled) };
    const res = {
      set: jest.fn(),
      flushHeaders: jest.fn(),
      on: jest.fn(),
      status: jest.fn(),
      destroy: jest.fn(),
      headersSent: false,
    };
    const controller = new SutTransferController(
      exportService,
      importService,
      config as never,
    );
    return { controller, res, stream, exportService };
  }

  it('refuses when the feature toggle is off', async () => {
    const { controller, res, exportService } = build('false');
    await expect(controller.export(sutId, dto, res as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(exportService.export).not.toHaveBeenCalled();
  });

  // The header is the entire fix for a production-only symptom: nginx buffers the proxied
  // response by default, which swallows the export's 2s gzip heartbeat, so the client sees
  // zero bytes for minutes and a load balancer with a total request cap kills the connection.
  // No local test or dev proxy reproduces that, so nothing else would notice its removal.
  it('disables nginx proxy buffering on the export stream', async () => {
    const { controller, res } = build();

    await controller.export(sutId, dto, res as never);

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/gzip',
        'X-Accel-Buffering': 'no',
      }),
    );
  });

  // Committing the 200 up front would close the only window the error path has to reply.
  // The X-Accel-Buffering header alone does the proxy job.
  it('does not flush headers early, so the error path keeps a window to reply', async () => {
    const { controller, res } = build();

    await controller.export(sutId, dto, res as never);

    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  // res.destroy() tears the socket down without flushing a status line, so the old
  // `res.status(500); res.destroy(err)` delivered UND_ERR_SOCKET rather than a 500 — the
  // client's `!response.ok` branch could never surface the server's message.
  it('replies 500 when the export fails before any body was sent', async () => {
    const { controller, res, stream } = build();
    const json = jest.fn();
    res.status.mockReturnValue({ json });
    await controller.export(sutId, dto, res as never);

    stream.emit('error', new Error('boom'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Export failed' }));
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('destroys the socket when the export fails after the body started', async () => {
    const { controller, res, stream } = build();
    res.headersSent = true;
    await controller.export(sutId, dto, res as never);

    const err = new Error('boom');
    stream.emit('error', err);

    // A truncated gzip cannot carry a status; an abrupt close is the only honest signal.
    expect(res.destroy).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('destroys the source stream when the client hangs up', async () => {
    const { controller, res, stream } = build();
    await controller.export(sutId, dto, res as never);

    const onClose = res.on.mock.calls.find(([event]) => event === 'close')?.[1];
    expect(onClose).toBeDefined();
    const destroy = jest.spyOn(stream, 'destroy');
    onClose!();
    // Otherwise the writer keeps going against a gzip nobody reads and the export
    // stalls forever holding an open cursor.
    expect(destroy).toHaveBeenCalled();
  });
});
