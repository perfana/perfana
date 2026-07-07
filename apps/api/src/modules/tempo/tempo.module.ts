import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingInstance } from '@perfana/shared';
import { TempoController } from './tempo.controller';
import { TempoService } from './tempo.service';
import { ProxyModule } from '../proxy/proxy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TracingInstance]),
    ProxyModule, // Provides ProxyResolverService for outbound proxy routing
  ],
  controllers: [TempoController],
  providers: [TempoService],
  exports: [TempoService],
})
export class TempoModule {}
