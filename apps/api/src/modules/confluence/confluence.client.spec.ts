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
      'GET https://wiki.acme.io/confluence/rest/api/content/123?expand=version': { body: { version: { number: 4 } } },
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

  it('uploads attachments with PUT (create or replace) in batches of 10, with the XSRF header', async () => {
    const url = 'PUT https://wiki.acme.io/confluence/rest/api/content/123/child/attachment';
    const { impl, calls } = fakeFetch({ [url]: { body: { results: [] } } });
    const files = Array.from({ length: 12 }, (_, i) => ({ filename: `chart-${i}.png`, data: Buffer.from([i]), contentType: 'image/png' }));
    await uploadAttachments(dc, '123', files, { fetchImpl: impl });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers['X-Atlassian-Token']).toBe('no-check');
    expect((calls[0]!.body as FormData).getAll('file')).toHaveLength(10);
    expect((calls[1]!.body as FormData).getAll('file')).toHaveLength(2);
  });
});
