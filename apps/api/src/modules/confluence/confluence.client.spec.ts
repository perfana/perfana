import { ConfluenceConnection, ConfluenceError, uploadAttachments, upsertPage } from './confluence.client';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fetch that answers from a route table and records every call. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, headers: init.headers as Record<string, string>, body: init.body });
    const route = routes[`${method} ${url}`];
    if (!route) return new Response('{"message":"no route"}', { status: 404 });
    return new Response(route.body === undefined ? '' : JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const cloud: ConfluenceConnection = { baseUrl: 'https://acme.atlassian.net', deployment: 'cloud', username: 'me@acme.io', apiToken: 'tok' };
const dc: ConfluenceConnection = { baseUrl: 'https://wiki.acme.io/confluence', deployment: 'datacenter', apiToken: 'pat' };

describe('confluence client', () => {
  it('creates a Cloud page through v2 under /wiki, resolving the space key to its id, with Basic auth', async () => {
    const { impl, calls } = fakeFetch({
      'GET https://acme.atlassian.net/wiki/api/v2/spaces?keys=PERF': { body: { results: [{ id: 42, name: 'Perf' }] } },
      'POST https://acme.atlassian.net/wiki/api/v2/pages': { body: { id: '9001', _links: { base: 'https://acme.atlassian.net/wiki', webui: '/spaces/PERF/pages/9001' } } },
    });
    const page = await upsertPage(cloud, { spaceKey: 'PERF', parentPageId: '77', title: 'T', storage: '<p>x</p>' }, { fetchImpl: impl });

    expect(page).toEqual({ id: '9001', url: 'https://acme.atlassian.net/wiki/spaces/PERF/pages/9001' });
    expect(JSON.parse(calls[1]!.body as string)).toEqual({
      spaceId: '42', status: 'current', title: 'T', parentId: '77', body: { representation: 'storage', value: '<p>x</p>' },
    });
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('me@acme.io:tok').toString('base64')}`);
  });

  it('updates an existing Data Center page through v1 as the next version, with Bearer auth', async () => {
    const { impl, calls } = fakeFetch({
      'GET https://wiki.acme.io/confluence/rest/api/content/123?expand=version,space': { body: { version: { number: 4 }, space: { key: 'PERF' } } },
      'PUT https://wiki.acme.io/confluence/rest/api/content/123': { body: { _links: { base: 'https://wiki.acme.io/confluence', webui: '/display/PERF/T' } } },
    });
    const page = await upsertPage(dc, { spaceKey: 'PERF', existingPageId: '123', title: 'T', storage: '<p>y</p>' }, { fetchImpl: impl });

    expect(page.url).toBe('https://wiki.acme.io/confluence/display/PERF/T');
    const body = JSON.parse(calls[1]!.body as string);
    expect(body.version.number).toBe(5);
    expect(body.body).toEqual({ storage: { value: '<p>y</p>', representation: 'storage' } });
    expect(calls[0]!.headers.Authorization).toBe('Bearer pat');
  });

  it('creates a fresh page when the previously published one is gone', async () => {
    const { impl, calls } = fakeFetch({
      'POST https://wiki.acme.io/confluence/rest/api/content': { body: { id: 555, _links: { webui: '/display/PERF/T' } } },
    });
    const page = await upsertPage(dc, { spaceKey: 'PERF', parentPageId: '9', existingPageId: '123', title: 'T', storage: '' }, { fetchImpl: impl });

    expect(page.id).toBe('555');
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({ type: 'page', space: { key: 'PERF' }, ancestors: [{ id: '9' }] });
  });

  it.each([
    ['a javascript: webui', { webui: 'javascript:alert(1)' }],
    ['a protocol-relative webui', { webui: '//evil.example/x' }],
    ['a foreign _links.base', { base: 'https://evil.example', webui: '/display/PERF/T' }],
  ])('never stores a link built from %s', async (_label, links) => {
    const { impl } = fakeFetch({
      'POST https://wiki.acme.io/confluence/rest/api/content': { body: { id: 7, _links: links } },
    });
    const page = await upsertPage(dc, { spaceKey: 'PERF', title: 'T', storage: '' }, { fetchImpl: impl });
    expect(new URL(page.url).host).toBe('wiki.acme.io');
    expect(page.url).toMatch(/^https:\/\/wiki\.acme\.io\/confluence\//);
  });

  it("surfaces Confluence's own reason for a refusal", async () => {
    const { impl } = fakeFetch({
      'POST https://wiki.acme.io/confluence/rest/api/content': {
        status: 400,
        body: { statusCode: 400, message: 'A page with this title already exists: A page already exists with the title T in the space with key PERF' },
      },
    });
    await expect(upsertPage(dc, { spaceKey: 'PERF', title: 'T', storage: '' }, { fetchImpl: impl })).rejects.toThrow(/already exists/);
  });

  it('refuses to send a Cloud request without the account email', async () => {
    await expect(upsertPage({ ...cloud, username: null }, { spaceKey: 'P', title: 'T', storage: '' }, { fetchImpl: fakeFetch({}).impl }))
      .rejects.toBeInstanceOf(ConfluenceError);
  });

  it('uploads Cloud attachments with PUT (create or replace) in batches of 10, with the XSRF header', async () => {
    const url = 'PUT https://acme.atlassian.net/wiki/rest/api/content/123/child/attachment';
    const { impl, calls } = fakeFetch({ [url]: { body: { results: [] } } });
    const files = Array.from({ length: 12 }, (_, i) => ({ filename: `chart-${i}.png`, data: Buffer.from([i]), contentType: 'image/png' }));
    await uploadAttachments(cloud, '123', files, { fetchImpl: impl });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([url, url]);
    expect(calls[0]!.headers['X-Atlassian-Token']).toBe('no-check');
    expect((calls[0]!.body as FormData).getAll('file')).toHaveLength(10);
    expect((calls[1]!.body as FormData).getAll('file')).toHaveLength(2);
  });

  /*
   * Value: protects=publishing to Data Center, which answers PUT on the attachment collection with 405;
   *   fails_when=Data Center is sent the Cloud PUT, or an existing file is re-POSTed instead of replaced;
   *   why_new=the only upload test used PUT against a Data Center connection, mirroring the mock;
   *   seam=none; no_claim=real Data Center (fake fetch; unit only)
   */
  it('on Data Center POSTs new files in batches and replaces existing ones through their /data endpoint, never PUT', async () => {
    const root = 'https://wiki.acme.io/confluence/rest/api/content/123/child/attachment';
    const { impl, calls } = fakeFetch({
      [`GET ${root}?limit=1000`]: { body: { results: [{ id: 'att7', title: 'chart-0.png' }] } },
      [`POST ${root}`]: { body: { results: [] } },
      [`POST ${root}/att7/data`]: { body: {} },
    });
    const files = Array.from({ length: 12 }, (_, i) => ({ filename: `chart-${i}.png`, data: Buffer.from([i]), contentType: 'image/png' }));
    await uploadAttachments(dc, '123', files, { fetchImpl: impl });

    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${root}?limit=1000`, `POST ${root}`, `POST ${root}`, `POST ${root}/att7/data`]);
    expect((calls[1]!.body as FormData).getAll('file')).toHaveLength(10);
    expect((calls[2]!.body as FormData).getAll('file')).toHaveLength(1);
    expect(((calls[3]!.body as FormData).get('file') as File).name).toBe('chart-0.png');
    expect(calls.slice(1).every((c) => c.headers['X-Atlassian-Token'] === 'no-check')).toBe(true);
  });

  it('names the refused call when Confluence gives no reason', async () => {
    const impl = (async () => new Response('', { status: 405 })) as unknown as typeof fetch;
    await expect(uploadAttachments(cloud, '123', [{ filename: 'a.png', data: Buffer.from([1]), contentType: 'image/png' }], { fetchImpl: impl }))
      .rejects.toThrow('Confluence answered HTTP 405 to PUT /rest/api/content/123/child/attachment');
  });

  /*
   * Generated by the /ship test coverage audit (pass 2).
   * Value: protects=each failure shape gives its own actionable ConfluenceError (status kept);
   *   fails_when=a status mapping, the non-JSON guard or the network wrapper is dropped;
   *   why_new=only a 400 message and a missing email were covered; seam=none;
   *   no_claim=real Confluence wording (scripted fetch; unit only)
   */
  const raw = (status: number, text: string) =>
    (async () => new Response(text, { status })) as unknown as typeof fetch;
  it.each([
    ['401', dc, raw(401, '{"message":"x"}'), /rejected the credentials \(401\)/, 401],
    ['403 with its reason', dc, raw(403, '{"message":"not permitted to view"}'), /lacks permission.*\(403\): not permitted to view/, 403],
    ['a 200 HTML login page', dc, raw(200, '<html>Log in</html>'), /something other than JSON/, undefined],
    ['a network failure', dc, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, /Could not reach Confluence at wiki\.acme\.io/, undefined],
    ['an unknown Cloud space', cloud, raw(200, '{"results":[]}'), /Space "PERF" was not found/, 404],
  ])('turns %s into a ConfluenceError that says what to fix', async (_l, conn, impl, message, status) => {
    const err = await upsertPage(conn, { spaceKey: 'PERF', title: 'T', storage: '' }, { fetchImpl: impl }).catch((e) => e);
    expect(err).toBeInstanceOf(ConfluenceError);
    expect(err.message).toMatch(message);
    expect(err.status).toBe(status);
  });

  /*
   * Value: protects=a republish whose version lookup fails for any reason but 404 never creates a second page;
   *   fails_when=currentVersion swallows every error as "page gone"; why_new=only the 404 arm was covered;
   *   seam=none; no_claim=real Confluence (fake fetch; unit only)
   */
  it('rethrows a non-404 failure reading the earlier page and never POSTs a new one', async () => {
    const { impl, calls } = fakeFetch({
      'GET https://wiki.acme.io/confluence/rest/api/content/123?expand=version,space': { status: 500, body: { message: 'boom' } },
    });
    await expect(upsertPage(dc, { spaceKey: 'PERF', existingPageId: '123', title: 'T', storage: '' }, { fetchImpl: impl }))
      .rejects.toMatchObject({ status: 500 });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  /*
   * Value: protects=a republish never overwrites a page outside the configured space (a connection
   *   re-pointed at another host or space keeps the report's stored page id); fails_when=the space
   *   check in currentVersion is removed or inverted; why_new=the update test only covers a page in
   *   the right space; seam=none; no_claim=real Confluence (fake fetch; unit only)
   */
  it.each([
    ['Data Center', dc, {
      'GET https://wiki.acme.io/confluence/rest/api/content/123?expand=version,space': { body: { version: { number: 4 }, space: { key: 'OTHER' } } },
      'POST https://wiki.acme.io/confluence/rest/api/content': { body: { id: 556, _links: { webui: '/display/PERF/T' } } },
    }],
    ['Cloud', cloud, {
      'GET https://acme.atlassian.net/wiki/api/v2/pages/123': { body: { version: { number: 4 }, spaceId: '7' } },
      'GET https://acme.atlassian.net/wiki/api/v2/spaces?keys=PERF': { body: { results: [{ id: 42, name: 'Perf' }] } },
      'POST https://acme.atlassian.net/wiki/api/v2/pages': { body: { id: '556', _links: { webui: '/spaces/PERF/pages/556' } } },
    }],
  ] as const)('creates a new page instead of updating a %s page that sits in another space', async (_label, conn, routes) => {
    const { impl, calls } = fakeFetch(routes as Record<string, { status?: number; body?: unknown }>);
    const page = await upsertPage(conn, { spaceKey: 'PERF', existingPageId: '123', title: 'T', storage: '' }, { fetchImpl: impl });

    expect(page.id).toBe('556');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});
