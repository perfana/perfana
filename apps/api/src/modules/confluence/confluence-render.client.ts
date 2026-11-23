import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionOptions, Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Asks perfana-report to render a report's charts to PNG and waits for the answer.
 * Twin constants and the result contract: apps/perfana-report/src/modules/pdf/confluence-render.processor.ts.
 */
const CONFLUENCE_RENDER_QUEUE_NAME = 'perfana-report-confluence-render';
const RENDER_WAIT_MS = 180_000;

export interface ConfluenceRenderResult {
  html: string;
  images: string[];
}

@Injectable()
export class ConfluenceRenderClient implements OnModuleDestroy {
  private readonly logger = new Logger(ConfluenceRenderClient.name);
  private redis: IORedis | null = null;
  private queue: Queue | null = null;
  private events: QueueEvents | null = null;

  constructor(private readonly config: ConfigService) {}

  // ponytail: connections open on first publish, not at boot, so a deploy that never publishes
  // never holds them.
  private connect(): { redis: IORedis; queue: Queue; events: QueueEvents } {
    if (!this.redis || !this.queue || !this.events) {
      const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
      this.redis = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
      this.redis.on('error', (err) => this.logger.error(`Redis error (Confluence render): ${err.message}`));
      this.queue = new Queue(CONFLUENCE_RENDER_QUEUE_NAME, { connection: this.redis as unknown as ConnectionOptions });
      // QueueEvents blocks on its connection, so it needs one of its own.
      const eventsRedis = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
      eventsRedis.on('error', (err) => this.logger.error(`Redis error (Confluence render events): ${err.message}`));
      this.events = new QueueEvents(CONFLUENCE_RENDER_QUEUE_NAME, { connection: eventsRedis as unknown as ConnectionOptions });
    }
    return { redis: this.redis, queue: this.queue, events: this.events };
  }

  async render(reportId: string): Promise<ConfluenceRenderResult> {
    const { redis, queue, events } = this.connect();
    const job = await queue.add('render', { reportId }, { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } });
    let resultKey: string;
    try {
      ({ resultKey } = (await job.waitUntilFinished(events, RENDER_WAIT_MS)) as { resultKey: string });
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.error(`Confluence render of report ${reportId} failed (job ${job.id}): ${msg}`);
      throw new ServiceUnavailableException(
        /timed out|not finished/i.test(msg)
          ? 'The report service did not render the charts in time. Check that perfana-report is running.'
          : `The report service could not render the charts: ${msg}`,
      );
    }
    const raw = await redis.get(resultKey);
    await redis.del(resultKey);
    if (!raw) throw new ServiceUnavailableException('The rendered report expired before it could be published; try again');
    return JSON.parse(raw) as ConfluenceRenderResult;
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.redis?.disconnect();
  }
}
