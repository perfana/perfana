/**
 * The one place that decides how Perfana authenticates to a Grafana instance.
 *
 * A service-account token (`grafana_instances.api_key`) is the recommended setup and
 * wins whenever it is present. `username`/`password` are the fallback for a Grafana
 * fronted by HTTP basic auth, or an install with no service accounts. Both columns
 * have existed on the entity, the DTOs and the integration dialog all along — they
 * were stored, encrypted and masked, and then never sent to Grafana by anything.
 *
 * Every caller builds its header here: `apps/api`'s `GrafanaClientService`,
 * `apps/grafana-sync`'s `GrafanaApiService`, and the shared `GrafanaClient` the
 * worker queries panels with. A call site that hand-rolls `Bearer ${apiKey}` again
 * silently loses basic auth for that one endpoint, which is how this started.
 */
export interface GrafanaCredentials {
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
}

/**
 * The `Authorization` header value for an instance, or `null` when it carries no
 * usable credentials.
 *
 * Never returns `Bearer undefined` / `Bearer ` — the shape the old template literals
 * produced for a row with no key, which Grafana answers as an indistinguishable 401.
 * Callers that must have a header use {@link requireGrafanaAuthHeader}; callers
 * deciding whether an instance is usable at all test this for null.
 */
export function grafanaAuthHeader(creds: GrafanaCredentials): string | null {
  // An api_key is trimmed because it is pasted by hand and a trailing newline is
  // the single most common way to configure one wrong.
  // `creds?.` and not `creds.`: callers pass an entity they believe they hold, and
  // requireGrafanaAuthHeader's own '(unknown)' label only means something if a nullish
  // object reaches it as a configuration error rather than a TypeError.
  const apiKey = creds?.apiKey?.trim();
  if (apiKey) {
    return `Bearer ${apiKey}`;
  }

  const username = creds?.username?.trim();
  // The password is NOT trimmed: surrounding whitespace can be part of it, and
  // silently changing a credential is worse than a 401 the operator can read.
  const password = creds?.password;
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return null;
}

/**
 * Same, but throws when the instance has neither an API key nor a username/password
 * pair. The message names the instance so the failure reads as a configuration
 * error instead of arriving from Grafana as a 401.
 */
export function requireGrafanaAuthHeader(
  creds: GrafanaCredentials,
  label?: string | null,
): string {
  const header = grafanaAuthHeader(creds);
  if (!header) {
    throw new Error(
      `Grafana instance ${label ?? '(unknown)'} has no credentials configured — ` +
        'set an API key, or a username and password for basic auth',
    );
  }
  return header;
}
