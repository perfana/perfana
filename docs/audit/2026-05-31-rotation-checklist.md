# Credential Rotation Checklist — pre-publication

**Mandatory before flipping the repo public**, regardless of the CLEAN scan result
(`2026-05-31-manual-sweep.md`). A private→public transition means every secret
that ever touched the repo or its tooling must be treated as compromised.

Record values **out-of-band** — do NOT commit any secret value to this file.
Mark each item done with date + initials.

| # | Credential | Where | Rotated? (date / by) |
|---|-----------|-------|----------------------|
| 1 | Keycloak client secret (`KEYCLOAK_CLIENT_SECRET`) | Keycloak prod admin console → Perfana client → Credentials → regenerate; update prod secret store | |
| 2 | Database password(s) (`DB_PASSWORD`) | Prod Postgres + deployment config / secret store | |
| 3 | Dynatrace API token (`dt0c01.RKQYIWNCWT7TETKTU5F5RSUQ…`) | Dynatrace → Access tokens → revoke + reissue. Public-id appears truncated in historical `CODE_AUDIT_REPORT.md` | |
| 4 | Perfana MCP API keys | Revoke via `/api-keys`; reissue; distribute out-of-band | |
| 5 | Supabase keys (if the gstack/legacy `SUPABASE_SERVICE_ROLE_KEY` was ever real for a Perfana project) | Supabase project settings → API → rotate service-role; confirm anon key is publishable-only | |

## Notes

- The gstack `GSTACK_SUPABASE_ANON_KEY` (`sb_publishable_…`) is a **publishable**
  anon key for third-party gstack telemetry infra, documented as safe-to-commit;
  not a Perfana credential. No action required unless Perfana owns that project.
- `.env*` files were never committed (gitignored from early history), so no
  working `.env` secret was exposed via git — this rotation is defense-in-depth
  for the truncated references found in historical audit/migration docs and for
  general hygiene.
