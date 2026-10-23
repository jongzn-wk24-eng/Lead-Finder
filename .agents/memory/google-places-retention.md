---
name: Google Places retention
description: User-selected rule for Google Places data persistence and exports
---

Google Places business details are fetched live. Only Place IDs and independent user-created or website-research records may be retained; do not persist Google-returned names, addresses, phone numbers, websites, ratings, or review counts.

**Why:** The user explicitly chose “Google 实时查询，只长期保存 Place ID” after the standard Google Places content-storage restriction was explained.

**How to apply:** Apply this to database writes, browser persistence, CSV downloads and any new integrations. Show live-lookup failures explicitly and disclose the extra Place Details calls. Preserve existing open-data records and their attribution.
