---
aliases:
  - "@perfana/config"
tags:
  - package
---

# Config Package

> [!warning] Retired — there is no `packages/config/`
> `@perfana/config` was removed in v0.2.61.12 (it had zero importers). `packages/`
> contains exactly one package, `packages/shared/`. This page is kept so existing
> links resolve; what it used to describe now lives in the two places below.

## Where the shared configuration actually lives

| What | Where |
|---|---|
| Shared TypeScript compiler settings | `tsconfig.base.json` at the repo root |
| TypeORM connection / DataSource factory | `@perfana/shared/config` (`packages/shared/src/config/typeorm.config.ts`) |

Every app and package extends the root base config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    // App-specific overrides
  }
}
```

`apps/web` and `apps/mcp` are the two exceptions — they carry standalone
`tsconfig.json` files and do not extend the base.

`tsconfig.base.json` is also where the `"@perfana/shared/*"` path alias is declared.
That alias resolves **any** subpath at the source tree, including one the shared
package does not export, which is why `npm run check:workspace-exports` exists — see
[[Shared Package]].

## Related

- [[Shared Package]] — the one package under `packages/`, and its import surface
- [[Tech Stack]] — TypeScript configuration
