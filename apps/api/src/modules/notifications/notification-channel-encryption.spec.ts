import { getMetadataArgsStorage, ValueTransformer } from 'typeorm';
import { NotificationChannel } from '@perfana/shared';

/**
 * The webhook URL is a bearer credential for the Slack/Teams channel, so the entity
 * encrypts it at rest. Asserted on what the column writes, not on which transformer
 * object is attached.
 */
describe('NotificationChannel.webhookUrl at rest', () => {
  const URL = 'https://hooks.slack.com/services/T000/B000/secret';
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  // Value: protects=webhook URLs are written encrypted and read back intact; fails_when=the transformer is removed from the column (URL stored in plaintext again) or swapped for one that does not round-trip; why_new=no test touches the entity column definition; seam=none; no_claim=does not cover legacy plaintext rows (encrypted-column.transformer.spec does)
  it('writes ciphertext and reads back the original URL', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === NotificationChannel && c.propertyName === 'webhookUrl',
    );
    const transformer = column?.options.transformer as ValueTransformer | undefined;
    expect(transformer).toBeDefined();

    const stored = transformer!.to(URL);
    expect(typeof stored).toBe('string');
    expect(stored).not.toContain('secret');
    expect(stored).not.toBe(URL);
    expect(transformer!.from(stored)).toBe(URL);
  });
});
