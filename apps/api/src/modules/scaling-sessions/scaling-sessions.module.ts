import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScalingSession } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { ScalingSessionsController } from './scaling-sessions.controller';
import { ScalingSessionsService } from './scaling-sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScalingSession]),
    CommonModule,
  ],
  controllers: [ScalingSessionsController],
  providers: [ScalingSessionsService],
  exports: [ScalingSessionsService],
})
export class ScalingSessionsModule {}
