import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsSourcesController } from './metrics-sources.controller';
import { MetricsSourcesService } from './metrics-sources.service';
import { MetricsSource, SystemUnderTest } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetricsSource, SystemUnderTest]),
    CommonModule,
  ],
  controllers: [MetricsSourcesController],
  providers: [MetricsSourcesService],
  exports: [MetricsSourcesService],
})
export class MetricsSourcesModule {}
