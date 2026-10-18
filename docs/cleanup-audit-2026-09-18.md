# Clean-up audit — dead links, dead code, unsurfaced pages & routes

Repo: `D:\AbeerSuite\abeersuite-electron` · branch `main` @ `3eabfcf6` · audited 18 Sep 2026
Scope swept: 263 pages, 413 API routes, 1,757 source files (src, electron, scripts, sync-engine, e2e, prisma).
**Nothing was edited.** Every row below has a "verify by" step you can run or click yourself.

Verification commands are Git Bash, run from the repo root.

---

## 0. Read this first — the tree is stuck mid counter-build

80 route files are renamed aside to `*.counter-build-excluded` and show as deleted. A counter build was
killed part-way and never restored itself.

**Verify:**
```bash
git status --porcelain | grep -c 'counter-build-excluded'
```
Expect `80`. The matching `git status --porcelain | grep -c '^ D'` is also `80`.

The restore is a pure rename — `scripts/counter-build.ts:121` (`restoreOrphans`) does it automatically on the
next `pnpm build`. Until it is restored the shop / portal / legal half of the app is missing from disk, so
**no clean-up should be applied on this tree**. I left it alone (your rule: stage only my own files).

---

## A. Dead links — a user clicks and gets a 404

### A1 · Home screen, Accounts briefing card — 4 dead links

`modules/home/DeptBriefings (removed 2026-10-05)` lines **189, 190, 191, 192**

| Label on screen | Link today | Page that actually exists |
|---|---|---|
| Day Book | `/office/accountancy/daybook` | `/office/accountancy/reports/day-book` |
| Receivables | `/office/accountancy/receivables` | `/office/accountancy/reports/receivables` |
| Cash & Bank Book | `/office/accountancy/cash-bank` | `/office/accountancy/reports/cash-book` (and `/bank-book`) |
| GST Hub | `/office/accountancy/gst` | `/office/accountancy/reports/gst` |

**Verify the links:**
```bash
sed -n '189,192p' modules/home/DeptBriefings (removed 2026-10-05)
```
**Verify no such page exists:**
```bash
ls "src/app/(protected)/office/accountancy/" | grep -E 'daybook|receivables|cash-bank|^gst$'
```
Expect no output. Then confirm the real ones are one level deeper:
```bash
ls "src/app/(protected)/office/accountancy/reports/"
```

**Verify it is on a live screen** (not dead code): `FinanceBriefing` is exported at
`modules/home/DeptBriefings (removed 2026-10-05):181` and imported by the Home page at
`src/app/(protected)/office/page.tsx:32`.

**Click path:** sign in as a user with `finance:*` permission → Home (`/office`) → the Accounts card →
click "Day Book".

---

### A2 · Vouchers Register sidebar, "Stock movement" group — 3 dead links

`src/app/(protected)/office/accountancy/vouchers-registers/_components/vouchers-register-nav.ts`
lines **69, 70, 71** — Goods Receipts, Issues, Adjustments.

**Verify the nav entries:**
```bash
sed -n '69,71p' "src/app/(protected)/office/accountancy/vouchers-registers/_components/vouchers-register-nav.ts"
```
**Verify no folder exists for them:**
```bash
ls "src/app/(protected)/office/accountancy/vouchers-registers/"
```
Expect: no `goods-receipts`, no `issues`, no `adjustments`.

**Verify the voucher types themselves do not exist** (so these were never built, not just moved):
```bash
grep -rn "GOODS_RECEIPT\|\"ISSUE\"\|ADJUSTMENT" prisma/schema.prisma src/shared/lib/auth/voucherMatrix.ts
```
Expect no output.

**Click path:** Office → Accountancy → Vouchers Register → left nav, "Stock movement" group → click "Issues".

---

### A3 · Settings breadcrumb — dead on every settings page

