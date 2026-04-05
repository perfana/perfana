# Perfana Web — Coding Rules

Perfana-specific development standards for `apps/web`. For general project context, see [CLAUDE.md](../../CLAUDE.md).

## Project Structure

```
apps/web/
  app/                     # Next.js App Router pages
    test-runs/             # Test run list + detail pages
    integrations/          # Grafana, Dynatrace, Tracing config
    settings/              # API keys, notifications, profiles
    systems/               # Systems under test management
    reports/               # Report templates + generated reports
    signin/ signup/        # Auth pages (Keycloak-backed)
    api/                   # Next.js API routes (proxy)
    layout.tsx             # Root layout with providers
    providers.tsx          # MUI theme, Keycloak, Socket.IO
  components/
    ui/                    # Reusable UI primitives (buttons, dialogs, tables)
    dashboard/             # Grafana dashboard display components
    layout/                # App shell, sidebar, header
    organizations/         # Org picker, membership UI
    teams/                 # Team management UI
  lib/
    api.ts                 # authenticatedFetch() + getAuthHeaders()
    keycloak-auth.ts       # Keycloak JS adapter wrapper
    env.ts                 # Runtime environment config
    hooks/                 # Custom React hooks
    constants/             # Shared constants
    *.ts                   # Domain-specific API client modules
```

## Authentication — API Calls

Every API call from the frontend **must** include authentication headers. Use `authenticatedFetch()` from `lib/api.ts` — it handles token injection, 401 refresh, and base URL prepending automatically.

```typescript
// PREFERRED: authenticatedFetch (handles everything)
import { authenticatedFetch } from '@/lib/api';

const response = await authenticatedFetch('/test-runs', { method: 'GET' });

// FALLBACK: manual headers (only when authenticatedFetch doesn't fit)
import { getAuthHeaders } from '@/lib/api';

const response = await fetch(`${env.API_URL}/endpoint`, {
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
});
```

**Never** read tokens from `sessionStorage` or `localStorage` directly — always go through `lib/api.ts`.

## Styling Stack

Perfana uses **MUI (Material UI)** as the primary component library, supplemented with **Radix UI** primitives and **Tailwind CSS** utilities.

- Use MUI components (`Button`, `TextField`, `Dialog`, `DataGrid`, etc.) for standard UI
- Use Radix primitives (`Select`, `Popover`, `Tooltip`) when MUI lacks the component
- Use Tailwind utilities for layout spacing and quick overrides
- Theme is configured in `providers.tsx` — use `theme.palette` tokens, not hardcoded colors

## Component Patterns

- **Server Components** are the default. Add `'use client'` only when the component needs interactivity, browser APIs, or React hooks.
- **Data fetching** happens client-side via `authenticatedFetch()` (the API requires auth headers from the browser session).
- **Page components** live in `app/<route>/page.tsx`. Feature-specific components live in `app/<route>/components/`.
- **Shared components** live in `components/`. Domain-specific API functions live in `lib/<domain>.ts`.

## Environment Variables

Frontend env vars are defined in `lib/env.ts`:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (default: `http://localhost:3001/api`) |
| `NEXT_PUBLIC_KEYCLOAK_URL` | Keycloak server URL |
| `NEXT_PUBLIC_KEYCLOAK_REALM` | Keycloak realm (default: `perfana-prod`) |
| `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` | Keycloak client ID |
| `NEXT_PUBLIC_USE_KEYCLOAK_AUTH` | Enable/disable Keycloak (default: `true`) |

## Testing

- Framework: **Jest** with React Testing Library
- Config: `apps/web/jest.config.js`
- Run: `cd apps/web && npx jest`
- Tests live alongside components with `.spec.ts` or `.test.ts` suffix

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing auth headers in fetch | Use `authenticatedFetch()` from `@/lib/api` |
| Hardcoded `localhost:3001` | Use `env.API_URL` from `@/lib/env` |
| `'use client'` on a page that doesn't need it | Only add when using hooks, event handlers, or browser APIs |
| Importing MUI wrong | Use `@mui/material/ComponentName` path imports for tree-shaking |
