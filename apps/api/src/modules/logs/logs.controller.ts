import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as readline from 'readline';
import { AdminOnly } from '../../decorators/admin-only.decorator';
import { LogsService } from './logs.service';

@ApiTags('logs')
@ApiBearerAuth()
@AdminOnly()
@Controller('logs')
export class LogsController {
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
}
