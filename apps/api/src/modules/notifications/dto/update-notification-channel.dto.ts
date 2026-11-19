import { IsOptional, IsString, IsBoolean, IsIn, IsUrl, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannelType } from '@perfana/shared';
import { MASKED_WEBHOOK_URL } from '../notifications.constants';

export class UpdateNotificationChannelDto {
  @ApiPropertyOptional({
    description: 'Notification channel type',
    enum: ['slack', 'teams', 'mattermost'],
    example: 'slack',
  })
  @IsOptional()
  @IsIn(['slack', 'teams', 'mattermost'])
  type?: NotificationChannelType;

  @ApiPropertyOptional({
    description: 'Channel name (e.g., #performance-alerts)',
    example: '#performance-alerts',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description:
      `Webhook URL for the notification channel. Omit it, or send "${MASKED_WEBHOOK_URL}" as returned by a read, to keep the stored URL.`,
    example: 'https://hooks.slack.com/services/xxx/yyy/zzz',
  })
  @IsOptional()
  @ValidateIf((o: UpdateNotificationChannelDto) => o.webhookUrl !== MASKED_WEBHOOK_URL)
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

  @ApiPropertyOptional({
    description: 'Route outbound webhook requests through the organization proxy',
  })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}
