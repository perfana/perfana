# API reference

These are the Perfana endpoints your **load-test tool or CI pipeline** uses — to send
test runs, provision systems, upload results, and read outcomes for a build gate. For a
step-by-step walkthrough, start with [Send your first test run](test-runs/send-first-run.md);
this page is the reference for the individual calls.

The full, interactive schema for every endpoint is in **Swagger** at `/<your-host>/api/docs`.

## Authentication

Every endpoint here requires an **API key** sent as a Bearer token:

```
Authorization: Bearer <your-api-key>
```

- Create a key in the app (see [Create an API key](administration/api-keys.md)) or via
  `POST /api/api-keys`. The token is shown **once**, at creation.
- The key is scoped to an organization; keep it secret in your pipeline's secret store.

**Base URL** is your Perfana API host followed by `/api` — for a local install,
`http://localhost:3001/api`. Paths below are written relative to that (e.g. `POST /api/test`).

## Send a test run

### `POST /api/test` — create, update, complete, or abort a run

The main integration endpoint. Call it at the start of a test to create the run, again
with `completed: true` when the test finishes. `systemUnderTest` is a **name** — if no
system with that name exists yet, Perfana creates it.

| Field | Type | Required | Notes |
|---|---|---|---|
| `systemUnderTest` | string | yes | System name (alphanumeric + `._-`). Created if new. |
| `testEnvironment` | string | yes | e.g. `acceptance` |
| `workload` | string | yes | e.g. `checkout-load` |
| `testRunId` | string | yes | Your unique id for this run |
| `completed` | boolean | yes | `false` to start, `true` to finish |
| `version` | string | no | Version under test |
| `start` / `end` | string (ISO 8601) | no | Test window |
| `duration` | number (sec) | no | Alternative to `end` |
| `CIBuildResultsUrl` | string (URL) | no | Link back to your pipeline build |
| `annotations` | string | no | Free-text note (≤5000 chars) |
| `tags` | string[] | no | Labels for the run |
| `abort` / `abortMessage` | boolean / string | no | Abort the run with a reason |
| `adaptMode` | `DEFAULT` \| `BASELINE` | no | Per-run ADAPT mode |

Start a run:

```bash
curl -X POST http://localhost:3001/api/test \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "systemUnderTest": "checkout-service",
    "testEnvironment": "acceptance",
    "workload": "checkout-load",
    "testRunId": "checkout-load-2026-06-30-001",
    "completed": false,
    "start": "2026-06-30T09:00:00Z"
  }'
```

Complete it when the test ends:

```bash
curl -X POST http://localhost:3001/api/test \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "systemUnderTest": "checkout-service",
    "testEnvironment": "acceptance",
    "workload": "checkout-load",
    "testRunId": "checkout-load-2026-06-30-001",
    "completed": true,
    "end": "2026-06-30T09:30:00Z"
  }'
```

Responses: `200` on success; `409` if the run already exists in a conflicting state;
`400` on a validation error.

### `POST /api/init` — get a generated run id

If you'd rather Perfana generate the `testRunId` for you, call `POST /api/init` with
`systemUnderTest`, `testEnvironment`, and `workload`. It returns `{ "testRunId": "..." }`,
which you then pass to `POST /api/test`.

### `PATCH /api/test-runs/{id}/abort` — abort a running run

Aborts the run identified by its **UUID** (not the `testRunId` string). No body. This is
an alternative to sending `abort: true` on `POST /api/test`.

## Attach configuration (optional)

Record the configuration a run used, so Perfana can diff it against previous runs. All
take the run's identity fields (`systemUnderTest`, `testEnvironment`, `workload`,
`testRunId`).

| Endpoint | Purpose |
|---|---|
| `POST /api/config/key` | Add one `key` / `value` pair |
| `POST /api/config/keys` | Add many pairs (`configItems: [{key, value}]`) |
| `POST /api/config/json` | Add config from a JSON blob, filtered by `includes` / `excludes` regex |
| `GET /api/config/systems` | List systems with their environments and workloads |

