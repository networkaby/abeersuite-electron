# UI/UX — the six patterns

A UI/UX audit on 12 September 2026 read every page the sidebar can reach (121 live
destinations, 244 labels in the nav tree) plus the app shell and the POS screen.
It found 138 things worth fixing — but they were not 138 separate mistakes. Almost
every one is a repeat of six habits.

This document is the standing rule for those six, and the checklist for the rest of
the rollout. **The shared mechanism for all six now exists.** What is left is
applying it page by page, which is listed under "Still to do" in each section.

The audit's own wording is worth keeping in mind, because it explains why these
six and not others: they are the habits that make the screen *lie* to the person
reading it — a failed load that reads as an empty shop, a stale figure that reads
as current, a price that looks saved and is not.

---

## The rule, in one line each

| | Pattern | Rule |
|---|---|---|
| **A** | A failed load must never look like an empty shop | Keep the error, render it, offer Retry |
| **B** | A refresh must not throw away the screen | Spinner only when there is nothing to show |
| **C** | The big writes ask first | Confirm names the scope — the count, the name |
| **D** | A blur-save says it saved | Tick on success, put the old value back on failure |
| **E** | Anything clickable is reachable by keyboard | Real `<button>`, and every label owns an `id` |
| **F** | No table renders a whole year | Page on the server; `useClientPagination` otherwise |

---

## A — a failed load must never look like an empty shop

**What was wrong.** The house habit was: catch the error, fire a toast, leave
`data` at `null` or `[]`. The toast fades in four seconds. What is left on screen
is "No orders yet", "No brands yet", "No products", or a header above a void —
and staff read that as fact. On the balance sheet and the twenty BI reports the
body renders only when `data` is truthy, so a network blip gave a header, a date
picker and nothing else, with no way to retry.

**The mechanism.** `src/shared/components/QueryStateBlock.tsx`.

```tsx
{status}
{data && <TheReport … />}
```

Four states in priority order: first-load spinner → error with Retry (when there
is nothing to fall back on) → a slim "could not refresh, these are the last
figures" banner *above* stale data → nothing. The third state matters: the last
good figures are still worth reading, they just must not pass as current.

For a page that is one table, `tableStateKind()` in the same file picks between
the existing `TableLoadingRow` / `TableErrorRow` / `TableEmptyRow`. The bug it
prevents is showing "No brands yet" when the fetch actually failed.

**Done.** `useBiQuery` (all 20 BI reports), `useApiResource` (every caller).

**Still to do** — each needs an `error` state kept and `{status}` rendered:

- The seven accountancy statements: balance sheet, profit and loss, trial
  balance, cash flow, fund flow, ratio analysis, statistics, and usable fund.
- Payables and receivables (`OutstandingsReportScreen`), the three GST reports,
  pending vouchers.
- The eight inventory masters (brands, GST rates, units, warranty terms,
  categories, BOMs, attribute masters) and the stock summary — these currently
  render the *empty* row on failure, which is the worst version of this bug.
- `inventory/reorder` and `inventory/inventory-details` — the latter has no
  loading flag at all, so it shows "No products" on first paint too.
- `ecommerce/orders` and `ecommerce/products` — both `.catch(() => setX([]))`.
- Silent empty pickers: a failed branch or account list leaves a filter dropdown
  simply absent (`pending-vouchers`, `opening-balance`, `attribute-masters`,
  `repairing/tickets`).

---

## B — a refresh must not throw away the screen

**What was wrong.** Realtime was handled beautifully: every ledger and register
refetches silently when another counter posts a voucher, and the reasoning is in
the comments. The *manual* path never got the same treatment. Pressing Refresh,
changing a date, or saving one inline edit flipped a loading flag that unmounted
the whole report and replaced it with a centred spinner — scroll position,
expanded groups and half-typed cells with it. On `inventory/reorder` an inline
lead-time edit wiped the table mid-edit, and a POS sale elsewhere in the shop did
the same to whoever was reading it.

**The mechanism.** Tell the two cases apart, because they are different:

- `loading` — nothing on screen yet. A spinner is honest.
- `refreshing` — same URL, re-fetched over data the user is reading. Keep the
  data. Put the indicator in the toolbar, not over the table.

`useApiResource` now returns both. A *change* of URL counts as the first case,
not the second: holding one account's ledger under another account's name would
be a worse bug than the flicker.

This is AGENTS.md §7 in practice — "no blank flicker, show cached data while
refreshing".

**Done.** `useBiQuery` and all 20 BI pages (they now gate on `data`, not
`!loading`). `useApiResource` for every caller.

**Still to do:**

- `AccountLedgerExplorer` — all four ledger pages blank the detail pane on a date
  change or Refresh.
- The seven accountancy statements, `BookPage`, `OutstandingsReportScreen`, the
  GST reports and pending vouchers — all have the `silent` flag already, wired
  for realtime only. Extend it to the user-initiated path.
- `inventory/reorder` (the worst case — it loses a mid-edit), `inventory-details`,
  `pricing-strategy/needs-attention` and `pricing-strategy/costing`.

