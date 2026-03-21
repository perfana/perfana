import { PartialType } from '@nestjs/swagger';
import { CreateDeepLinkDto } from './create-deep-link.dto';

export class UpdateDeepLinkDto extends PartialType(CreateDeepLinkDto) {}