## Provision a system under test

### `POST /api/systems-under-test` — create a system (idempotent)

Optional — a system is also created automatically by the first `POST /api/test`
(see [Create a system under test](configuration/create-system-under-test.md)). Use this
when you want to pre-create a system, optionally seeding its environments and workloads.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | System name |
| `organizationId` | string (UUID) | yes | Owning organization |
| `description` | string | no | |
| `teamId` | string (UUID) | no | |
| `environments` | array | no | Each `{ name, workloads: [{ name }] }` |

**Idempotent:** if a system with that name already exists in the organization, the call
returns **HTTP 409** with body `{ "message": "System under test already exists", "sut": {…} }`.
A pipeline can treat `409` as "already provisioned" and read the existing system from the
response, so it's safe to call on every build.

Reads: `GET /api/systems-under-test` (list) and `GET /api/systems-under-test/{id}` (one).

## Upload JMeter results

### `POST /api/test-runs/jtl-upload`

Upload JMeter `.jtl` results directly, as an alternative to streaming during the test.
`multipart/form-data`, max file 100 MB.

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | binary | yes | A **`.zip`** of JTL files (one folder per scenario → one run each) |
| `systemUnderTest` | string | yes | |
| `testEnvironment` | string | yes | |
| `workload` | string | yes | |
| `analysisStartOffset` | string (sec) | no | Default `0` |
| `configs` | string | no | JSON array `[{key, value}]` |
| `includeSubTransactions` | `"true"`/`"false"` | no | Default `false` |

Response: `{ testRunId, scenarioCount, message }`.

## Read results for a build gate

The run record carries a **consolidated verdict**, so your pipeline can gate on a single
field. `{testRunId}` is your run's id string.

| Endpoint | Returns |
|---|---|
| `GET /api/test-runs/{testRunId}` | The full run record, including `consolidatedResult`, `valid`, and status |
| `GET /api/test-runs/{testRunId}/check-results` | Per-SLO (check) results — the detail behind the verdict |
| `GET /api/test-runs/{testRunId}/anomaly-detection` | ADAPT anomaly results — the detail behind the verdict |

The `consolidatedResult` object on the run is the pass/fail verdict:

| Field | Meaning |
|---|---|
| `overall` | **The gate** — `true` when both the SLOs and ADAPT pass |
| `meetsRequirement` | All SLO requirements met |
| `adaptTestRunOK` | ADAPT analysis passed (no unaccepted regressions) |
| `requirementsOK` | All individual requirements passed |

The run also exposes `valid` (boolean) with `reasonsNotValid` (string[]) — whether the run
had enough data to be judged at all.

!!! tip "Gating pattern"
    Poll `GET /api/test-runs/{testRunId}` until the run has finished analysis (it leaves
    `INITIALIZING` and `consolidatedResult` is populated), then fail the build when
    `valid` is `true` **and** `consolidatedResult.overall` is `false`. Use `check-results`
    or `anomaly-detection` if you want to report *why* it failed.

## Manage API keys

| Endpoint | Purpose |
|---|---|
| `POST /api/api-keys` | Create a key — `description` (required), `ttl` like `30d`/`6M`/`1y` (required), `roles`, `organizationId`. Returns the `token` **once**. |
| `GET /api/api-keys` | List keys (no secrets) |
| `DELETE /api/api-keys/{id}` | Delete a key |
| `POST /api/api-keys/validate` | Check a token: body `{ token }` → `{ valid }` |

Creating and deleting keys requires an organization admin. See
[Create an API key](administration/api-keys.md) for the in-app flow.

## Related
- [Send your first test run](test-runs/send-first-run.md)
- [Create a system under test](configuration/create-system-under-test.md)
- [Create an API key](administration/api-keys.md)
