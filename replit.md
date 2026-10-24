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

- Lead Finder records use Replit PostgreSQL behind the lead database module. SQLite is legacy import input only, retained read-only as a development backup; never use a deployment filesystem for persistent records.
- Real mode is the default. Demo mode reads only demo records; real mode excludes them at the database query boundary, including nested counts and CSVs. Demo fixtures are loaded only on explicit user action.
- The three research/outreach phases must be retained. Change data handling without deleting phase implementations.
- The password gate uses `APP_PASSWORD` and `SESSION_SECRET`; protected routes fail closed when either is missing.
- Discovery uses OpenStreetMap/Overpass only. Google Places is disabled, including legacy endpoints and its low-level adapter. Plain Google search/Maps links are user-opened external links, not API calls.
- OSM queries are explicit, serial, at least 5 seconds apart, and cached for 24 hours. Configure an OSM contact in Settings. Missing OSM websites are unverified, not proof of no website.
- Demo mode makes no external research or AI calls.
- Retain PostgreSQL and all existing records; the user explicitly chose not to migrate to SQLite for the OSM version.
- No app flow sends email or WhatsApp. Message actions only draft, copy, open a prefilled link, and record a send the user confirms manually.

## Product

KL Lead Finder helps one freelance web designer identify promising local businesses, record verified website findings, prepare outreach drafts, and track manually handled follow-ups. The first phase includes a dashboard, sample leads, activity history, settings, and template-based drafts.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Do not add any automatic email or WhatsApp sending.
- Never expose leads unless both `APP_PASSWORD` and `SESSION_SECRET` are configured.
- Do not present seeded sample businesses or their outreach history as real research or real messages.
- This is a private single-user tool behind APP_PASSWORD; the user cancelled privacy/terms page work.
- Search and Place Details are separately counted. The one-call test is one Text Search without pagination, live enrichment, checks or AI. Google business fields remain live-only; retain Place IDs and independent research/user records.
- Schema lives in `lib/db/src/schema/leads.ts`. Post-merge setup applies it to development and imports legacy SQLite once. Production schema changes belong to the platform Publish flow, never startup-time DDL.
- `pnpm --filter @workspace/api-server test:phase3` exercises all three phases and demo isolation in a temporary PostgreSQL schema, with all external APIs mocked.
- UI direction requested by the user: Urbanist, light gray background, white rounded cards, lime `#B6F06E`, dark green `#0F3D1E`, pill top navigation and responsive fintech dashboard. Visual changes must not alter business logic.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
