import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { Profile, ProfileGrafanaDashboard, ProfileBenchmark, GrafanaInstance, GrafanaDashboard, GenericDeepLink } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Profile, ProfileGrafanaDashboard, ProfileBenchmark, GrafanaInstance, GrafanaDashboard, GenericDeepLink]),
    CommonModule,
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
