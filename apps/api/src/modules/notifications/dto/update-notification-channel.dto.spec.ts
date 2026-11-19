import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateNotificationChannelDto } from './update-notification-channel.dto';
import { MASKED_WEBHOOK_URL } from '../notifications.constants';

/**
 * A read returns MASKED_WEBHOOK_URL in place of the stored URL, and the web dialog PUTs
 * the form back unchanged. The global ValidationPipe runs before the service, so the
 * service-level "keep the stored URL" logic is unreachable unless the DTO lets the
 * placeholder through.
 */
const errorsFor = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(UpdateNotificationChannelDto, body)).filter((e) => e.property === 'webhookUrl');

describe('UpdateNotificationChannelDto webhookUrl', () => {
  // Value: protects=a channel read and saved back unchanged passes validation; fails_when=the @ValidateIf is dropped or keyed on another value, so every edit of an existing channel 400s on "webhookUrl must be a URL address"; why_new=the service spec calls the service directly and never runs class-validator; seam=none; no_claim=does not prove the service then keeps the stored URL (service spec does)
  it('accepts the masked placeholder', () => {
    expect(errorsFor({ name: 'renamed', webhookUrl: MASKED_WEBHOOK_URL })).toEqual([]);
  });

  // Value: protects=@IsUrl still applies to any value other than the placeholder; fails_when=the bypass is widened (e.g. ValidateIf returns false for any bracketed or non-empty string); why_new=nothing else validates this DTO; seam=none; no_claim=SSRF rules are the service's validateWebhookUrl, not this decorator
  it('still rejects a non-URL value', () => {
    const errors = errorsFor({ webhookUrl: 'not a url' });
    expect(errors).toHaveLength(1);
    expect(Object.keys(errors[0].constraints ?? {})).toContain('isUrl');
  });
});
