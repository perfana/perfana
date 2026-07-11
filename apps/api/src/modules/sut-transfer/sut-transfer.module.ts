import { Module } from '@nestjs/common';
import { SutTransferController } from './sut-transfer.controller';
import { SutExportService } from './sut-export.service';

@Module({
  controllers: [SutTransferController],
  providers: [SutExportService],
})
export class SutTransferModule {}
