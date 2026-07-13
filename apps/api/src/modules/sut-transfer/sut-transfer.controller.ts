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
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
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
    });
    stream.pipe(res);
    stream.on('error', (err) => {
      this.logger.error(`Export stream failed: ${err.message}`);
      if (!res.headersSent) res.status(500);
      res.destroy(err);
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
