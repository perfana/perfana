import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional } from 'class-validator';

export class UpdateAdaptConfigDto {
  @ApiProperty({
    description: 'Differences acceptance status',
    enum: ['ACCEPTED', 'DENIED', 'TBD'],
    example: 'ACCEPTED'
  })
  @IsString()
  @IsIn(['ACCEPTED', 'DENIED', 'TBD'])
  differencesAccepted!: 'ACCEPTED' | 'DENIED' | 'TBD';

  @ApiPropertyOptional({
    description: 'ADAPT mode to set (DEFAULT or BASELINE)',
    enum: ['DEFAULT', 'BASELINE'],
    example: 'DEFAULT'
  })
  @IsOptional()
  @IsString()
  @IsIn(['DEFAULT', 'BASELINE'])
  mode?: 'DEFAULT' | 'BASELINE';
}