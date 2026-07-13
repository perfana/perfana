import { Module } from '@nestjs/common';
import { SutTransferController } from './sut-transfer.controller';
import { SutExportService } from './sut-export.service';
import { SutImportService } from './sut-import.service';

@Module({
  controllers: [SutTransferController],
  providers: [SutExportService, SutImportService],
})
export class SutTransferModule {}
