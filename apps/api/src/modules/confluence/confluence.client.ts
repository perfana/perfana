import { describeFetchError } from '@perfana/shared/services/splunk/client';
import type { ConfluenceDeployment } from '@perfana/shared/entities';

/**
 * The handful of Confluence REST calls publishing needs.
 *
 * Pages: Cloud uses REST v2 (`/wiki/api/v2/pages`), because Atlassian has been retiring the v1
 * content endpoints there; Data Center / Server only has v1 (`/rest/api/content`). Attachments are
 * v1 on both, since v2 has no upload — `PUT .../child/attachment` creates or replaces by filename,
 * which is what makes a republish idempotent.
 */

export interface ConfluenceConnection {
  baseUrl: string;
  deployment: ConfluenceDeployment;
  username?: string | null;
  apiToken: string;
}

export interface ConfluenceRequestOptions {
  /** undici dispatcher from the org's proxy resolver, when the config has use_proxy. */
  dispatcher?: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ConfluenceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ConfluenceError';
  }
}

export interface PublishedPage {
  id: string;
  url: string;
}

export interface PageAttachment {
  filename: string;
  data: Buffer;
  contentType: string;
}

// Each upload is one multipart request; keep any one of them well under a proxy's body limit.
const ATTACHMENTS_PER_REQUEST = 10;

/** Cloud's REST root sits under /wiki; Data Center's base URL already includes any context path. */
const apiRoot = (c: ConfluenceConnection): string => (c.deployment === 'cloud' ? `${c.baseUrl}/wiki` : c.baseUrl);

function authorization(c: ConfluenceConnection): string {
  if (c.deployment === 'cloud') {
    if (!c.username) throw new ConfluenceError('Confluence Cloud needs the Atlassian account email with the API token');
    return `Basic ${Buffer.from(`${c.username}:${c.apiToken}`).toString('base64')}`;
  }
  return `Bearer ${c.apiToken}`;
}

/** Pulls the human-readable reason out of the three error shapes Confluence answers with. */
function extractMessage(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as {
      message?: string;
      errors?: Array<{ title?: string; detail?: string }>;
      data?: { errors?: Array<{ message?: { translation?: string; key?: string } | string }> };
    };
    const v2 = json.errors?.[0];
    if (v2) return v2.detail || v2.title;
    const dcDetail = json.data?.errors?.[0]?.message;
    if (dcDetail) return typeof dcDetail === 'string' ? dcDetail : dcDetail.translation ?? dcDetail.key;
    return json.message;
  } catch {
    return undefined;
  }
}

