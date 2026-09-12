import { Controller, ForbiddenException, Get, Logger, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as readline from 'readline';
import { createGzip } from 'zlib';
import { AdminOnly } from '../../decorators/admin-only.decorator';
import { SkipRls } from '../../common/db/skip-rls.decorator';
import { LogsService } from './logs.service';

@ApiTags('logs')
@ApiBearerAuth()
@AdminOnly()
@Controller('logs')
export class LogsController {
  private readonly logger = new Logger(LogsController.name);

  constructor(
    private readonly logsService: LogsService,
    private readonly config: ConfigService,
  ) {}

  private assertEnabled(): void {
    if (this.config.get<string>('LOG_VIEWER_ENABLED', 'false') !== 'true') {
      throw new ForbiddenException('Log viewer is disabled');
    }
  }

  @Get('containers')
  @ApiOperation({ summary: 'List Perfana containers (admin, toggle-gated)' })
  async list() {
    this.assertEnabled();
    return this.logsService.listContainers();
  }

  @Get('containers/:id/stream')
  @SkipRls() // Docker only, no Postgres — do not hold a pooled connection for the response.
  @ApiOperation({ summary: 'Tail a container log as Server-Sent Events' })
  async stream(
    @Param('id') id: string,
    @Query('tail') tailRaw: string | undefined,
    @Query('follow') followRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    this.assertEnabled();
    const tail = Math.min(Math.max(parseInt(tailRaw ?? '200', 10) || 200, 1), 5000);
    const follow = followRaw !== 'false';

    // openLogStream validates id against the live allowlist and throws NotFound if unknown.
    const stream = await this.logsService.openLogStream(id, { tail, follow });

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => res.write(`data: ${line}\n\n`));
    const end = () => { rl.close(); res.end(); };
    stream.on('end', end);
    stream.on('error', end);
    res.on('close', () => { rl.close(); stream.destroy(); });
  }

  @Get('containers/:id/download')
  @SkipRls() // Docker only, no Postgres — do not hold a pooled connection for the response.
  @ApiOperation({ summary: 'Download the complete container log as gzip' })
  @ApiProduces('application/gzip')
  @ApiResponse({
    status: 200,
    description: 'Gzipped container log, streamed with no Content-Length.',
    content: { 'application/gzip': { schema: { type: 'string', format: 'binary' } } },
  })
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    this.assertEnabled();
    // Resolve the name before opening the stream, so nothing is held open if this throws.
    const container = (await this.logsService.listContainers()).find((c) => c.id === id);
    if (!container) throw new NotFoundException('Unknown container');
    const safe = (container.service || container.name).replace(/[^a-z0-9._-]/gi, '-') || id.slice(0, 12);
    const date = new Date().toISOString().slice(0, 10);
    const stream = await this.logsService.openLogStream(id, { tail: 'all', follow: false });

    // Same shape as the SUT export: gzip piped with no Content-Length, nginx buffering off so
    // a large log keeps flowing instead of being held until a load balancer cuts it.
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${safe}-${date}.log.gz"`,
      'X-Accel-Buffering': 'no',
    });
    const gzip = createGzip();
    stream.pipe(gzip).pipe(res);
    // Not stream.pipeline(): that would destroy res on a source error too, and the 500 below
    // needs res alive while the headers are still unsent. gzip is destroyed by hand for the
    // same reason — pipe() only unpipes it, leaving its zlib handle to the GC.
    res.on('close', () => { stream.destroy(); gzip.destroy(); });
    const fail = (err: Error) => {
      this.logger.error(`Log download failed for ${id}: ${err.message}`);
      if (res.headersSent) {
        res.destroy(err);
      } else {
        // res.json() keeps an existing Content-Type, so drop the download headers or the
        // error body arrives as a corrupt .log.gz attachment.
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.status(500).json({ message: 'Log download failed' });
      }
    };
    stream.on('error', fail);
    gzip.on('error', fail);
  }
}
