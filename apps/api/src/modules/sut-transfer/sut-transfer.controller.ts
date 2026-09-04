import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AdminOnly } from '../../decorators/admin-only.decorator';
import { ExportSutDto } from './dto/export-sut.dto';
import { ImportSutDto } from './dto/import-sut.dto';
import { SutExportService } from './sut-export.service';
import { ImportSummary, SutImportService } from './sut-import.service';

@ApiTags('sut-transfer')
@ApiBearerAuth()
@AdminOnly()
@Controller('systems-under-test')
export class SutTransferController {
  private readonly logger = new Logger(SutTransferController.name);

  constructor(
    private readonly exportService: SutExportService,
    private readonly importService: SutImportService,
    private readonly config: ConfigService,
  ) {}

  private assertEnabled(): void {
    if (this.config.get<string>('SUT_TRANSFER_ENABLED', 'false') !== 'true') {
      throw new ForbiddenException('SUT transfer is disabled');
    }
  }

  @Post(':id/export')
  @ApiOperation({ summary: 'Export a SUT + selected test runs as a gzipped NDJSON bundle (admin, toggle-gated)' })
  @ApiProduces('application/gzip')
  @ApiResponse({
    status: 200,
    description: 'Gzipped NDJSON bundle, streamed with no Content-Length.',
    content: { 'application/gzip': { schema: { type: 'string', format: 'binary' } } },
  })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExportSutDto,
    @Res() res: Response,
  ): Promise<void> {
    this.assertEnabled();
    const date = new Date().toISOString().slice(0, 10);
    const stream = await this.exportService.export(id, dto);
    const safeId = id.replace(/[^a-z0-9-]/gi, '');
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="sut-${safeId}-${date}.ndjson.gz"`,
      // nginx buffers a proxied response by default, which swallows the export's 2 s gzip
      // heartbeat: the client sees zero bytes for minutes and a load balancer with a total
      // request cap kills the connection. The header is ignored by anything that is not nginx.
      'X-Accel-Buffering': 'no',
    });
    // No res.flushHeaders() here, unlike the sibling streaming route in logs.controller.ts.
    // That one is SSE, where the event stream is not established until the headers land. This
    // is a download, and the header above is enough for nginx — it reads it whenever the
    // headers arrive, which the export service's 2 s gzip heartbeat already guarantees.
    // Not flushing also leaves the error path below a window in which it can still reply.
    stream.pipe(res);
    // The client hung up (Cancel, closed tab, dead proxy). Without this the writer keeps going
    // against a gzip nobody reads: its buffer fills, the write callback never fires, and the
    // export stalls forever holding an open cursor. Destroying the source unblocks and releases it.
    res.on('close', () => stream.destroy());
    stream.on('error', (err) => {
      this.logger.error(`Export stream failed: ${err.message}`);
      // res.destroy() tears the socket down without flushing a status line, so a bare
      // res.status(500) before it never reached the client — verified: the client gets
      // UND_ERR_SOCKET, not a 500. Reply properly while the headers are still unsent (an
      // export that fails on its first table), and only destroy once the body is in flight,
      // where an abrupt close is the only signal a truncated gzip can carry.
      if (res.headersSent) res.destroy(err);
      else res.status(500).json({ message: 'Export failed' });
    });
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import a SUT bundle into this environment (admin, toggle-gated)' })
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportSutDto,
  ): Promise<ImportSummary> {
    this.assertEnabled();
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    return this.importService.import(file.buffer, dto.targetOrganizationId);
  }
}
