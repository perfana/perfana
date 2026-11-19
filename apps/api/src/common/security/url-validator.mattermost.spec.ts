import { isHostAllowlisted, parseAllowedHosts, validateWebhookUrl } from './url-validator';

const KEY = 'd59ff08b4c96bc49bd3944e223';

describe('validateWebhookUrl for Mattermost', () => {
  const valid = (url: string, allowedHosts: string[] = []) =>
    validateWebhookUrl(url, 'mattermost', { allowedHosts });

  it('accepts a Mattermost hook on any public-looking host', () => {
    expect(valid(`https://catchup.acme.com/hooks/${KEY}`).isValid).toBe(true);
  });

  it('accepts a hook under a sub-path and on a non-default port', () => {
    expect(valid(`https://acme.com:8443/chat/hooks/${KEY}`).isValid).toBe(true);
  });

  it.each([
    ['http', `http://catchup.acme.com/hooks/${KEY}`, 'HTTPS is required'],
    ['a non-hook path', 'https://catchup.acme.com/api/v4/users', '/hooks/<26-character key>'],
    ['a short key', 'https://catchup.acme.com/hooks/abc', '/hooks/<26-character key>'],
    ['an upper-case key', `https://catchup.acme.com/hooks/${KEY.toUpperCase()}`, '/hooks/<26-character key>'],
    ['a trailing path', `https://catchup.acme.com/hooks/${KEY}/x`, '/hooks/<26-character key>'],
    ['a query string', `https://catchup.acme.com/hooks/${KEY}?x=1`, 'no query string'],
    ['credentials', `https://u:p@catchup.acme.com/hooks/${KEY}`, 'credentials'],
  ])('refuses %s', (_label, url, error) => {
    const result = valid(url);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain(error);
  });

  it.each(['10.0.0.5', '127.0.0.1', '192.168.1.10', 'localhost', '[::1]'])(
    'refuses the internal address %s and names the setting that allows it',
    (host) => {
      const result = valid(`https://${host}/hooks/${KEY}`);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('NOTIFICATION_WEBHOOK_ALLOWED_HOSTS');
    },
  );

  it('accepts an internal address the operator allowlisted', () => {
    expect(valid(`https://10.0.0.5/hooks/${KEY}`, ['10.0.0.5']).isValid).toBe(true);
  });

  it('refuses a metadata endpoint even when allowlisted', () => {
    const result = valid(`https://169.254.169.254/hooks/${KEY}`, ['169.254.169.254']);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('metadata');
  });

  it('leaves the Slack and Teams rules unchanged', () => {
    expect(validateWebhookUrl('https://hooks.slack.com/services/T/B/x').isValid).toBe(true);
    expect(validateWebhookUrl(`https://catchup.acme.com/hooks/${KEY}`).isValid).toBe(false);
    expect(validateWebhookUrl(`https://catchup.acme.com/hooks/${KEY}`, 'teams').isValid).toBe(false);
  });
});

describe('parseAllowedHosts / isHostAllowlisted', () => {
  it('splits on commas and whitespace, lowercases and reduces URLs to their host', () => {
    expect(parseAllowedHosts(' Catchup.Acme.com, *.corp.local\nhttps://chat.acme.com/hooks/x ,, ')).toEqual([
      'catchup.acme.com',
      '*.corp.local',
      'chat.acme.com',
    ]);
  });

  it('returns [] for an unset value', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('')).toEqual([]);
  });

  it('matches exact names and wildcard subdomains, not lookalikes', () => {
    const list = ['catchup.acme.com', '*.corp.local'];
    expect(isHostAllowlisted('CATCHUP.acme.com.', list)).toBe(true);
    expect(isHostAllowlisted('mm.corp.local', list)).toBe(true);
    expect(isHostAllowlisted('corp.local', list)).toBe(true);
    expect(isHostAllowlisted('evilcorp.local', list)).toBe(false);
    expect(isHostAllowlisted('catchup.acme.com.evil.io', list)).toBe(false);
  });
});
