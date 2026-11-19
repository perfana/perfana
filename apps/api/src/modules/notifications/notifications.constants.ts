/**
 * Placeholder returned instead of a stored webhook URL. An incoming-webhook URL is a
 * bearer credential: anyone holding it can post into that Slack/Teams channel, so it
 * never leaves the API once saved. An update that sends this value back keeps the
 * stored URL, which lets a client GET a channel and PUT it back unchanged.
 */
export const MASKED_WEBHOOK_URL = '[MASKED]';
