import { IsString, IsNotEmpty, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TestConnectionDto {
  @ApiProperty({
    description: 'Dynatrace host URL',
    example: 'https://abc12345.live.dynatrace.com',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false }, { message: 'Host must be a valid URL' })
  host!: string;

  @ApiProperty({
    description: 'Dynatrace API token',
    example: 'dt0c01.ST2EY72KQINMH574WMNVI7YN.G3DFPBEJYMODIDAEX454M7YWBUVEFOWKPRVMWFASS64NFH52PX6BNDVFFM572RZH',
  })
  @IsString()
  @IsNotEmpty()
  apiToken!: string;
}
