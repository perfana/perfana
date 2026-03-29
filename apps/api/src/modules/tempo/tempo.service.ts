import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { validateExternalUrl } from '../../common/security/url-validator';
import { TracingInstance } from '@perfana/shared';
import {
  SearchTracesDto,
  SearchTracesResponseDto,
  TraceSearchResultDto,
  TraceDetailsResponseDto,
  OTelSpan,
  OTelTrace,
} from './dto/tempo.dto';

@Injectable()
export class TempoService {
  private readonly logger = new Logger(TempoService.name);

  constructor(
    @InjectRepository(TracingInstance)
    private readonly tracingInstanceRepo: Repository<TracingInstance>,
  ) {}

  /**
   * Search for traces matching the given criteria
   */
  async searchTraces(dto: SearchTracesDto): Promise<SearchTracesResponseDto> {
    const instance = await this.getTracingInstance(dto.tracingInstanceId);

    // Ensure we have an API URL configured
    if (!instance.tracingApiUrl) {
      throw new Error(
        `Tracing instance "${instance.label}" does not have an API URL configured. ` +
        'Please set the tracing_api_url field (e.g., http://tempo:3200).'
      );
    }

    // Build the TraceQL query
    const traceQL = this.buildTraceQLQuery(dto);
    this.logger.debug(`TraceQL query: ${traceQL}`);

    // Convert times to Unix seconds (Tempo API uses seconds, not nanoseconds)
    const startSeconds = Math.floor(new Date(dto.startTime).getTime() / 1000);
    const endSeconds = Math.floor(new Date(dto.endTime).getTime() / 1000);

    // Validate URL to prevent SSRF
    const urlValidation = validateExternalUrl(instance.tracingApiUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Tempo URL: ${urlValidation.error}`);
    }

    // Build Tempo API URL using the dedicated API URL
    const baseUrl = instance.tracingApiUrl.replace(/\/$/, '');
    const limit = dto.limit || 100;

    // Tempo search API endpoint
    const searchUrl = `${baseUrl}/api/search?q=${encodeURIComponent(traceQL)}&start=${startSeconds}&end=${endSeconds}&limit=${limit}`;

    this.logger.debug(`Searching Tempo: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Tempo search failed: ${response.status} - ${errorText}`);
        throw new Error(`Tempo search failed: ${response.status}`);
      }

      const data = await response.json();
      const traces = this.parseSearchResponse(data);

      return {
        traces,
        totalCount: traces.length,
      };
    } catch (error) {
      this.logger.error('Failed to search Tempo:', error);
      throw error;
    }
  }

  /**
   * Get full trace details by trace ID
   */
  async getTraceDetails(
    tracingInstanceId: string,
    traceId: string,
  ): Promise<TraceDetailsResponseDto> {
    const instance = await this.getTracingInstance(tracingInstanceId);

    if (!instance.tracingApiUrl) {
      throw new Error(
        `Tracing instance "${instance.label}" does not have an API URL configured.`
      );
    }

    // Validate URL to prevent SSRF
    const urlValidation = validateExternalUrl(instance.tracingApiUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Tempo URL: ${urlValidation.error}`);
    }

    const baseUrl = instance.tracingApiUrl.replace(/\/$/, '');
    const traceUrl = `${baseUrl}/api/traces/${traceId}`;

    this.logger.debug(`Fetching trace: ${traceUrl}`);

