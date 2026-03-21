import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingInstancesController } from './tracing-instances.controller';
import { TracingInstancesService } from './tracing-instances.service';
import { TracingInstance } from '@perfana/shared';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TracingInstance]),
    CommonModule, // Provides AuthorizationService
  ],
  controllers: [
    TracingInstancesController
  ],
  providers: [
    TracingInstancesService
  ],
  exports: [
    TracingInstancesService
  ],
})
export class TracingInstancesModule {}