---

## C — the big writes ask first

**What was wrong.** Small deletes were already guarded. The largest writes were
not. "Save barcode Price" re-froze the sale price for every ticked row in the
whole filtered list — the header checkbox ticks all of them, which can be
thousands — on one click. The offline-policy "Defaults" button PATCHed shop-wide
policy the instant it was pressed. Deleting a spend-tier period took all its
levels. Removing a courier service took all its zone rows.

**The mechanism.** `confirmAction()` in `src/shared/lib/ui/confirmStore.ts`,
rendered by the single `<ConfirmHost />` in the root layout.

```ts
const ok = await confirmAction({
    title: `Freeze the barcode price for ${count} products?`,
    body: "POS and the shop will charge from this price. It cannot be undone in one step.",
    confirmLabel: `Freeze ${count} prices`,
});
if (!ok) return;
```

Deliberately not a hook and deliberately nothing for the caller to render — a
rule only gets applied everywhere if guarding an action is a single `await`.
With no host mounted it resolves `false`: a dangerous action must never proceed
because the UI failed to ask. Cancel takes the initial focus, so Enter never
confirms a destructive action by accident.

This also replaces the browser's native `confirm()`, which cannot show a count,
cannot be styled, and looked wrong beside the properly styled voucher-delete
dialog. `useDeleteWithConfirm` now routes through it, so **every existing caller
was upgraded without touching its code**.

**Done.** Bulk price freeze and "Clear selection" (update-print-labels), offline
policy Defaults and Enable All Safe, spend-tier period and level deletes, courier
service removal, and all nine `useDeleteWithConfirm` callers.

**Still to do:**

- `pricing-strategy/strategies` — Save reprices the catalogue with no confirm.
  (Reset *is* confirmed, so today the riskier button is the unguarded one.)
- `ecommerce/home` — deleting a home-page section.
- `ReconnectWorkspace` — deleting a saved filter, which for a shared filter
  deletes it for the whole team.
- Name the record in the confirms that do not: branches, departments, positions
  and users all say "Delete this user?" where counters and roles already
  interpolate the name.
- `BackupRestorePanel` — the Dropbox restore confirm says "the selected Dropbox
  backup" without naming the file or the target database, though both are on
  screen.

---

## D — a blur-save says it saved

**What was wrong.** Margin, MRP, service price, customer group name and unit
fields all write when focus leaves the box. Success was silent, so nobody could
tell whether it landed. Failure toasted and then left the rejected number sitting
on screen looking saved. These are the numbers the till charges by. Worse, in
the old `CustomerGroupsManager`, clearing a name and blurring saved nothing at all
while the box stayed visibly empty, so the old name silently returned on reload.

**The mechanism.** `useFieldSave` + `<FieldSaveMark />`. Three rules it makes
explicit:

1. Do not write when nothing changed — a tab-through is not an edit.
2. Say "saved", briefly, where the user is looking.
3. On failure put the **original value back**. Leaving the rejected text in the
   box is what makes people believe a bad price was accepted.

**Still to do** — the rest of it:

- `update-print-labels` — margin % and MRP (the highest-stakes instance).
- `pricing-strategy/needs-attention` — cost-excl, cost-incl and MRP.
- `PosServicesManager` — service name, ledger, GST and price (Settings → Services; the same catalogue the POS cart and every office trading voucher add from).
- ~~`CustomerGroupsManager`~~ — done: that page was retired into Pricing Strategy →
  Group pricing (`GroupPricingManager`), whose group rename uses `useFieldSave` and
  puts the old name back when the box is emptied.

---

## E — anything clickable is reachable by keyboard

**What was wrong.** Nearly every drill-down in the books and the BI reports was
an `onClick` on a `<tr>` or `<td>`, with no role and no tab stop — around 30
tables where a keyboard user could not open a single drill-down. There is no
`tabIndex` or `role="button"` anywhere under the BI folder. On the balance sheet
and profit and loss it is worse: the expand chevron is a clickable `<span>` nested
*inside* a `<button>`, so Tab lands on the button and Enter navigates away instead
of expanding. Seeing a pending voucher's line items is bound to right-click only,
advertised in a hover tooltip.

Separately, 150 `<Label>` elements across the settings area carry no `htmlFor`
against 15 that do, and the shared `BiFilterBar` pushes the same gap onto
seventeen reports at once.

**The mechanism.**

- `rowActivation(onActivate, label)` and `disclosureActivation(...)` in
  `src/shared/lib/a11y/rowActivation.ts`. Note the order of preference stated in
  that file: **a real `<button>` in the first cell is the right fix**, because a
  screen reader then announces the row's name as the thing being activated, which
  a whole clickable row can never do. The helper is for tables where that would
  be a large rewrite.
- `<Field label="From">{(id) => <Input id={id} … />}</Field>` mints the id itself
  and hands it to the child, so there is no pair of strings left to drift apart.

**Still to do** — all of it:

