# Open Source Release Checklist — Perfana Next-Gen

> Branch: `open-source-prep`  
> Doel: repo klaar maken voor publieke release op GitHub

---

## 🚨 Prioriteit 1 — Blokkerende issues (EERST oplossen)

### 1.1 Mogelijke credentials in SQL-dumps

De volgende bestanden bevatten `\restrict`-tokens die mogelijk Supabase/PostgreSQL credentials zijn:

- `perfana_schema_20251010.sql` — bevat een lange token-string
- `schema_dump_20251010_200612.sql` — idem
- `schema_dump_20251010_201048.sql` — idem

**Actie:**
- [ ] Controleer of de `\restrict`-waarden echte credentials zijn
- [ ] Zo ja: invalideer ze direct bij de provider
- [ ] Verwijder **alle** SQL-dump bestanden uit de repo root (dit zijn dev-artifacts, geen broncode)
- [ ] Voeg `*.sql` toe aan `.gitignore` of behoud alleen de migraties in `packages/shared/src/database/migrations/`
- [ ] Voer `git filter-branch` of `git-filter-repo` uit om de SQL-dumps uit de git-history te verwijderen als ze echte credentials bevatten

### 1.2 `.auto-claude/` directory is gecommit

De `.auto-claude/` map staat wél in `.gitignore` maar is al gecommit (git trackt het nog). Dit bevat interne AI-tooling data.

**Actie:**
- [ ] Run: `git rm -r --cached .auto-claude/`
- [ ] Commit de verwijdering
- [ ] Controleer of de inhoud geen gevoelige info bevat

### 1.3 README is verouderd en incorrect

De README zegt nog "Supabase" als database en auth-provider, maar de code gebruikt inmiddels PostgreSQL + Keycloak.

**Actie:**
- [ ] Herschrijf de README volledig (zie sectie 3.1)

---

## 📋 Prioriteit 2 — Vereiste open source standaarden

### 2.1 LICENSE bestand ontbreekt

Er is **geen** `LICENSE` bestand. Zonder licentie zijn alle rechten voorbehouden — de repo is juridisch niet open source.

**Actie:**
- [ ] Kies een licentie:
  - **Apache 2.0** — aanbevolen voor enterprise-vriendelijke open source (permissief, met patent-clausule)
  - **MIT** — maximaal permissief, meest populair
  - **AGPL-3.0** — als je wil dat SaaS-gebruikers ook de source moeten delen (sterk copyleft)
  - **BSL (Business Source License)** — als je een commercial-friendly model wil (populair bij databases/tools)
- [ ] Maak `LICENSE` aan in de repo root
- [ ] Voeg licentie-header toe aan bronbestanden (optioneel maar professioneel)

### 2.2 CONTRIBUTING.md ontbreekt

**Actie:**
- [ ] Maak `CONTRIBUTING.md` aan met:
  - Hoe de dev-omgeving op te zetten
  - Branch-strategie (feature branches → PR → main)
  - PR-vereisten (tests, linting, beschrijving)
  - Commit-conventies (conventional commits aanbevolen)
  - Review-proces

### 2.3 CODE_OF_CONDUCT.md ontbreekt