    try {
      const response = await fetch(traceUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Tempo trace fetch failed: ${response.status} - ${errorText}`);
        throw new Error(`Failed to fetch trace: ${response.status}`);
      }

      const data = await response.json();
      return this.parseTraceResponse(traceId, data);
    } catch (error) {
      this.logger.error(`Failed to fetch trace ${traceId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch multiple traces by their IDs
   */
  async getMultipleTraces(
    tracingInstanceId: string,
    traceIds: string[],
  ): Promise<OTelTrace[]> {
    const traces: OTelTrace[] = [];

    // Fetch traces in parallel with concurrency limit
    const concurrencyLimit = 10;
    for (let i = 0; i < traceIds.length; i += concurrencyLimit) {
      const batch = traceIds.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.allSettled(
        batch.map((traceId) => this.getTraceDetails(tracingInstanceId, traceId)),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const details = result.value;
          traces.push({
            traceId: details.traceId,
            spans: details.spans,
            durationMs: details.durationMs,
            spanCount: details.spanCount,
          });
        }
      }
    }

    return traces;
  }

  /**
   * Test connection to a tracing instance
   */
  async healthCheck(tracingInstanceId: string): Promise<{ success: boolean; message: string }> {
    try {
      const instance = await this.getTracingInstance(tracingInstanceId);

      if (!instance.tracingApiUrl) {
        return {
          success: false,
          message: `Tracing instance "${instance.label}" does not have an API URL configured.`,
        };
      }

      // Validate URL to prevent SSRF
      const urlValidation = validateExternalUrl(instance.tracingApiUrl);
      if (!urlValidation.isValid) {
        return { success: false, message: `Invalid Tempo URL: ${urlValidation.error}` };
      }

      const baseUrl = instance.tracingApiUrl.replace(/\/$/, '');

      // Tempo ready endpoint
      const healthUrl = `${baseUrl}/ready`;

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return { success: true, message: 'Tempo is healthy' };
      } else {
        return { success: false, message: `Tempo returned status ${response.status}` };
      }
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Connection failed';
      return { success: false, message };
    }
  }

  /**
   * Build TraceQL query from search parameters
   * TraceQL uses dot prefix for span attributes (."attribute-name")
   */
  private buildTraceQLQuery(dto: SearchTracesDto): string {
    const conditions: string[] = [];

    // Service name filter (resource attribute)
    conditions.push(`resource.service.name="${dto.serviceName}"`);

    // Test run ID filter (span attribute - use dot prefix)
    conditions.push(`."perfana-test-run-id" = "${dto.testRunId}"`);

    // Request name filter (Scenario|Transaction|Sampler format)
    // Note: In TraceQL regex, pipe character | doesn't need escaping
    if (dto.sampler) {
      // Exact match with sampler
      const requestName = `${dto.scenario}|${dto.transaction}|${dto.sampler}`;
      conditions.push(`."perfana-request-name" = "${requestName}"`);
    } else {
      // Regex match for any sampler within the transaction
      const requestNamePattern = `${dto.scenario}[|]${dto.transaction}[|].*`;
      conditions.push(`."perfana-request-name" =~ "${requestNamePattern}"`);
    }

    return `{${conditions.join(' && ')}}`;
  }

  /**
   * Parse Tempo search response into our DTO format
   */
  private parseSearchResponse(data: any): TraceSearchResultDto[] {
    const traces: TraceSearchResultDto[] = [];

    // Tempo returns traces in different formats depending on version
    const traceList = data.traces || data.batches || [];

    for (const trace of traceList) {
      const traceId = trace.traceID || trace.traceId;
      if (!traceId) continue;

      // Duration can be in different formats
      let durationMs = 0;
      if (trace.durationMs) {
        durationMs = trace.durationMs;
      } else if (trace.durationNanos) {
        durationMs = trace.durationNanos / 1_000_000;
      } else if (trace.duration) {
        // Duration might be in nanoseconds or milliseconds
        durationMs = trace.duration > 1_000_000_000 ? trace.duration / 1_000_000 : trace.duration;
      }

      traces.push({
        traceId,
        durationMs,
        startTimeUnixNano: trace.startTimeUnixNano || String(trace.startTime || '0'),
        spanCount: trace.spanCount || trace.spans?.length || 0,
        rootServiceName: trace.rootServiceName || trace.serviceName || '',
        rootTraceName: trace.rootTraceName || trace.name || '',
      });
    }

    return traces;
  }

  /**
   * Parse Tempo trace response into our DTO format
   */
  private parseTraceResponse(traceId: string, data: any): TraceDetailsResponseDto {
    const spans: OTelSpan[] = [];

    // Tempo can return data in OTLP or Jaeger format
    // Handle OTLP format (resourceSpans -> scopeSpans -> spans)
    if (data.resourceSpans || data.batches) {
      const resourceSpans = data.resourceSpans || data.batches || [];

      for (const resourceSpan of resourceSpans) {
        const serviceName = this.extractServiceName(resourceSpan.resource);

        const scopeSpans = resourceSpan.scopeSpans || resourceSpan.instrumentationLibrarySpans || [];
        for (const scopeSpan of scopeSpans) {
          const spanList = scopeSpan.spans || [];
          for (const span of spanList) {
            spans.push(this.convertOTLPSpan(span, serviceName));
          }
        }
      }
    }

    // Calculate total duration from spans
    let minStart = Infinity;
    let maxEnd = 0;

    for (const span of spans) {
      const start = BigInt(span.startTimeUnixNano);
      const end = BigInt(span.endTimeUnixNano);
      if (start < minStart) minStart = Number(start);
      if (end > maxEnd) maxEnd = Number(end);
    }

    const durationMs = spans.length > 0 ? (maxEnd - minStart) / 1_000_000 : 0;

    return {
      traceId,
      spans,
      durationMs,
      spanCount: spans.length,
    };
  }

  /**
   * Extract service name from OTLP resource
   */
  private extractServiceName(resource: any): string {
    if (!resource?.attributes) return 'unknown';

    for (const attr of resource.attributes) {
      if (attr.key === 'service.name') {
        return attr.value?.stringValue || attr.value?.Value?.StringValue || 'unknown';
      }
    }

    return 'unknown';
  }

  /**
   * Convert OTLP span format to our internal format
   */
  private convertOTLPSpan(span: any, serviceName: string): OTelSpan {
    const startTimeUnixNano = span.startTimeUnixNano || String(span.startTime || '0');
    const endTimeUnixNano = span.endTimeUnixNano || String(span.endTime || '0');

    // Calculate duration in nanoseconds
    const durationNanos =
      BigInt(endTimeUnixNano) - BigInt(startTimeUnixNano);

    // Convert attributes to a simple object
    const attributes: Record<string, any> = {};
    if (span.attributes) {
      for (const attr of span.attributes) {
        const value =
          attr.value?.stringValue ||
          attr.value?.intValue ||
          attr.value?.boolValue ||
          attr.value?.doubleValue ||
          attr.value?.Value?.StringValue ||
          attr.value?.Value?.IntValue ||
          null;
        if (value !== null) {
          attributes[attr.key] = value;
        }
      }
    }

    return {
      traceId: span.traceId || '',
      spanId: span.spanId || '',
      parentSpanId: span.parentSpanId || undefined,
      operationName: span.name || '',
      serviceName,
      startTimeUnixNano,
      endTimeUnixNano,
      durationNanos: Number(durationNanos),
      status: span.status
        ? {
            code: span.status.code || 0,
            message: span.status.message,
          }
        : undefined,
      attributes,
      events: span.events?.map((event: any) => ({
        timeUnixNano: event.timeUnixNano || String(event.time || '0'),
        name: event.name || '',
        attributes: event.attributes
          ? Object.fromEntries(
              event.attributes.map((a: any) => [
                a.key,
                a.value?.stringValue || a.value?.intValue || null,
              ]),
            )
          : undefined,
      })),
    };
  }

  /**
   * Get tracing instance by ID
   */
  private async getTracingInstance(id: string): Promise<TracingInstance> {
    const instance = await this.tracingInstanceRepo.findOne({
      where: { id },
    });

    if (!instance) {
      throw new Error(`Tracing instance not found: ${id}`);
    }

    return instance;
  }
}