async function call<T>(c: ConfluenceConnection, path: string, init: RequestInit, opts: ConfluenceRequestOptions): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const auth = authorization(c);
  let res: Response;
  try {
    res = await doFetch(`${apiRoot(c)}${path}`, {
      ...init,
      headers: { Authorization: auth, Accept: 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      // Never follow a redirect: the token must only ever reach the configured host.
      redirect: 'error',
      ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
    } as RequestInit);
  } catch (err) {
    throw new ConfluenceError(`Could not reach Confluence at ${new URL(c.baseUrl).host}: ${describeFetchError(err)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const reason = extractMessage(text);
    if (res.status === 401) throw new ConfluenceError('Confluence rejected the credentials (401)', 401);
    if (res.status === 403) throw new ConfluenceError(`The Confluence account lacks permission for this (403)${reason ? `: ${reason}` : ''}`, 403);
    throw new ConfluenceError(reason ?? `Confluence answered HTTP ${res.status}`, res.status);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // An SSO login page or a proxy's error page answers 200 with HTML.
    throw new ConfluenceError(`Confluence answered with something other than JSON — is ${c.baseUrl} the Confluence base URL?`);
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

interface Links {
  _links?: { base?: string; webui?: string };
}

/**
 * The page's browser URL. It is stored and later rendered as a link, so it is built on the
 * configured host and never on `_links.base`, and anything that resolves to another scheme or host
 * (a `javascript:` webui, a `//evil` path) falls back to the id URL.
 */
function pageUrl(c: ConfluenceConnection, page: Links, fallbackId: string): string {
  const fallback = `${apiRoot(c)}/pages/viewpage.action?pageId=${encodeURIComponent(fallbackId)}`;
  const webui = page._links?.webui;
  if (!webui || !webui.startsWith('/') || webui.startsWith('//')) return fallback;
  try {
    const candidate = new URL(`${apiRoot(c)}${webui}`);
    const expected = new URL(c.baseUrl);
    return /^https?:$/.test(candidate.protocol) && candidate.host === expected.host ? candidate.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** Resolves the space and returns its display name; doubles as the connection test. */
export async function confluenceSpace(c: ConfluenceConnection, spaceKey: string, opts: ConfluenceRequestOptions = {}): Promise<{ id: string; name: string; homepageId?: string }> {
  if (c.deployment === 'cloud') {
    const res = await call<{ results: Array<{ id: string; name: string; homepageId?: string | number | null }> }>(c, `/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`, { method: 'GET' }, opts);
    const space = res.results?.[0];
    if (!space) throw new ConfluenceError(`Space "${spaceKey}" was not found, or this account cannot see it`, 404);
    return { id: String(space.id), name: space.name, ...(space.homepageId ? { homepageId: String(space.homepageId) } : {}) };
  }
  const space = await call<{ id: number; name: string }>(c, `/rest/api/space/${encodeURIComponent(spaceKey)}`, { method: 'GET' }, opts);
  return { id: String(space.id), name: space.name };
}

/**
 * The current version of a page, or null when it no longer exists (deleted, or moved out of reach)
 * or sits outside the configured space. The space check matters because a page id is only unique
 * within one Confluence: after a connection is pointed at another host or space, the stored id can
 * name an unrelated page there, and updating it would overwrite someone else's page.
 */
async function currentVersion(c: ConfluenceConnection, pageId: string, spaceKey: string, opts: ConfluenceRequestOptions): Promise<number | null> {
  const path = c.deployment === 'cloud' ? `/api/v2/pages/${encodeURIComponent(pageId)}` : `/rest/api/content/${encodeURIComponent(pageId)}?expand=version,space`;
  try {
    const page = await call<{ version?: { number?: number }; spaceId?: string | number; space?: { key?: string } }>(c, path, { method: 'GET' }, opts);
    const inSpace = c.deployment === 'cloud'
      ? page.spaceId !== undefined && String(page.spaceId) === (await confluenceSpace(c, spaceKey, opts)).id
      : page.space?.key?.toUpperCase() === spaceKey.toUpperCase();
    return inSpace ? page.version?.number ?? null : null;
  } catch (err) {
    if (err instanceof ConfluenceError && err.status === 404) return null;
    throw err;
  }
}

export interface UpsertPageInput {
  spaceKey: string;
  parentPageId?: string | null;
  /** The page this report was published to before; updated in place when it still exists. */
  existingPageId?: string | null;
  title: string;
  storage: string;
}

export async function upsertPage(c: ConfluenceConnection, input: UpsertPageInput, opts: ConfluenceRequestOptions = {}): Promise<PublishedPage> {
  const version = input.existingPageId ? await currentVersion(c, input.existingPageId, input.spaceKey, opts) : null;

  if (input.existingPageId && version !== null) {
    const id = input.existingPageId;
    const next = { number: version + 1, message: 'Republished from Perfana' };
    const page =
      c.deployment === 'cloud'
        ? await call<Links>(c, `/api/v2/pages/${encodeURIComponent(id)}`, json('PUT', {
            id, status: 'current', title: input.title, version: next,
            body: { representation: 'storage', value: input.storage },
          }), opts)
        : await call<Links>(c, `/rest/api/content/${encodeURIComponent(id)}`, json('PUT', {
            id, type: 'page', title: input.title, version: next,
            body: { storage: { value: input.storage, representation: 'storage' } },
          }), opts);
    return { id, url: pageUrl(c, page, id) };
  }

  return createPage(c, input.spaceKey, input.parentPageId, input.title, input.storage, opts);
}

async function createPage(c: ConfluenceConnection, spaceKey: string, parentPageId: string | null | undefined, title: string, storage: string, opts: ConfluenceRequestOptions): Promise<PublishedPage> {
  if (c.deployment === 'cloud') {
    const space = await confluenceSpace(c, spaceKey, opts);
    const page = await call<Links & { id: string }>(c, '/api/v2/pages', json('POST', {
      spaceId: space.id, status: 'current', title,
      ...(parentPageId ? { parentId: parentPageId } : {}),
      body: { representation: 'storage', value: storage },
    }), opts);
    return { id: String(page.id), url: pageUrl(c, page, String(page.id)) };
  }
  const page = await call<Links & { id: string }>(c, '/rest/api/content', json('POST', {
    type: 'page', title, space: { key: spaceKey },
    ...(parentPageId ? { ancestors: [{ id: parentPageId }] } : {}),
    body: { storage: { value: storage, representation: 'storage' } },
  }), opts);
  return { id: String(page.id), url: pageUrl(c, page, String(page.id)) };
}

/** Splits "A / B / C" into its page titles; empty segments are dropped. */
export function parsePagePath(path: string | null | undefined): string[] {
  // ponytail: '/' is the separator, so a title that itself contains '/' cannot be a path level.
  return (path ?? '').split('/').map((t) => t.trim()).filter(Boolean);
}

/** A page with this title directly under `parentId` (or at the space root when null), else null. */
async function findChildPage(c: ConfluenceConnection, spaceKey: string, parentId: string | null, title: string, opts: ConfluenceRequestOptions): Promise<string | null> {
  if (c.deployment === 'cloud') {
    const space = await confluenceSpace(c, spaceKey, opts);
    const res = await call<{ results?: Array<{ id: string | number; parentId?: string | number | null }> }>(
      c, `/api/v2/pages?space-id=${encodeURIComponent(space.id)}&title=${encodeURIComponent(title)}&status=current&limit=250`, { method: 'GET' }, opts);
    // Cloud files a top-level page under the space homepage, so at the root either counts.
    const hit = res.results?.find((p) => (parentId ? String(p.parentId ?? '') === parentId : !p.parentId || String(p.parentId) === space.homepageId));
    return hit ? String(hit.id) : null;
  }
  const res = await call<{ results?: Array<{ id: string | number; ancestors?: Array<{ id: string | number }> }> }>(
    c, `/rest/api/content?type=page&spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(title)}&expand=ancestors&limit=250`, { method: 'GET' }, opts);
  const hit = res.results?.find((p) => {
    const direct = p.ancestors?.at(-1);
    return parentId ? String(direct?.id ?? '') === parentId : !direct;
  });
  return hit ? String(hit.id) : null;
}

// A container page lists what is published under it.
const CONTAINER_BODY = '<ac:structured-macro ac:name="children" ac:schema-version="2" />';

/**
 * Walks `titles` down from `rootParentId` (the connection's parent page, or the space root),
 * creating each level that does not exist yet, and returns the id of the last one. Only a page
 * directly under the previous level counts as a match: a same-titled page elsewhere in the space
 * is never adopted, so a report cannot land under an unrelated page.
 */
export async function ensurePagePath(c: ConfluenceConnection, spaceKey: string, rootParentId: string | null | undefined, titles: string[], opts: ConfluenceRequestOptions = {}): Promise<string | null> {
  let parent = rootParentId || null;
  for (const title of titles) {
    parent = (await findChildPage(c, spaceKey, parent, title, opts)) ?? (await createPage(c, spaceKey, parent, title, CONTAINER_BODY, opts)).id;
  }
  return parent;
}

/** Creates or replaces each file by name on the page. */
export async function uploadAttachments(c: ConfluenceConnection, pageId: string, files: PageAttachment[], opts: ConfluenceRequestOptions = {}): Promise<void> {
  for (let i = 0; i < files.length; i += ATTACHMENTS_PER_REQUEST) {
    const form = new FormData();
    for (const f of files.slice(i, i + ATTACHMENTS_PER_REQUEST)) {
      form.append('file', new Blob([new Uint8Array(f.data)], { type: f.contentType }), f.filename);
    }
    form.append('minorEdit', 'true');
    // Confluence's XSRF check refuses a multipart POST/PUT without this header.
    await call(c, `/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`, {
      method: 'PUT',
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: form,
    }, { timeoutMs: 120_000, ...opts });
  }
}