- `BiFilterBar` first: one file, seventeen reports fixed.
- The BI drill-downs: bill-profit, customer-profit, item-by-party,
  movement-register, purchase-price-variance.
- The accountancy drill-downs: `BookPage`, trial balance, balance sheet, profit
  and loss, cash flow, `VoucherRegisterTable`, opening balance, outstandings,
  pending vouchers.
- The chevron-inside-a-button bug on balance sheet and profit and loss.
- `stock-summary` group rollup rows and the `product-groups` movement-bands cell.
- Org chart nodes (`OrgHierarchy`, `OrgExplorer`) — divs with click handlers.
- Labels: the eight inventory masters, the settings forms, and the offline-policy
  switches (which have no accessible name at all).
- Icon-only buttons with no name: Print on every ledger page, Refresh on
  `usable-fund` and `CallLogWorkspace`, edit/delete on users and branches, the
  BOM line remove.

---

## F — no table renders a whole year

**What was wrong.** The BI reports default to the fiscal-year start and then
render every row the API returns — only the *charts* slice to 10 or 25. Bill
profit renders every bill of the year; the item reports render the whole
catalogue. Receivables renders every party and every open bill. The
opening-balance migration screen renders every account and every product at once,
which is exactly the screen a shop arriving from Vyapar opens with thousands of
parties.

With 3,684 people and 3,544 vouchers already in the live books, this is a
measurable freeze, not a hypothetical one.

**The mechanism.** `useClientPagination(rows, pageSize)` with the existing
`PaginationBar`.

It is deliberately the **second**-best fix. Where the server can page, page on the
server: Day Book and Pending Vouchers already do, with honest "showing X–Y of N"
footers. Use the hook where the whole set genuinely has to be in the browser
because it is sorted, grouped or exported client-side, and the only real problem
is painting ten thousand rows.

The one bug it exists to prevent: filtering down to three results while sitting on
page 9 and being shown an empty table. Any change to the row count clamps the page
back into range.

**Still to do** — all of it:

- Every BI table (start with bill-profit, item-profit, abc, stock-health).
- `OutstandingsReportScreen` — both the party and bill-wise tabs.
- `opening-balance` — accounts and products.
- `stock-summary` item view, `inventory-details` product panel.
- `ecommerce/products` — currently fetches the whole catalogue with no limit and
  filters in the browser on every keystroke.
- Cap or warn on the "All" page-size option in `products` and
  `update-print-labels`.

---

## Related fix shipped alongside

**The silent voucher screens.** `<Toaster />` was mounted in `office/layout.tsx`,
`(gl)/layout.tsx` and the three POS register layouts — but *not* in
`vouchers/layout.tsx`. So `/vouchers/pos` and every inventory voucher route
(challans, GRN, purchase orders, physical stock, branch transfers, rejections,
manufacturing journals) had no toast host at all: their `toast.error` calls
rendered nothing, and a failed save looked exactly like a successful one.

It is now mounted once in `vouchers/layout.tsx` and removed from the four nested
layouts. Nested `Toaster`s are **not** harmless the way nested SessionProviders
are — each renders its own copy of every toast.

---

## Not in the six, still open

Kept here so the list is not lost. Full detail is in the audit report.

- **No error boundary anywhere.** There is no `error.tsx` and no `not-found.tsx`
  in the app. A render-time throw on any of the 121 pages falls through to the
  global error page instead of something scoped that keeps the shell.
- **The sidebar loses its place.** The section open/closed map in `Sidebar.tsx`
  is keyed on paths that do not exist: `tally` against `/office/finance` where
  the real key is `accountancy`, `administration` against
  `/office/roadmap/administration`. POS, BI, help desk and compliance have no
  entry at all. It is also mount-time only, so it is never persisted.
- **~40 built pages have no way in** — every voucher register except All, the
  accountancy and customers dashboards, the BI and inventory landing pages, and
  all six workflow settings sub-pages.
- **A live redirect to a page that was never built** — `/office/service-centers`
  forwards to `/office/repairing/service-centers`, which does not exist.
- **Two status endpoints polled before anyone signs in.** `useSyncStatus` and
  `useCounterMode` are mounted in the root layout, which wraps the staff login
  and the public storefront. Each hook keeps its own interval and two components
  mount each, so both endpoints are requested twice per tick and answer 401 every
  time — including for a customer browsing the shop.
- **No global search.** 121 destinations, and the only way to reach one is
  scrolling the tree. `src/components/ui/command.tsx` already exists and is
  unused for navigation.
- **The sidebar has no responsive rule** in 968 lines, and `ButtonBar` claims
  another 224px, so the shell takes 480px of a 1366px laptop before any content.
- **Unsaved-change guards.** Five settings forms compute a `dirty` flag that
  nothing reacts to; the pricing pages have none. The pattern to copy is in
  `TradingVoucherPage`.
- **The two CSV imports can commit a mapping that was never previewed** —
  changing the column mapping or duplicate mode after a preview does not clear
  it, so the confirm quotes the old numbers while the request sends the new
  mapping.
