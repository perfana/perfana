import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ApiKeyRepository } from '../../repositories/api-key.repository';

/**
 * Decouples api_keys.last_used writes from the hot authentication path.
 *
 * Every call to record() adds a key ID to an in-memory Set. A setInterval
 * fires every 30 s and flushes the full set with a single batch UPDATE, so
 * even under 1 000+ req/s the hot row is only touched twice a minute instead
 * of once per request. The ≤ 60 s lag is acceptable per the acceptance criteria
 * in issue #316.
 */
@Injectable()
export class ApiKeyLastUsedFlusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeyLastUsedFlusherService.name);
  private readonly pending = new Set<string>();
  private readonly flushIntervalMs = 30_000;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(private readonly apiKeyRepository: ApiKeyRepository) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => { void this.flush(); }, this.flushIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.flush();
  }

  record(id: string): void {
    this.pending.add(id);
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const ids = [...this.pending];
    this.pending.clear();
    try {
      await this.apiKeyRepository.updateLastUsedBatch(ids);
      this.logger.debug(`Flushed last_used for ${ids.length} API key(s)`);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Unknown error';
      this.logger.warn(`Failed to flush last_used updates: ${msg}`);
    }
  }
}
