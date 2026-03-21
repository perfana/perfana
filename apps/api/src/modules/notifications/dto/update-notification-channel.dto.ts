import { IsOptional, IsString, IsBoolean, IsIn, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannelType } from '@perfana/shared';

export class UpdateNotificationChannelDto {
  @ApiPropertyOptional({
    description: 'Notification channel type',
    enum: ['slack', 'teams'],
    example: 'slack',
  })
  @IsOptional()
  @IsIn(['slack', 'teams'])
  type?: NotificationChannelType;

  @ApiPropertyOptional({
    description: 'Channel name (e.g., #performance-alerts)',
    example: '#performance-alerts',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Webhook URL for the notification channel',
    example: 'https://hooks.slack.com/services/xxx/yyy/zzz',
  })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional({
    description: 'Send notification when test run finishes',
  })
  @IsOptional()
  @IsBoolean()
  notifyOnFinished?: boolean;

  @ApiPropertyOptional({
    description: 'Only send notifications for failed test runs',
  })
  @IsOptional()
  @IsBoolean()
  notifyOnFailedOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification channel is enabled',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
