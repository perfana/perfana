---
aliases:
  - "@perfana/config"
tags:
  - package
---

# Config Package

Minimal configuration package for shared TypeScript compilation settings.

> [!info] Location
> `packages/config/`

## Purpose

Provides shared `tsconfig.json` settings extended by all other packages and apps in the monorepo. Ensures consistent TypeScript compilation across the entire codebase.

## Usage

Other packages extend this config:

```json
{
  "extends": "@perfana/config/tsconfig.json",
  "compilerOptions": {
    // App-specific overrides
  }
}
```

## Scripts

| Command | Description |
|---|---|
| `build` | `tsc` |
| `dev` | `tsc --watch` |
| `lint` | ESLint |
| `type-check` | `tsc --noEmit` |
| `clean` | Remove build output |

## Related

- [[Shared Package]] — Main shared package
- [[Tech Stack]] — TypeScript configuration
