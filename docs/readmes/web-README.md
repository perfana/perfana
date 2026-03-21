# @perfana/web

Next.js 15 frontend for Perfana -- performance analysis and monitoring platform.

## Quick start

```bash
pnpm dev        # http://localhost:4001
pnpm build      # production build (standalone output)
pnpm type-check # run tsc --noEmit
pnpm test       # vitest
```

## Project structure

```
app/
  layout.tsx              # Root layout (Inter font, MUI ThemeProvider)
  globals.css             # Tailwind directives + CSS variable color system
  api/config/route.ts     # Runtime config endpoint for containerized deploys
  test-runs/              # /test-runs list & /test-runs/[id] detail
  systems/                # /systems/[id] system configuration
  settings/               # /settings user & profile management
  integrations/           # /integrations Grafana, Dynatrace, etc.
  signin/                 # /signin authentication page

components/
  providers/              # MUI ThemeProvider, future context providers
  layout/                 # App shell, sidebar, navigation
  ui/                     # Shared presentational components
  dashboard/              # Dashboard-specific components

lib/
  api.ts                  # authenticatedFetch + api.get/post/put/delete helpers
  keycloak-auth.ts        # Keycloak PKCE singleton (login, logout, token refresh)
  socket.ts               # Socket.IO manager (subscriptions, auto-reconnect)
```

## Architecture decisions

| Area | Choice |
|------|--------|
| Components | MUI v7 for interactive widgets |
| Layout / spacing | Tailwind CSS utility classes |
| Charts | ECharts (not Plotly) |
| Auth | Keycloak with PKCE flow |
| Real-time | Socket.IO over WebSocket |
| State | React context + hooks (no Redux) |

## Data fetching

- **Server components** fetch data directly when possible.
- **Client components** use `authenticatedFetch()` from `lib/api.ts` which auto-attaches the JWT and retries once on 401.
- Convenience wrappers `api.get()`, `api.post()`, `api.put()`, `api.delete()` handle JSON serialization.

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:3001/api` |
| `NEXT_PUBLIC_KEYCLOAK_URL` | Keycloak server URL | `http://localhost:8080` |
| `NEXT_PUBLIC_KEYCLOAK_REALM` | Keycloak realm | `perfana` |
| `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` | Keycloak client ID | `perfana-web` |

For containerized deploys, set `RUNTIME_*` equivalents (e.g. `RUNTIME_API_URL`) which are read at request time via `/api/config`.

## Dark mode

Dark mode is driven by the `dark` class on `<html>`. The MUI theme and Tailwind CSS variables both respond to it. User preference is persisted in `localStorage` under `perfana-theme`.
