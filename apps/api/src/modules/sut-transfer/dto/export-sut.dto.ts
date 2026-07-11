import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsUUID } from 'class-validator';

export class ExportSutDto {
  @ApiProperty({ type: [String], description: 'test_runs.id (uuid) values to include' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  testRunIds!: string[];

  @ApiProperty({ default: true })
  @IsBoolean()
  includeOptional!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  includeRaw!: boolean;
}
