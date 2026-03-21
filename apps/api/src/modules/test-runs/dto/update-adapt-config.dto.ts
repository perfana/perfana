import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

export class UpdateAdaptConfigDto {
  @ApiProperty({
    description: 'Differences acceptance status',
    enum: ['ACCEPTED', 'DENIED', 'TBD'],
    example: 'ACCEPTED'
  })
  @IsString()
  @IsIn(['ACCEPTED', 'DENIED', 'TBD'])
  differencesAccepted!: 'ACCEPTED' | 'DENIED' | 'TBD';
}