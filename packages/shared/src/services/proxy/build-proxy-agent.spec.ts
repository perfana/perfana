import { buildProxyAgent, proxyConnection, normalizeNoProxy, _agentCacheForTests } from './build-proxy-agent';
import { ProxyServer } from '../../entities/proxy-server.entity';

const make = (over: Partial<ProxyServer>): ProxyServer =>
  Object.assign(new ProxyServer(), { proxyUrl: 'http://proxy.corp:3128', organizationId: 'o1' }, over);

beforeEach(() => {
  _agentCacheForTests.clear();
});

describe('buildProxyAgent', () => {
  it('returns null when proxy is null', () => {
    expect(buildProxyAgent(null)).toBeNull();
  });

  it('returns null when proxyUrl is empty', () => {
    expect(buildProxyAgent(make({ proxyUrl: '' }))).toBeNull();
  });

  it('builds host/port axios config with no auth', () => {
    const r = buildProxyAgent(make({}))!;
    expect(r.axiosProxy).toEqual({ host: 'proxy.corp', port: 3128, protocol: 'http:' });
    expect(r.dispatcher).toBeDefined();
  });

  it('includes basic auth when username+password present', () => {
    const r = buildProxyAgent(make({ username: 'u', password: 'p' }))!;
    expect(r.axiosProxy.auth).toEqual({ username: 'u', password: 'p' });
  });

  it('returns the SAME dispatcher on repeated calls with the same proxy (cache hit)', () => {
    const proxy = make({});
    const r1 = buildProxyAgent(proxy)!;
    const r2 = buildProxyAgent(proxy)!;
    expect(r1.dispatcher).toBe(r2.dispatcher);
  });

  it('returns DIFFERENT dispatchers for different proxy URLs (cache miss)', () => {
    const r1 = buildProxyAgent(make({ proxyUrl: 'http://proxy-a.corp:3128' }))!;
    const r2 = buildProxyAgent(make({ proxyUrl: 'http://proxy-b.corp:3128' }))!;
    expect(r1.dispatcher).not.toBe(r2.dispatcher);
  });

  it('returns DIFFERENT dispatchers for different credentials on the same host (new key)', () => {
    const r1 = buildProxyAgent(make({ username: 'u1', password: 'p1' }))!;
    const r2 = buildProxyAgent(make({ username: 'u2', password: 'p2' }))!;
    expect(r1.dispatcher).not.toBe(r2.dispatcher);
  });

  it('axiosProxy is always a fresh plain object (no reference reuse)', () => {
    const proxy = make({});
    const r1 = buildProxyAgent(proxy)!;
    const r2 = buildProxyAgent(proxy)!;
    expect(r1.axiosProxy).not.toBe(r2.axiosProxy);
  });
});

describe('proxyConnection', () => {
  it('returns null when proxy is null', () => {
    expect(proxyConnection(null)).toBeNull();
  });

  it('returns uri without token when no credentials', () => {
    const r = proxyConnection(make({}))!;
    expect(r.uri).toBe('http://proxy.corp:3128');
    expect(r.token).toBeUndefined();
  });

  it('returns Basic token when username+password present', () => {
    const r = proxyConnection(make({ username: 'u', password: 'p' }))!;
    expect(r.token).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });
});

describe('normalizeNoProxy', () => {
  it('rewrites a leading glob star (no dot) into a dot so undici matches subdomains', () => {
    // The field bug: `*ba.uwv.nl` was kept literal by undici and never matched.
    expect(normalizeNoProxy('*ba.uwv.nl')).toBe('.ba.uwv.nl');
  });

  it('leaves already-valid forms untouched', () => {
    expect(normalizeNoProxy('.ba.uwv.nl')).toBe('.ba.uwv.nl');
    expect(normalizeNoProxy('*.ba.uwv.nl')).toBe('*.ba.uwv.nl');
    expect(normalizeNoProxy('ba.uwv.nl')).toBe('ba.uwv.nl');
  });

  it('normalizes only the offending entry in a full list', () => {
    expect(normalizeNoProxy('localhost,127.0.0.1,.svc,*ba.uwv.nl,grafana-pto'))
      .toBe('localhost,127.0.0.1,.svc,.ba.uwv.nl,grafana-pto');
  });

  it('handles comma+whitespace separators and trims blanks', () => {
    expect(normalizeNoProxy('localhost, *ba.uwv.nl ,, grafana')).toBe('localhost,.ba.uwv.nl,grafana');
  });

  it('returns undefined for empty/absent input', () => {
    expect(normalizeNoProxy(undefined)).toBeUndefined();
    expect(normalizeNoProxy('')).toBeUndefined();
    expect(normalizeNoProxy('   ')).toBeUndefined();
  });
});
