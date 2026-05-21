# Completed and protected surfaces

## Completed list

- [x] Day Book V1 (`/office/accountancy/reports/day-book`) (2026-05-18 13:13:20 IST). 2026-05-21 update — GL engine output is filtered server-side (every primary voucher now appears exactly once; engine-output JEs hidden). Accounting math (`effectiveLedgerBalance`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss`) unchanged.
- [x] Admin module V1 (`/office/admin/*` — users, roles/matrix, branches, departments, posts, org-chart, counters) (2026-05-19; 2026-05-20 — settings pages carved out, see next entry)
- [x] Admin module V1.5 — in-section nav (`office/admin/layout.tsx`, `AdminNav`, `admin/loading.tsx`) (2026-05-20). Grouped tab bar + permission filtering; preserve-first.
- [x] Settings module V1 (`/office/settings/*` — pipelines, statuses, sub-statuses, org-defaults, year-ending, naming-convention, printer-settings) extracted from Admin module on 2026-05-20. Same maturity as the V1 Admin pages it replaced — preserve-first.
- [x] Settings module V1.5 — in-section nav (`office/settings/layout.tsx`, `SettingsNav`) (2026-05-20). Parent layout wraps all settings pages (including naming-convention and printer-settings, which still lack per-page `layout.tsx`). Preserve-first.
