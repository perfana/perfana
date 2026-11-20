import { IsNotEmpty, IsOptional, IsString, IsUUID, IsBoolean, IsIn, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannelType } from '@perfana/shared';

export class CreateNotificationChannelDto {
  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Notification channel type',
    enum: ['slack', 'teams', 'mattermost'],
    example: 'slack',
  })
  @IsNotEmpty()
  @IsIn(['slack', 'teams', 'mattermost'])
  type!: NotificationChannelType;

  @ApiProperty({
    description: 'Channel name (e.g., #performance-alerts)',
    example: '#performance-alerts',
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Webhook URL for the notification channel',
    example: 'https://hooks.slack.com/services/xxx/yyy/zzz',
  })
  @IsNotEmpty()
  @IsUrl()
  webhookUrl!: string;

  @ApiPropertyOptional({
    description: 'Send notification when test run finishes',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnFinished?: boolean;

  @ApiPropertyOptional({
    description: 'Only send notifications for failed test runs',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnFailedOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Post a digest when test run comments are added (one post per burst, no comment text)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyOnComment?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the notification channel is enabled',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Route outbound webhook requests through the organization proxy',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}
