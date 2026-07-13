import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ImportSutDto {
  @ApiProperty({ description: 'Organization to attach all imported rows to' })
  @IsUUID()
  targetOrganizationId!: string;
}