`src/app/(protected)/office/settings/layout.tsx:33` — the breadcrumb root is `/office/settings`,
but that folder has **no `page.tsx`**.

**Verify:**
```bash
sed -n '33p' "src/app/(protected)/office/settings/layout.tsx"
ls "src/app/(protected)/office/settings/page.tsx"
```
Expect the second command to say *No such file or directory*.

**Click path:** Office → Settings → any sub-page (say Thermal Printer) → click the word "Settings" in the
breadcrumb at the top.

**Bonus, same file:** `SETTINGS_CRUMB_LABELS` (lines 9, 11, 12) still carries labels for `statuses`,
`workers`, `works`, `pipelines` — those folders moved under `workflow/` and are not direct children of
settings any more. Harmless, but stale. Compare:
```bash
ls "src/app/(protected)/office/settings/" "src/app/(protected)/office/settings/workflow/"
```

---

### A4 · Deal detail dialog — 2 dead links

`src/modules/deals/components/DealDetailDialog.tsx` lines **166** and **170**.

| Link today | Reality |
|---|---|
| `/office/customers/person/{id}` | `customers/person/` holds only a **list** `page.tsx`, no `[id]` |
| `/office/customers/companies/{id}` | `customers/companies/` holds only a **list** `page.tsx`, no `[id]` |

**Verify the links:**
```bash
sed -n '166p;170p' src/modules/deals/components/DealDetailDialog.tsx
```
**Verify there is no detail page under either:**
```bash
ls "src/app/(protected)/office/customers/person/" "src/app/(protected)/office/customers/companies/"
```
Expect only `page.tsx` in each.

**The right target:** party profiles open through the explorer —
`src/app/(protected)/office/customers/[id]/page.tsx` redirects to
`/office/customers/all?personId=…` / `?companyId=…`. Read that file (31 lines), it explains the pattern.
Note `[id]` there is an **account** id, while the dialog is holding a **person/company** id, so a plain
swap to `/office/customers/{id}` would open the wrong party.

**Click path:** Office → CRM → Deals → open any deal that has a person or company attached → click the
party name chip.

---

### A5 · Lab back-office page — 3 dead links (parked area, low priority)

> **Settled 2026-09-27:** `/lab` deleted.

`src/app/(protected)/lab/back/page.tsx` (deleted 2026-09-27) links to `/office/message`, `/office/admin`, `/office/roadmap`.
None has a `page.tsx` (`/office/roadmap` does not exist at all).

**Verify:**
```bash
ls "src/app/(protected)/office/message/" "src/app/(protected)/office/admin/"
ls "src/app/(protected)/office/roadmap" 2>&1 | head -1
```
Expect: no `page.tsx` in the first two, "No such file or directory" for the third.

`/lab` is your under-construction area, so this may be deliberate — your call.

---

### A6 · Main sidebar is CLEAN — no action

All **128** hrefs in `src/shared/lib/constants/nav.ts` resolve to a real page. Also clean: `masters-nav.ts` (both),
`WorkflowTabsNav.tsx`, `AdminTabsNav.tsx`. I mention it so you know the audit actually reached them.

---

## B. Legacy redirects that land on a 404

`next.config.ts`, the `redirects()` block.

| Line | Rule | Problem | Correct target |
|---|---|---|---|
| 99 | `/office/service-centers` → `/office/repairing/service-centers` | destination has no page | — page was removed; drop the rule (done 2026-10-18) |
| 106, 107 | `…/settings/pipelines` → `/office/settings/pipelines` | destination has no page | `/office/settings/workflow/pipelines` |
| 108, 109 | `…/settings/statuses` → `/office/settings/statuses` | destination has no page | `/office/settings/workflow/statuses` |
| 110, 111 | `…/settings/sub-statuses` → `/office/settings/sub-statuses` | destination has no page | `/office/settings/workflow/workers` (sub-status was renamed to worker) |

So an old bookmark takes **two** hops and still dies.

