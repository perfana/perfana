import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Worker, Job, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { GeneratedReport } from '@perfana/shared/entities';
import { BrowserPoolService } from './browser-pool.service';

/**
 * Renders a report's charts for Confluence. Confluence storage format has no inline SVG, and the API
 * image is distroless with no fonts to rasterize one, so the chart SVGs are screenshotted here in the
 * same Chrome that prints the PDF.
 *
 * The job returns only a Redis key. The rendered HTML and PNGs (often several MB) are written under
 * that key with a TTL instead, because BullMQ copies a job's return value into its events stream,
 * which keeps thousands of entries. The API reads the key once and deletes it.
 *
 * Twin constants: apps/api/src/modules/confluence/confluence-render.client.ts.
 */
export const CONFLUENCE_RENDER_QUEUE_NAME = 'perfana-report-confluence-render';
const RESULT_TTL_SECONDS = 600;
/** Twin of RENDER_WAIT_MS in the API's confluence-render.client.ts. */
const API_RENDER_WAIT_MS = 180_000;

export interface ConfluenceRenderJobData {
  reportId: string;
}

export interface ConfluenceRenderResult {
  /** The report HTML with every chart SVG replaced by `<img data-confluence-chart="N" width="W">`. */
  html: string;
  /** Base64 PNGs, indexed by `data-confluence-chart`. */
  images: string[];
}

// Smaller SVGs are icons; the converter drops them rather than attach a 16px image.
const MIN_CHART_WIDTH = 120;
const MIN_CHART_HEIGHT = 60;

@Injectable()
export class ConfluenceRenderProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConfluenceRenderProcessor.name);
  private redis: IORedis | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly browserPool: BrowserPoolService,
    @InjectRepository(GeneratedReport)
    private readonly reportRepo: Repository<GeneratedReport>
  ) {}

  onModuleInit(): void {
    const host = this.configService.get('REDIS_HOST', 'localhost');
    const port = parseInt(this.configService.get('REDIS_PORT', '6379'), 10);
    this.redis = new IORedis(`redis://${host}:${port}`, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.redis.on('error', err =>
      this.logger.error(`Redis error (Confluence render): ${err.message}`)
    );
    this.worker = new Worker<ConfluenceRenderJobData, { resultKey: string }>(
      CONFLUENCE_RENDER_QUEUE_NAME,
      async job => this.process(job),
      {
        connection: this.redis as unknown as ConnectionOptions,
        concurrency: 1,
        lockDuration: 180000,
      }
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        `Confluence render for report ${job?.data.reportId} failed: ${err.message}`
      )
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.redis?.disconnect();
  }

  private async process(
    job: Job<ConfluenceRenderJobData>
  ): Promise<{ resultKey: string }> {
    const { reportId } = job.data;
    const started = Date.now();
    // The API gave up on a job queued this long ago; rendering it would only hold the single slot
    // while a retry waits behind it.
    if (started - job.timestamp > API_RENDER_WAIT_MS) {
      throw new Error(
        `Skipped: queued ${Math.round((started - job.timestamp) / 1000)}s ago, the API stopped waiting`
      );
    }
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      select: ['id', 'html_content'],
    });
    if (!report?.html_content)
      throw new Error(`Report ${reportId} has no HTML content`);

    const result = await this.render(report.html_content);
    const resultKey = `confluence-render:${job.id}`;
    await this.redis!.set(
      resultKey,
      JSON.stringify(result),
      'EX',
      RESULT_TTL_SECONDS
    );
    this.logger.log(
      `Rendered ${result.images.length} chart(s) for report ${reportId} in ${Date.now() - started}ms`
    );
    return { resultKey };
  }

  async render(html: string): Promise<ConfluenceRenderResult> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    try {
      // 2x so the PNGs stay sharp on a retina screen at their natural width.
      await page.setViewport({
        width: 1200,
        height: 900,
        deviceScaleFactor: 2,
      });
      await page.setContent(html, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 60000,
      });
      await page.evaluate(() =>
        document
          .querySelectorAll('details')
          .forEach(d => d.setAttribute('open', ''))
      );

      const images: string[] = [];
      for (const svg of await page.$$('svg')) {
        // ponytail: one screenshot per chart, serial; a report with hundreds of charts takes a while.
        const isTopLevel = await svg.evaluate(
          el => el.isConnected && !el.parentElement?.closest('svg')
        );
        const box = isTopLevel ? await svg.boundingBox() : null;
        if (
          !box ||
          box.width < MIN_CHART_WIDTH ||
          box.height < MIN_CHART_HEIGHT
        )
          continue;
        images.push(
          (await svg.screenshot({ type: 'png', encoding: 'base64' })) as string
        );
        await svg.evaluate(
          (el, index, width) => {
            const img = document.createElement('img');
            img.setAttribute('data-confluence-chart', String(index));
            img.setAttribute('width', String(width));
            el.replaceWith(img);
          },
          images.length - 1,
          Math.round(box.width)
        );
      }
      return { html: await page.content(), images };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
