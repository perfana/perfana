import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get reports status',
    description: 'Check the status of the reports module. Currently returns a placeholder as reports functionality is not yet implemented.',
  })
  @ApiResponse({
    status: 200,
    description: 'Reports module status',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        status: { type: 'string' },
        available: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  findAll(@UserCtx() ctx: UserContext) {
    return this.reportsService.findAll(ctx.userId, ctx.roles);
  }
}
