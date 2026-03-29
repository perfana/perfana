import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptController } from './adapt.controller';
import { AdaptService } from './adapt.service';
import { DsAdaptTrackedResults, DsAdaptConclusion, DsAdaptResults, TestRun } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      DsAdaptTrackedResults,
      DsAdaptConclusion,
      DsAdaptResults,
      TestRun
    ])
  ],
  controllers: [AdaptController],
  providers: [AdaptService],
  exports: [AdaptService],
})
export class AdaptModule {}