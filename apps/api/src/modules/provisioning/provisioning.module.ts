import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';
import { ProvisioningService } from './provisioning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Profile,
      ProfileGrafanaDashboard,
      ProfileBenchmark,
      ProvisionedTemplateDsCompareConfig,
    ]),
  ],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
