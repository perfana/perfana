import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DynatraceController } from './dynatrace.controller';
import { DynatraceService } from './dynatrace.service';
import { DynatraceRepository } from './dynatrace.repository';
import { AuthModule } from '../auth/auth.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { CommonModule } from '../../common/common.module';
import {
  DynatraceConfig,
  DynatraceQuery,
  DynatraceEntityMapping,
  DsPanels,
  DsMetrics,
} from '../../entities';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => TestRunsModule), // ForwardRef to handle circular dependency
    TypeOrmModule.forFeature([
      DynatraceConfig,
      DynatraceQuery,
      DynatraceEntityMapping,
      DsPanels,
      DsMetrics,
    ]),
    CommonModule, // Provides AuthorizationService for RBAC
  ],
  controllers: [DynatraceController],
  providers: [DynatraceService, DynatraceRepository],
  exports: [DynatraceService],
})
export class DynatraceModule {}