**Verify the rules:**
```bash
sed -n '99p;106,111p' next.config.ts
```
**Verify the destinations are missing and where they really live:**
```bash
for p in repairing/service-centers settings/pipelines settings/statuses settings/sub-statuses \
         settings/workflow/pipelines settings/workflow/statuses settings/workflow/workers; do
  d="src/app/(protected)/office/$p"
  [ -f "$d/page.tsx" ] && echo "OK    $p" || echo "MISS  $p"
done
```
Expect the first four `MISS`, the last three `OK`.

**Verify the rename claim** (sub-status → worker):
```bash
git log --oneline --all | grep -i "TicketSubStatus"
```

---

## C. Pages that exist but nothing points at them

| Page | Size | What it is | Suggested |
|---|---|---|---|
| `/office/inventory/configuration` | 9 lines | Scaffold — renders the literal text `ConfigurationPage` | delete |
| `/office/accountancy/dashboard` | 8 lines | "Dashboard coming soon." stub | delete |
| `/office/accountancy/orders-estimates` | real page | Working; sidebar entry is **commented out** at `src/shared/lib/constants/nav.ts:348` | your call — surface or delete |
| `/office/accountancy/reports/optional-vouchers` | real report | Missing from the reports index **and** the sidebar | your call — surface or delete |

**Verify the two stubs by reading them — they are tiny:**
```bash
cat "src/app/(protected)/office/inventory/configuration/page.tsx"
cat "src/app/(protected)/office/accountancy/dashboard/page.tsx"
```

**Verify nothing links to them:**
```bash
grep -rn "inventory/configuration\|accountancy/dashboard" src --include=*.ts --include=*.tsx
```
Expect no output.

**Verify orders-estimates is only a commented-out nav entry:**
```bash
grep -rn "orders-estimates" src --include=*.ts --include=*.tsx | grep -v "useRegisterFilters"
```
Expect one hit, `src/shared/lib/constants/nav.ts:348`, starting with `//`.

**Verify optional-vouchers has no entry point.** The reports index lists 13 reports:
```bash
grep -n "href:" "src/app/(protected)/office/accountancy/reports/page.tsx"
```
`optional-vouchers` is not among them. And the sidebar:
```bash
grep -n "optional-vouchers" src/shared/lib/constants/nav.ts
```
Expect no output. (The only mention anywhere is a breadcrumb *label* at
`src/app/(protected)/office/accountancy/reports/layout.tsx:43` — a label, not a link.)

**Deliberately parked — I left these alone:** `(to-do)/welcome` and `(to-do)/core/search-slno` sit in a
`(to-do)` route group, same idea as `/lab`. Their nav entry is commented at `src/shared/lib/constants/nav.ts`.

> **Settled 2026-09-27:** both gone — welcome with `/lab`; the serial page replaced by the Workspace
> **SL Search** dialog (`SlSearchDialog`, same `/api/search-slno`), taking the whole `(to-do)` group with it.

**Also unreferenced, but on purpose — do NOT delete:**
`/office/accountancy/vouchers/[id]` and `/office/accountancy/journal-entries/[id]` are compatibility
redirect shims for stale bookmarks and stored notification links. Read them, they are ~15 lines each and
only call `redirect()`.

> **Settled 2026-10-02:** `orders-estimates` and `optional-vouchers` deleted (owner) — Day Book lists every
> estimate, order, challan, GRN and rejection (its Optional / Inventory ticks) and converts from each row's ⋮ menu.
> The two shims above deleted too, with the two stubs above, `/office/customers/dashboard` and the
> `/receipt/payment/[id]` forwarder. No code links to them, and no stored link (chat messages) points at
> them; every till runs v1.10.x, which prints Receipt / Payment through `/receipt/voucher/gl/[id]`.

---

## D. API routes no screen calls

### D1 · `/api/pos/return/lost` — a finished feature that was never wired up

