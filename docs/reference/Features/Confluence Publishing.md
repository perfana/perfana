# Confluence Publishing

Publishes a generated report as a Confluence page (v0.2.97.95, migration 1835). User guide:
`docs-user/docs/integrations/connect-confluence.md`.

## Flow

`POST /api/confluence/reports/:reportId/publish { configId, title? }` runs synchronously:

1. **Authorize.** `ReportGenerationService.assertCanChangeSharing` (test-run:update on the run, the
   bar for sharing, because publishing copies the report out of Perfana). The connection must belong
   to the run's organization, or 400.
2. **Render charts** in perfana-report (`ConfluenceRenderProcessor`, queue
   `perfana-report-confluence-render`). Confluence storage format has no inline SVG and the API image
   is distroless with no fonts, so the SVGs are screenshotted (2x) in the Chrome that prints PDFs and
   replaced by `<img data-confluence-chart="N" width="W">`. SVGs under 120x60 are icons and are left
   for the converter to drop.
   **The result is not the job's return value**: BullMQ copies return values into its events stream,
   which keeps thousands of entries, and a rendered report is MBs. The job writes
   `confluence-render:<jobId>` with a 600 s TTL and returns the key; the API reads and deletes it.
   The API waits 180 s (`RENDER_WAIT_MS`) and answers 503 after that. The processor (concurrency 1)
   fails any job queued longer ago than the same 180 s (`API_RENDER_WAIT_MS`, a twin constant: keep
   the two equal) instead of rendering it, so a backlog of abandoned jobs never holds the slot a
   retry is waiting for.
3. **Convert** (`apps/api/src/modules/confluence/storage-format.ts`): one generic HTML-to-storage
   converter, not a Confluence variant per renderer. Headings, paragraphs, lists, tables (only
   `colspan`/`rowspan` kept), `http(s)` links, `<details>` → `expand` macro, `data-pill` spans
   (`pill()` in `report-style.ts`) → `status` lozenges, chart images → `<ac:image><ri:attachment>`.
   Scripts, styles, form controls, `opacity="0"` hover readouts, `display:none` and the print header
   are dropped; unknown elements are unwrapped. **Label/value tiles** (a block of 2-4 text-only
   children with a short first label: the run summary, stat cards, the Apdex scenario metrics) are
   gathered across sibling rows and HTML comments into one table: across (labels as a header row)
   when there are at most 8 with short values, down (one label/value row each) otherwise; a lone
   tile reads "**Label**: value"; inside a table cell the rule is off, so a Comparisons cell stays
   lines. The chart series tables (CSS grids with ARIA `role="table"/"row"/"cell"`) become real
   tables, the swatch a coloured ■, or "- -" for a dashed baseline. Lozenges come from `data-pill`
   (`pill()`, `deltaChip()`), `.badge-*`, or — for a report generated before `data-pill` existed,
   since report HTML is stored — a pill-shaped span in one of the five `PILL_FILLS` colours. The
   Comparisons "Show rows" filter (`.report-band-filter`) is dropped; expand titles join the
   summary's parts with " · ". Output is built by hand as XHTML (escaped, every tag closed).
4. **Upsert the page.** Cloud uses REST v2 (`/wiki/api/v2/pages`; Atlassian is retiring v1 content
   endpoints there), Data Center v1 (`/rest/api/content`). A report republished to the same
   connection updates `confluence_page_id` as version n+1, but only while that page still sits in
   the connection's configured space: a page id is unique only within one Confluence, so after the
   connection is pointed at another host or space the stored id could name an unrelated page.
   A page that 404s or is outside the space gets a new page instead.
5. **Record the page** (`confluence_config_id`, `confluence_page_id`, `confluence_page_url` on
   `generated_reports`) straight after the upsert, before any upload. If the upload then fails, a
   retry updates this page rather than creating a second one, which Confluence would refuse anyway
   because titles are unique per space.
6. **Upload charts** with v1 `PUT .../child/attachment` (create-or-replace by filename, so republish
   is idempotent), 10 files per request, `X-Atlassian-Token: no-check`.
7. Stamp `confluence_published_at` once the uploads succeed. A page recorded with no
   `confluence_published_at` (or an older one) is a publish whose upload failed.

## Connections

`confluence_configs` is org-owned (RLS, four standard policies), modelled on `splunk_configs`:
token encrypted by the entity transformer and masked as `[MASKED]` on read; changing the URL needs
the token re-entered; `integration:confluence:{create,update,delete}` capabilities; optional org
proxy; `redirect: 'error'` so the token only reaches the configured host. Auth: Cloud = Basic
`email:apiToken`, Data Center = Bearer personal access token (Confluence 7.9+). Server/DC older than
7.9 (no PATs, basic auth with a password) is not supported.

## Known limits

- **Synchronous.** Render + page + uploads in one request. A report with very many charts can trip a
  reverse proxy's read timeout; the upgrade is a queue with a status column.
- **Static copy.** No hover readouts or row filters; the page's info banner links to the test run.
- **Verified against mocks and real Chrome only**, not yet against a live Confluence Cloud or Data
  Center instance.
- `generated_reports` travels in the SUT export, so an imported report carries a
  `confluence_config_id` that does not exist in the target; the next publish just creates a page.
