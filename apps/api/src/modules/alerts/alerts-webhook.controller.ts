import { Controller, Post, Body, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { GrafanaAlertDto, AlertmanagerPayloadDto } from './dto/alert-webhook.dto';

@ApiTags('webhooks')
@Controller('webhooks/alerts')
@ApiBearerAuth()
export class AlertsWebhookController {
  private readonly logger = new Logger(AlertsWebhookController.name);

  constructor(private readonly alertsService: AlertsService) {}

  @Post('grafana')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Grafana legacy alert notifications (requires API key)' })
  @ApiResponse({ status: 200, description: 'Alert processed' })
  @ApiResponse({ status: 401, description: 'Unauthorized - configure Bearer token in Grafana webhook' })
  async receiveGrafanaAlert(@Body() dto: GrafanaAlertDto) {
    this.logger.log(`Received Grafana alert: ${dto.ruleName || dto.title || 'unknown'}`);
    try {
      const result = await this.alertsService.processGrafanaAlert(dto);
      return { status: 'ok', ...result };
    } catch (err) {
      this.logger.error(`Error processing Grafana alert: ${err}`);
      return { status: 'error', message: 'Failed to process alert' };
    }
  }

  @Post('alertmanager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Alertmanager / Grafana unified alerting notifications (requires API key)' })
  @ApiResponse({ status: 200, description: 'Alerts processed' })
  @ApiResponse({ status: 401, description: 'Unauthorized - configure Bearer token in Alertmanager http_config' })
  async receiveAlertmanagerAlert(@Body() dto: AlertmanagerPayloadDto) {
    this.logger.log(`Received Alertmanager payload: ${dto.alerts?.length || 0} alerts from ${dto.receiver || 'unknown'}`);
    try {
      const result = await this.alertsService.processAlertmanagerPayload(dto);
      return { status: 'ok', ...result };
    } catch (err) {
      this.logger.error(`Error processing Alertmanager payload: ${err}`);
      return { status: 'error', message: 'Failed to process alerts' };
    }
  }
}
