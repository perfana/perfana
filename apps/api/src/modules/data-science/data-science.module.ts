import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CommonModule } from '../../common/common.module';
import { BullMQClientService } from './services/bullmq-client.service';
import { JobProgressService } from './services/job-progress.service';
import { DataScienceController } from './controllers/data-science.controller';
import { JobProgressGateway } from './gateways/job-progress.gateway';

@Module({
  imports: [ConfigModule, ApiKeysModule, CommonModule],
  controllers: [DataScienceController],
  providers: [BullMQClientService, JobProgressService, JobProgressGateway],
  exports: [BullMQClientService, JobProgressService],
})
export class DataScienceModule {}