261 lines at `src/app/api/pos/return/lost/route.ts`. Manager-only "customer lost the bill" return:
free-form products + qty + price, a reason, and it posts the same GL and stock reversal as a normal
return with `refVoucherId: null`.

**The UI already advertises it but cannot reach it:**
- `src/modules/pos/components/PosTopBar.tsx:161` — tooltip reads *"Process a sale return — by invoice
  number, customer, or lost invoice"*
- `src/modules/pos/components/PosSalesRegister.tsx:454` — renders the words **"Lost invoice"** for rows
  with no original reference

**Verify the tooltip and the register label:**
```bash
sed -n '161p' src/modules/pos/components/PosTopBar.tsx
sed -n '454p' src/modules/pos/components/PosSalesRegister.tsx
```
**Verify the return dialog has no such path** (527 lines, zero hits):
```bash
grep -n "lost\|Lost\|freeForm" src/modules/pos/components/PosReturnDialog.tsx
```
Expect no output.
**Verify nothing anywhere calls the endpoint:**
```bash
grep -rn "return/lost" src --include=*.ts --include=*.tsx | grep -v "/route.ts:"
```
Expect no output.

This is a product decision, not clean-up: wire the button, or remove the endpoint **and** correct the
tooltip wording.

### D2 · Three superseded endpoints

| Route | Lines | Superseded by |
|---|---|---|
| `/api/pos/person-snapshot/[id]` | 147 | `/api/pos/account-snapshot` (what the POS actually calls) |
| `/api/users/[id]/roles` (GET, PUT) | 62 | `/api/users/[id]/permissions` |
| `/api/inbox/rooms/[id]/read` (PATCH) | 36 | the messages route already calls `markRoomRead` |

**Verify no callers:**
```bash
for t in person-snapshot "users/\${.*}/roles" "rooms/\${roomId}/read"; do
  echo "== $t"; grep -rn -- "$t" src --include=*.ts --include=*.tsx | grep -v "/route.ts:"
done
```
Expect no output under any heading.

**Verify what the POS really calls:**
```bash
grep -rno "api/pos/[a-z-]*" src/modules/pos --include=*.ts --include=*.tsx | grep -o "api/pos/[a-z-]*" | sort -u
```
You will see `api/pos/account-snapshot`, not `person-snapshot`.

**Verify read-marking is already covered:**
```bash
grep -rn "markRoomRead" src --include=*.ts
```
`src/app/api/inbox/rooms/[id]/messages/route.ts` lines 36 and 81 already call it.

### D3 · Not dead — leave it

`/api/inventory/products/[id]/resync-stock` also has no caller, but its own header says
*"Maintenance utility"* — run by hand when stock caches drift. Keep.
```bash
sed -n '8,14p' "src/app/api/inventory/products/[id]/resync-stock/route.ts"
```

---

## E. Dead files — never imported by anything

E1 + E2 are the main list: **28 files, ~3,200 lines**. E3 adds 3 more that need a re-check after §0.
E4 is one file that is a behaviour question. E5 is what I deliberately left out.

Found by building the full import graph (aliases `@/*` resolved, entry points = every App Router
`page`/`layout`/`route`/etc. plus everything in electron, scripts, sync-engine, e2e, prisma). There are
**no dynamic imports anywhere** in `src` (`grep -c "next/dynamic"` → 0), so the graph is complete.

**Verify any single one** — replace the name and expect no output:
```bash
grep -rn "WorkerUpdate" src --include=*.ts --include=*.tsx | grep -v "components/WorkerUpdate.tsx:"
```

### E1 · Superseded repair-ticket UI — 8 files, 1,252 lines
The live screens are `WorkActions.tsx` and `assignments/WorkInboxBoard.tsx`.

