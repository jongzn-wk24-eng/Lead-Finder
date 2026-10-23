# KL Lead Finder

A private, single-user lead research and manual outreach tracker for a freelance web designer working with Kuala Lumpur businesses.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Lead Finder data is stored in a local SQLite file through one database module so the storage layer can be replaced later.
- The password gate uses `APP_PASSWORD` and `SESSION_SECRET`; protected routes fail closed when either is missing.
- Phase 1 uses clearly identified synthetic sample businesses and does not call third-party APIs.
- No app flow sends email or WhatsApp. Message actions only draft, copy, open a prefilled link, and record a send the user confirms manually.

## Product

KL Lead Finder helps one freelance web designer identify promising local businesses, record verified website findings, prepare outreach drafts, and track manually handled follow-ups. The first phase includes a dashboard, sample leads, activity history, settings, and template-based drafts.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do not add any automatic email or WhatsApp sending.
- Never expose leads unless both `APP_PASSWORD` and `SESSION_SECRET` are configured.
- Do not present seeded sample businesses or their outreach history as real research or real messages.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
