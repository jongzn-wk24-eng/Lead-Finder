# Real-data mode

## What changed

- All existing seeded companies and their checks, activity and outreach are imported as demo records. No demo records are added at startup, including an empty database.
- **Settings → Demo mode** defaults **OFF**. Real mode excludes demo records from lists, details, activity, follow-ups, dashboard totals, rate comparisons and CSVs. Demo mode shows only demo records and a red **DEMO DATA** banner.
- **Load demo data** explicitly loads the fictional fixture without enabling Demo mode. Repeated loads do not duplicate it.
- **Delete all demo data** asks for confirmation and removes only demo companies and demo child/usage records. It does not delete real records or phase code.
- Contact statuses, reply records and outreach counts are self-reported, not proof of delivery. Rates with no positive observations show **Not enough data**, with numerator / denominator. Finding/channel comparisons are withheld until ten distinct companies have been marked contacted; follow-ups do not inflate their denominator.
- Company rows and details separate Google lookup metadata, independent automated checks, AI provenance and user actions. Demo AI/check outputs are labelled simulated, not real model runs.

## Persistence and migration

The previous SQLite file was local to the API process. A published app's filesystem is not durable storage, so it is not suitable for keeping leads across deployment replacement/restarts. Records now use Replit's built-in PostgreSQL, independent of the app process; screenshots continue to use private App Storage.

The development-only legacy import is atomic and repeatable. It imports existing records, preserves their IDs/relationships, labels seeded records demo and records an import marker in PostgreSQL. It never modifies the SQLite source. The original file remains an excluded-from-Git development backup.

The schema is maintained in Drizzle. Post-merge setup applies it to development before importing. Production uses its own database; the platform's normal Publish flow applies schema changes. The application performs no startup-time schema migrations and no production deployment was performed as part of this change. Development demo rows are not automatically copied into production.

Reference: https://docs.replit.com/features/data-and-storage/sql-database

## Run one real test yourself

No real Google or Gemini calls were made while implementing/verifying these changes. Automated tests replace those requests with local mocks.

1. Unlock the workspace. In **Settings**, check **Demo mode: OFF**.
2. Note the dashboard's **Google Places requests · this month** total and search/details breakdown.
3. Open **Leads → Find leads · one-call real test**. Use one keyword (for example `dental clinic`) and one area (for example `Bangsar`).
4. Click **Run one-call test (1 Places call)** and approve the paid request confirmation. This makes exactly one Text Search attempt, without pagination, Place Details, website checks or Gemini.
5. Inspect the temporary results: Place ID, name, address, phone, website, Maps URL, rating, review count and attribution. Missing optional fields say **Not provided**. These Google fields are live response data only and disappear when you leave; only Place IDs, timestamps and your search context are saved.
6. Verify each Place ID appears once and results say **New Place ID** or **Already saved (deduped)**. Existing IDs are updated, not inserted twice. A deliberate repeat test costs another call; existing matches should be reported as already saved.
7. Return to Overview. The total and search counters should be **+1** for the first test; details should be unchanged. Failed requests are also counted when attempted.

Opening saved records does not automatically fetch Google business fields. On a company page, **Load live Google data (1 Place Details call)** explicitly fetches them. Refreshing/revisiting after enabling live data, refreshing Google records, drafting with a Google business or running the full research flow can use additional requests. Those are not included in the one-call test.

## Privacy/terms scope

The requested privacy/terms task was replaced, and no such pages were added. This remains a private, password-protected single-user tool. That is a scope choice, not a statement that Google's contractual requirements or applicable laws cease to apply.

## Dashboard presentation

The interface uses the requested Urbanist / lime / dark-green fintech style. Period tabs filter New, non-blocked companies by their stored fetched date within the current calendar week (Monday–Sunday) or calendar month in Malaysia time. This does not change lead eligibility or underlying business rules.

The bell counts follow-ups due today; the dashboard list additionally includes overdue follow-ups. The check control opens the existing company workflow for review and manual logging; it does not silently mark a message sent. Skip is disabled because there is no supported skip action. AI usage is an actual count, not a progress percentage against an invented quota. The 1,000-search display is a visual budget reference, not a newly enforced spending limit.
