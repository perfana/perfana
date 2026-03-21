import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingService } from '@perfana/shared/entities';
import { TracingServicesController } from './tracing-services.controller';
import { TracingServicesService } from './tracing-services.service';
import { TracingServiceRepository } from '../../repositories/tracing-service.repository';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TracingService]),
    CommonModule, // Import for AuthorizationService
  ],
  controllers: [TracingServicesController],
  providers: [TracingServicesService, TracingServiceRepository],
  exports: [TracingServicesService],
})
export class TracingServicesModule {}
