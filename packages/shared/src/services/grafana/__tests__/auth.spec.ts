import { grafanaAuthHeader, requireGrafanaAuthHeader } from '../auth';

/**
 * `grafana_instances.username`/`password` were stored, encrypted and masked, and then
 * never sent to Grafana: all ten call sites across apps/api, apps/grafana-sync and the
 * shared client hard-coded `Bearer ${apiKey}`. These cases pin the three things that
 * decision has to get right — which credential wins, that a row with neither produces
 * no header rather than `Bearer undefined`, and that the password is passed through
 * byte-for-byte.
 */
describe('grafanaAuthHeader', () => {
  it('prefers the API key when both are configured', () => {
    expect(
      grafanaAuthHeader({ apiKey: 'tkn', username: 'u', password: 'p' }),
    ).toBe('Bearer tkn');
  });

  it('falls back to basic auth when there is no API key', () => {
    expect(grafanaAuthHeader({ username: 'admin', password: 'pw' })).toBe(
      `Basic ${Buffer.from('admin:pw').toString('base64')}`,
    );
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('treats an API key that is %s as absent and uses basic auth', (_label, apiKey) => {
    expect(grafanaAuthHeader({ apiKey, username: 'admin', password: 'pw' })).toBe(
      `Basic ${Buffer.from('admin:pw').toString('base64')}`,
    );
  });

  it('trims a pasted API key, because a trailing newline is the common typo', () => {
    expect(grafanaAuthHeader({ apiKey: ' tkn\n' })).toBe('Bearer tkn');
  });

  it('does NOT trim the password — whitespace can be part of the secret', () => {
    const password = ' pad ';
    expect(grafanaAuthHeader({ username: 'admin', password })).toBe(
      `Basic ${Buffer.from(`admin: pad `).toString('base64')}`,
    );
  });

  it('encodes a non-ASCII password as UTF-8', () => {
    expect(grafanaAuthHeader({ username: 'admin', password: 'pwü' })).toBe(
      `Basic ${Buffer.from('admin:pwü', 'utf8').toString('base64')}`,
    );
  });

  it.each([
    ['nothing at all', {}],
    ['a username with no password', { username: 'admin' }],
    ['a password with no username', { password: 'pw' }],
    ['a blank username', { username: '  ', password: 'pw' }],
    ['every field blank', { apiKey: '', username: '', password: '' }],
  ])('returns null for %s', (_label, creds) => {
    expect(grafanaAuthHeader(creds)).toBeNull();
  });

  it('never produces a header containing "undefined"', () => {
    // The pre-fix shape, `Bearer ${instance.apiKey}`, rendered the literal string
    // "Bearer undefined" for a row with no key. Null is the whole point here.
    for (const creds of [{ apiKey: undefined }, { username: undefined, password: 'p' }]) {
      expect(String(grafanaAuthHeader(creds))).not.toContain('undefined');
    }
  });
});

describe('requireGrafanaAuthHeader', () => {
  it('returns the header when credentials exist', () => {
    expect(requireGrafanaAuthHeader({ apiKey: 'k' }, 'prod-grafana')).toBe('Bearer k');
  });

  it('throws a configuration error naming the instance', () => {
    expect(() => requireGrafanaAuthHeader({}, 'prod-grafana')).toThrow(
      /Grafana instance prod-grafana has no credentials configured/,
    );
  });

  it('names the instance as unknown when no label is passed', () => {
    expect(() => requireGrafanaAuthHeader({})).toThrow(/\(unknown\)/);
  });

  it('does not leak the password into the error message', () => {
    expect(() => requireGrafanaAuthHeader({ username: 'admin' }, 'g')).toThrow(
      /set an API key, or a username and password for basic auth/,
    );
  });
});