| File | Lines |
|---|---|
| `src/modules/repairing/components/StatusUpdateCombined.tsx` | 249 |
| ~~`TicketCard.tsx`~~ — deleted 2026-10-18 | 217 |
| `src/modules/repairing/components/TicketOwnershipPanel.tsx` | 181 |
| `src/modules/repairing/components/WorkerUpdate.tsx` | 159 |
| ~~`ServiceCenterForm.tsx`~~ — deleted 2026-10-18 | 122 |
| `src/modules/repairing/components/TicketStatusUpdate.tsx` | 119 |
| ~~`PassRejectModal.tsx`~~ — deleted 2026-10-18 | 111 |
| `src/modules/repairing/components/TicketReopenButton.tsx` | 94 |

Note `PassRejectModal` is imported **only** by `TicketCard`, which is itself dead — they fall together. (Both deleted 2026-10-18.)

### E2 · Other orphans — 20 files, ~1,944 lines

| File | Lines | Note |
|---|---|---|
| `src/modules/admin/components/OrgLevels.tsx` | 310 | live org UI is `OrgExplorer` (deleted 2026-10-18) |
| `src/modules/delivery/components/DeliveryBoard.tsx` | 265 | only importer is `RefundBoard`, also dead |
| `src/modules/customer/components/CompanyProfileView.tsx` | 236 | also holds a dead link (see A4 family) (deleted 2026-09-30) |
| `src/modules/customer/components/PersonProfileView.tsx` | 224 | same (deleted 2026-09-30) |
| `src/modules/admin/components/OrgTree.tsx` | 166 | (deleted 2026-10-18) |
| `src/modules/accountancy/lib/effectiveBalance.ts` | 117 | (deleted 2026-10-12) |
| `src/modules/refund/components/RefundBoard.tsx` | 96 | |
| `src/shared/components/UniversalCreateMenu.tsx` | 92 | (deleted 2026-10-18) |
| `src/modules/admin/components/SettingsNav.tsx` | 86 | (deleted 2026-10-18) |
| `src/shared/components/Topbar.tsx` | 71 | (deleted 2026-10-18) |
| `src/modules/accountancy/components/DrillRow.tsx` | 58 | (deleted 2026-10-18) |
| `src/modules/ecommerce/components/AdminTabsNav.tsx` | 54 | its only use is commented out — `src/app/(protected)/office/ecommerce/layout.tsx:25-27` (deleted 2026-10-18) |
| `src/shared/components/OfficeModuleHub.tsx` | 45 | (deleted 2026-10-18) |
| `src/shared/components/DataPageHeader.tsx` | 35 | |
| `src/store/referenceStore.ts` | 28 | named only inside comments (deleted 2026-09-30) |
| `src/shared/hooks/useBridgePresent.ts` | 25 | (deleted 2026-10-18) |
| `src/shared/lib/auth/freeRoutes.ts` | 21 | **see E4 — read before deleting** (deleted 2026-09-27) |
| `src/shared/lib/constants/index.ts` | 7 | empty barrel, everyone imports deep paths (deleted 2026-10-18) |
| `src/shared/lib/schemas/index.ts` | 5 | same |
| `src/modules/customer/lib/initials.ts` | 3 | **duplicate** — live one is `src/shared/lib/format/initials.ts` |

**Verify the AdminTabsNav claim:**
```bash
sed -n '24,28p' "src/app/(protected)/office/ecommerce/layout.tsx"
```
You will see the `<AdminTabsNav …>` wrapped in `{/* … */}`.

**Verify the initials duplicate:**
```bash
grep -rn "from \"@/shared/lib/format/initials\"\|from \"@/modules/customer/lib/initials\"" src --include=*.tsx --include=*.ts
```
Every importer uses the `shared/lib/format` one.

### E3 · Orphans in the external (shop/portal) half — 3 files, 101 lines
`src/modules/external/portal/PortalHeader.tsx` (63), `src/modules/external/shop/AddToCartButton.tsx` (15),
`src/store/external/portalSocialStore.ts` (23).
⚠️ Re-check these **after** the counter-build restore in §0, since that half of the app is renamed aside
right now. My graph folded the renamed files back in, but a second look after restore costs nothing.

