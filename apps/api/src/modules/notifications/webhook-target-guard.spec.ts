import type { LookupAddress } from 'node:dns';
import {
  BlockedWebhookTargetError,
  checkWebhookTarget,
  createGuardedLookup,
  isBlockedAddress,
  postJsonGuarded,
} from './webhook-target-guard';

type Answer = LookupAddress[] | NodeJS.ErrnoException;

/** A resolver that answers from a fixed table, like dns.lookup with { all: true }. */
const resolver = (table: Record<string, Answer>) =>
  ((hostname: string, _opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, a: LookupAddress[]) => void) => {
    const answer = table[hostname];
    if (!answer) cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), []);
    else if (answer instanceof Error) cb(answer, []);
    else cb(null, answer);
  }) as never;

const v4 = (address: string): LookupAddress => ({ address, family: 4 });
const v6 = (address: string): LookupAddress => ({ address, family: 6 });

describe('isBlockedAddress', () => {
  it.each([
    '10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '151.101.1.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (ip) => expect(isBlockedAddress(ip)).toBe(false),
  );

  it('blocks anything that is not an IP', () => expect(isBlockedAddress('example.com')).toBe(true));
});

describe('createGuardedLookup', () => {
  const run = (lookup: ReturnType<typeof createGuardedLookup>, host: string, opts: object) =>
    new Promise<{ err: Error | null; rest: unknown[] }>((resolve) =>
      (lookup as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)(
        host,
        opts,
        (err: unknown, ...rest: unknown[]) => resolve({ err: err as Error | null, rest }),
      ),
    );

  it('passes a public answer through in both callback shapes', async () => {
    const lookup = createGuardedLookup([], resolver({ 'catchup.acme.com': [v4('93.184.216.34')] }));

    expect((await run(lookup, 'catchup.acme.com', {})).rest).toEqual(['93.184.216.34', 4]);
    expect((await run(lookup, 'catchup.acme.com', { all: true })).rest).toEqual([[v4('93.184.216.34')]]);
  });

  it('refuses a host that resolves to a private address', async () => {
    const lookup = createGuardedLookup([], resolver({ 'catchup.acme.com': [v4('10.0.0.5')] }));

    const { err } = await run(lookup, 'catchup.acme.com', {});
    expect(err).toBeInstanceOf(BlockedWebhookTargetError);
    expect(err!.message).toContain('NOTIFICATION_WEBHOOK_ALLOWED_HOSTS');
  });

  it('refuses when ANY answer is private, since the connection may pick it', async () => {
    const lookup = createGuardedLookup([], resolver({ 'catchup.acme.com': [v4('93.184.216.34'), v6('fd00::1')] }));

    expect((await run(lookup, 'catchup.acme.com', { all: true })).err).toBeInstanceOf(BlockedWebhookTargetError);
  });

  it('lets an allowlisted host resolve to a private address', async () => {
    const lookup = createGuardedLookup(['catchup.acme.com'], resolver({ 'catchup.acme.com': [v4('10.0.0.5')] }));

    expect((await run(lookup, 'catchup.acme.com', {})).rest).toEqual(['10.0.0.5', 4]);
  });

  it('honours a requested address family', async () => {
    const lookup = createGuardedLookup([], resolver({ h: [v4('93.184.216.34'), v6('2606:4700::1111')] }));

    expect((await run(lookup, 'h', { family: 6 })).rest).toEqual(['2606:4700::1111', 6]);
  });
});

describe('checkWebhookTarget', () => {
  it('reports ok for a public host', async () => {
    await expect(checkWebhookTarget('catchup.acme.com', [], resolver({ 'catchup.acme.com': [v4('93.184.216.34')] })))
      .resolves.toEqual({ ok: true });
  });

  it('reports a private resolution with the setting that allows it', async () => {
    const result = await checkWebhookTarget('catchup.acme.com', [], resolver({ 'catchup.acme.com': [v4('192.168.4.4')] }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('NOTIFICATION_WEBHOOK_ALLOWED_HOSTS') });
  });

  it('reports a host that does not resolve', async () => {
    const result = await checkWebhookTarget('nowhere.acme.com', [], resolver({}));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('could not be resolved') });
  });
});

describe('postJsonGuarded', () => {
  it('refuses a private IP literal without connecting (Node skips lookup for literals)', async () => {
    await expect(postJsonGuarded('https://10.0.0.5/hooks/d59ff08b4c96bc49bd3944e223', {}, []))
      .rejects.toBeInstanceOf(BlockedWebhookTargetError);
  });

  it('refuses a host resolving privately before any request is sent', async () => {
    await expect(
      postJsonGuarded(
        'https://catchup.acme.com/hooks/d59ff08b4c96bc49bd3944e223',
        {},
        [],
        resolver({ 'catchup.acme.com': [v4('10.0.0.5')] }),
      ),
    ).rejects.toBeInstanceOf(BlockedWebhookTargetError);
  });

  it('hands an allowlisted answer to the real https stack (reaches the socket: nothing listens on port 1)', async () => {
    const err = await postJsonGuarded(
      'https://mm.corp.local:1/hooks/d59ff08b4c96bc49bd3944e223',
      {},
      ['mm.corp.local'],
      resolver({ 'mm.corp.local': [v4('127.0.0.1')] }),
    ).catch((e: NodeJS.ErrnoException) => e);

    expect(err).not.toBeInstanceOf(BlockedWebhookTargetError);
    expect((err as NodeJS.ErrnoException).code).toBe('ECONNREFUSED');
  });
});

