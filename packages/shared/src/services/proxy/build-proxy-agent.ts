import { ProxyAgent } from 'undici';
import { ProxyServer } from '../../entities/proxy-server.entity';

export interface ProxyAgents {
  dispatcher: ProxyAgent;
  axiosProxy: { host: string; port: number; protocol: string; auth?: { username: string; password: string } };
}

export function buildProxyAgent(proxy: ProxyServer | null | undefined): ProxyAgents | null {
  if (!proxy || !proxy.proxyUrl) return null;
  const url = new URL(proxy.proxyUrl);
  const hasAuth = !!proxy.username && !!proxy.password;
  const token = hasAuth
    ? `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`
    : undefined;

  const dispatcher = new ProxyAgent({ uri: url.origin, token });
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  return {
    dispatcher,
    axiosProxy: {
      host: url.hostname,
      port,
      protocol: url.protocol,
      ...(hasAuth ? { auth: { username: proxy.username!, password: proxy.password! } } : {}),
    },
  };
}
// ponytail: axios native proxy uses CONNECT tunneling for https targets — swap in
// https-proxy-agent only if a proxied HTTPS target proves flaky in the field.
