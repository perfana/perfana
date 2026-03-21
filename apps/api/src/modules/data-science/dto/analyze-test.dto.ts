import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeTestDto {
  @ApiProperty({
    description: 'Whether to include ADAPT analysis in the pipeline',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  adapt?: boolean;

  @ApiProperty({
    description: 'Whether to process only benchmark-related stages',
    required: false,
    default: false
  })
  @IsOptional()
  @IsBoolean()
  benchmarksOnly?: boolean;
}