### E4 · Orphan that is really a missing gate — do not just delete

> **Settled 2026-09-27:** owner confirmed dropping the gate was intended; `freeRoutes.ts` and `/office/welcome` deleted.

`src/shared/lib/auth/freeRoutes.ts` (21 lines, deleted 2026-09-27). Its own comment says it is
*"Used by `src/app/(protected)/office/layout.tsx` to redirect position-less users to `/office/welcome`"*.

**That layout no longer imports it.** So staff with no operational position are not being routed to the
welcome page any more — the file is dead because the **gate** was dropped, not because it was replaced.

**Verify:**
```bash
sed -n '1,12p' src/shared/lib/auth/freeRoutes.ts
grep -n "freeRoutes\|isFreeRoute\|welcome" "src/app/(protected)/office/layout.tsx"
```
Expect the second command to print nothing.

This is a behaviour question for you, not a delete decision.

### E5 · Orphans I deliberately did NOT list as dead — keep

- `src/shared/components/Field.tsx`, `src/shared/components/FieldSaveMark.tsx`,
  `src/shared/lib/a11y/rowActivation.ts` — the six-UI-patterns mechanism, D/E/F rollout still open.
- `src/modules/lab/components/*` (3 files) — `/lab` is your under-construction area.
- `src/components/ui/command.tsx`, `input-group.tsx`, `navigation-menu.tsx`, `toggle.tsx` — vendored
  shadcn primitives; unused today but they are library files, not your code.

---

## F. Low priority — over-exporting, not dead code

277 exported functions/constants across 152 files are never imported anywhere. These are mostly internal
helpers that were exported without need — not code to delete, just `export` keywords to drop. Worst
offenders:

| File | Unused exports |
|---|---|
| `src/modules/bi/lib/gstPlanning.ts` | 23 of 55 |
| `src/modules/delivery/lib/deliveryMethodConfig.ts` | 13 |
| `src/modules/pos/lib/paymentGateways.ts` | 6 |
| `src/modules/inventory/lib/unitFormat.ts` | 5 |

Also, 3 entries in `VOUCHER_URLS` point at pages that do not exist —
`ESTIMATE → /vouchers/estimates/[id]`, `POS_ESTIMATE → /vouchers/pos-estimates/[id]`,
`POS_ORDER → /vouchers/pos-orders/[id]` (`src/modules/inventory/lib/voucherFormUrls.ts:22,23,24`).
Harmless today because `EDIT_FORM_URLS` shadows all three in the one caller
(`src/modules/inventory/components/VoucherActionsMenu.tsx:78-80`), but it is a 404 waiting for the day a
type loses its edit form.

**Verify the shadowing:**
```bash
sed -n '77,83p' src/modules/inventory/components/VoucherActionsMenu.tsx
```

---

## Summary

| Category | Count | Risk to fix |
|---|---|---|
| A · Dead links a user can click | 10 live + 3 in `/lab` | low |
| B · Broken legacy redirect rules | 7 | low |
| C · Pages nothing reaches | 4 (2 stubs, 2 real) | low |
| D · API routes nothing calls | 4 (1 is an unwired feature) | medium — D1 is a product call |
| E · Dead files | 28 files, ~3,200 lines | low, once §0 is restored |
| F · Needless exports | 277 names | cosmetic |

**Two decisions that are yours, not clean-up:**
1. **D1 — the lost-invoice return.** Wire the button, or remove the endpoint and fix the tooltip?
2. **E4 — the position-less staff gate.** Was dropping it intended? If not, `/office/welcome` and
   `freeRoutes.ts` need re-wiring, not deleting.

**Order I would work in:** restore §0 → A + B (visible, safe) → C → E (minus E4) → decide D1 and E4
separately.
