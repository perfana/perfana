import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedReport } from '@perfana/shared/entities';
import { BrowserPoolService } from './browser-pool.service';
import { PdfService } from './pdf.service';
import { PdfQueueProcessor } from './pdf-queue.processor';

@Module({
  imports: [TypeOrmModule.forFeature([GeneratedReport])],
  providers: [BrowserPoolService, PdfService, PdfQueueProcessor],
  exports: [PdfService, BrowserPoolService],
})
export class PdfModule {}