**Actie:**
- [ ] Voeg een `CODE_OF_CONDUCT.md` toe (gebruik de standaard [Contributor Covenant](https://www.contributor-covenant.org/))

### 2.4 SECURITY.md ontbreekt

**Actie:**
- [ ] Maak `SECURITY.md` aan met:
  - Hoe kwetsbaarheden te melden (bijv. via GitHub private vulnerability reporting)
  - Welke versies ondersteund worden
  - Response-tijden en disclosure-beleid

### 2.5 CHANGELOG.md ontbreekt

**Actie:**
- [ ] Maak een `CHANGELOG.md` aan (kan beginnen met de huidige staat als v0.1.0 of vergelijkbaar)
- [ ] Overweeg [Keep a Changelog](https://keepachangelog.com/) formaat

---

## 🧹 Prioriteit 3 — Repo opruimen

### 3.1 README herschrijven

De huidige README beschrijft de oude Supabase-stack. Nieuwe README moet bevatten:
- [ ] Correcte beschrijving van wat Perfana is en doet
- [ ] Actuele architecture (NestJS API + Next.js frontend + Worker + Grafana Sync + PostgreSQL + Keycloak)
- [ ] Correcte prerequisites (Docker, Node.js 18+, Keycloak, Redis)
- [ ] Werkende "Getting Started" instructies
- [ ] Links naar docs, demo, community
- [ ] Badges (build status, license, version)
- [ ] Screenshot / demo GIF

### 3.2 Interne planningsdocumenten verwijderen of archiveren

Er staan ~100 interne markdown-bestanden in de repo root die ontwikkelingsnotities, sessieverslagen en plannen zijn. Deze horen niet in een publieke repo.

**Categorieën om te verwijderen:**
- [ ] Alle `*_SUMMARY.md`, `*_PLAN.md`, `*_ANALYSIS.md`, `SESSION_SUMMARY.md` bestanden
- [ ] Alle `TEST_COVERAGE_PHASE_*.md`, `TEST_FIX_*.md`, `REMAINING_TEST_FAILURES.md` bestanden
- [ ] `CLAUDE.md` en `CLAUDE-NEW-STACK.md` (interne AI-instructies) — overweeg te houden als `CONTRIBUTING_AI.md` of te verwijderen
- [ ] `BUGFIX_*.md`, `CI_FIX_*.md`, `GITHUB_ACTIONS_FIX.md` interne debug-notities

**Bewaren (als publiek nuttig):**
- [ ] `README.md` (herschrijven)
- [ ] `DOCKER_BUILD.md` → verplaats naar `docs/docker.md`
- [ ] `DOCKER-SECURITY.md` → verplaats naar `docs/security.md`
- [ ] `KEYCLOAK_MIGRATION_PLAN.md` → verplaats naar `docs/keycloak.md` (als relevant voor gebruikers)

### 3.3 Dev-scripts in de root opruimen

De volgende scripts in de root zijn dev/test-artifacts:
- [ ] `create-completing-test.js`
- [ ] `create-demo-test.js`
- [ ] `create-live-test.js`
- [ ] `simulate-test-run.js`
- [ ] `test-upsert-functionality.js`
- [ ] `working-simulation.js`

**Actie:** Verplaats naar `scripts/dev/` of verwijder als ze niet nuttig zijn voor externe contributors.

### 3.4 Root SQL-dumps verwijderen

- [ ] Verwijder alle `*.sql` bestanden uit de root (schema dumps zijn geen broncode)
- [ ] Behoud alleen de migration-bestanden in `packages/shared/src/database/migrations/`

### 3.5 `.gitignore` updaten

- [ ] Zorg dat `*.sql` in de root wordt genegeerd
- [ ] Zorg dat `dev_output.log` wordt genegeerd (staat nu in de repo)

---

## 🔧 Prioriteit 4 — Technische gereedheid

### 4.1 GitHub Actions workflows updaten

De bestaande workflows (`.github/workflows/`) gebruiken vermoedelijk interne configuratie.

- [ ] Controleer `.github/workflows/*.yml` op hardcoded secrets of interne URLs
- [ ] Voeg GitHub Actions toe voor:
  - [ ] CI (lint + tests) op elke PR
  - [ ] Security scanning (bijv. CodeQL of Trivy)
  - [ ] Dependency updates (Dependabot configureren)
- [ ] Maak `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] Maak `.github/ISSUE_TEMPLATE/` met bug report + feature request templates

### 4.2 Environment variables documenteren

- [ ] Controleer alle `.env.example` bestanden op volledigheid
- [ ] Maak een root-level `.env.example` die alle services dekt (of verwijs naar per-app examples)
- [ ] Documenteer alle variabelen met beschrijving en of ze verplicht zijn

### 4.3 Docker setup voor lokale ontwikkeling

- [ ] Zorg voor een werkende `docker-compose.yml` (of `docker-compose.dev.yml`) die de hele stack lokaal opstart
- [ ] Inclusief: PostgreSQL, Redis, Keycloak (voor auth), Grafana (demo)
- [ ] Test of `docker compose up` daadwerkelijk werkt voor een nieuwe developer

### 4.4 Onvolledige implementaties markeren

Op basis van de agentlens analyse zijn er meerdere modules met openstaande TODOs die publiek zichtbaar worden:

- [ ] `grafana-db.service.ts` — directe DB-verbinding met Grafana nog niet geïmplementeerd → documenteer dit als "planned feature" of markeer als `experimental`
- [ ] `DynatraceConfig/DynatraceQuery` — `organization_id` ontbreekt nog → documenteer als bekende limitering
- [ ] E2E tests (`test-runs.e2e-spec.ts`) die herschreven moeten worden → voeg GitHub issue voor toe of markeer als `skip` met uitleg

### 4.5 Afhankelijkheden auditen

- [ ] Run `npm audit` en los kritieke kwetsbaarheden op
- [ ] Check voor package-lock.json inconsistenties (`.gitignore` wil het negeren maar het staat er wel)

### 4.6 SonarQube configuratie

`sonar-project.properties` bevat placeholder URLs:
- [ ] Vervang `your-org` door `perfana` in alle links
- [ ] Overweeg of SonarCloud publiek geconfigureerd moet worden

---

## 📚 Prioriteit 5 — Documentatie

### 5.1 Developer docs verbeteren

- [ ] `CLAUDE.md` / `CODING_RULES.md` zijn goed — overweeg te consolideren in `CONTRIBUTING.md`
- [ ] Maak een `docs/` directory met:
  - `docs/architecture.md` — hoe de services met elkaar praten
  - `docs/development.md` — volledige lokale setup guide
  - `docs/deployment.md` — hoe te deployen (Docker, Kubernetes via Helm)
  - `docs/api.md` — link naar Swagger/OpenAPI docs
  - `docs/keycloak.md` — Keycloak configuratie

### 5.2 Helm charts

- [ ] Controleer of de Helm charts in `perfana/helm-charts` ook updated moeten worden voor next-gen
- [ ] Documenteer de Helm-installatie voor productie

---

## 🏁 Release checklist (laatste stap)

Voordat de repo public wordt:

- [ ] Alle bovenstaande items afgerond
- [ ] Geen gevoelige data in git-history (gebruik `git log` + `git secrets` of `trufflehog`)
- [ ] GitHub repository settings:
  - [ ] Description en topics instellen
  - [ ] Website URL instellen
  - [ ] Issues inschakelen
  - [ ] GitHub Discussions inschakelen (optioneel, voor community)
  - [ ] Security advisories inschakelen
  - [ ] Branch protection op `main`
- [ ] Eerste release tag aanmaken (bijv. `v0.1.0-alpha`)
- [ ] Aankondiging voorbereiden (blog post / socials / Discord)

---

## 📊 Samenvatting prioriteiten

| Prioriteit | Omschrijving | Blockerend? |
|---|---|---|
| 🚨 1 | SQL-dump credentials + .auto-claude cleanup + README | ✅ Ja |
| 📋 2 | LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY | ✅ Ja |
| 🧹 3 | Interne docs opruimen, scripts, dumps | Aanbevolen |
| 🔧 4 | CI/CD, Docker, env vars, TODO's | Aanbevolen |
| 📚 5 | Documentatie verbeteren | Nice-to-have |

---

*Aangemaakt op branch `open-source-prep` — werk items af en merge naar `main` voor de publieke release.*
