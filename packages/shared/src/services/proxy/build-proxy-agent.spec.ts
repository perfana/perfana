import { buildProxyAgent, proxyConnection } from './build-proxy-agent';
import { ProxyServer } from '../../entities/proxy-server.entity';

const make = (over: Partial<ProxyServer>): ProxyServer =>
  Object.assign(new ProxyServer(), { proxyUrl: 'http://proxy.corp:3128', organizationId: 'o1' }, over);

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
