import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { KeycloakJwtService } from './keycloak-jwt.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    CommonModule,
    HttpModule,
  ],
  controllers: [AuthController],
  providers: [KeycloakJwtService, KeycloakAdminService],
  exports: [KeycloakJwtService, KeycloakAdminService],
})
export class AuthModule {}
