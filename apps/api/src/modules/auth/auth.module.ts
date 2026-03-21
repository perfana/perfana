import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { KeycloakJwtService } from './keycloak-jwt.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    CommonModule,
    HttpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'jwt-secret'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1h'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [KeycloakJwtService, KeycloakAdminService],
  exports: [KeycloakJwtService, KeycloakAdminService],
})
export class AuthModule {}
