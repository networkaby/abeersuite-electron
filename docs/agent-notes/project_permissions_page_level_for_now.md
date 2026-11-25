---
name: project_permissions_page_level_for_now
description: Non-voucher permissions are page-level until the dev version is complete; voucher writes are tick-gated at the API since 2026-09-29.
metadata:
  type: project
  modified: 2026-09-29T17:15:28.530Z
---

AbeerSuite gates permissions at the **page/nav level** for this phase. Many mutating `/api` handlers underneath sit on bare `requireAuth()`. Since 2026-09-29 every `/office` page is locked by its own sidebar tick in `proxy.ts` (`pageAccess.ts`, built from nav.ts; `pathPrefixes` on a nav item for pages beside its href); the old module-wide layout guards were removed. A page's lock is NOT an API lock — the data APIs behind it are still mostly bare `requireAuth()`. This is known and accepted; stronger API-level gating is planned for **after the dev version is complete** (owner's decision, 2026-09-05).

**Exception — vouchers (owner asked, 2026-09-29):** every voucher write now checks its Role-page tick at the API — create / post / Cancel·edit / delete, office and POS alike. One rule: `canActOnVoucher` in `posVoucherMatrix.ts` (menus) / `userCanActOnVoucher` (server); GL + Journal use `userCanVoucher`. A voucher route that skips its tick IS a bug to raise, not a deferred finding. Deliberately open: the register's Draft/Issued toggle, online orders (E-Commerce module), system vouchers (shift variance, gift-card issue), bill-wise linking (`userCanVoucherKind` pass-through so counters can link against POS bills).

**Why:** the owner is still building features and does not want per-route permission work churning while the surface is moving — but asked directly for vouchers after seeing R2 delete a POS Order with Delete unticked. The 2026-09-05 audit's whole B block (B1–B12) was deferred on the general basis and marked so in `docs/audit-2026-09-05.md`.

**How to apply:** outside vouchers, do not raise "this route only calls requireAuth()" as a finding, and do not add `requirePermission` to API routes unasked. Two things are NOT covered by the deferral and stay live: **credential leaks** (e.g. audit B4) and endpoints whose caller is the **public internet, not a staff session** (cron, webhooks). R3 will get office UI later — its edit rights then come from Role-page ticks, no code change. See also [project_release_means_full_checklist](project_release_means_full_checklist.md).
