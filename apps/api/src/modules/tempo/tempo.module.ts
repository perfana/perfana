import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingInstance } from '@perfana/shared';
import { TempoController } from './tempo.controller';
import { TempoService } from './tempo.service';

@Module({
  imports: [TypeOrmModule.forFeature([TracingInstance])],
  controllers: [TempoController],
  providers: [TempoService],
  exports: [TempoService],
})
export class TempoModule {}
