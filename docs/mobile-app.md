# Staff phone app (`/m-staff-app`)

An installable phone app for staff who are away from a counter: look up stock and
price, see a party's balance and bills, see who owes us and whom we owe, read a
day's vouchers, and record a Receive / Pay / Expense on the spot. It is a module
like Accountancy or Inventory — it has its own section on the Role page, its own
chip on the Departments page, and this doc. Code lives in `src/modules/mobile`.

Owner's purposes: *"we need a android app with basic features, product available
qty and sale price. party balance and outstanding"* (2026-10-02); *"record/view
quickly with less db cost… so we dont forget if the transaction happen outside
premise or on holyday. bill wise link can be done later"* (2026-10-03). Detailed
work stays on the desktop; nothing already built was removed.

Status lives in [PROJECT_BRAIN.md](../PROJECT_BRAIN.md); this file says how the app
works.

---

## 1. Who can use it

**Sign-in is unchanged.** A phone is never a counter, so only staff holding
**"Can login outside counter"** (`auth:login:outside-counter`) get in; it is enforced
at sign-in (`authorizeStaff.ts`). The app is for senior staff — lower-level staff must
not get in, and there is **no mobile-only sign-in path**. (Owner, Option 1: riders and
salesmen get a narrow mobile-only permission later, on request; that one must then be
locked to its own screens in `proxy.ts` and at the API.)

**Each screen has its own tick**, checked by the page ([`mobileAccess.ts`](../src/modules/mobile/lib/mobileAccess.ts),
`mobileUser(permission)`) and again by its API (`requirePermission(permission)`):

| Screen | Tick | API |
| --- | --- | --- |
| Stock & price | `mobile:stock:view` | `/api/mobile/stock/[id]` |
| Party | `mobile:parties:view` | `/api/mobile/parties`, `/parties/[accountId]`, `/parties/[accountId]/vouchers` |
| Receivables | `mobile:receivables:view` | `/api/mobile/outstanding/[side]` |
| Payables | `mobile:payables:view` | `/api/mobile/outstanding/[side]` |
| Day Book | `mobile:daybook:view` | `/api/mobile/daybook` |

- A party's bills open on any of the three party ticks (`PARTY_TICKS` /
  `PARTY_DETAIL_PERMISSIONS`), because receivables and payables open them too.
- **Quick Receive / Pay / Expense and the Pay / Receive forms use no tick of their
  own**: they need the office Payment / Receipt **create + post** ticks (read through
  the CRUD ladder, `hasPermissionWithScope` — a session carries only the highest
  rung) plus a party tick. That is [`quickEntryFor`](../src/modules/mobile/lib/mobileScreens.ts).
- The permission rows are in `permissionCatalog.ts` (module `mobile`) and
  `permissions.ts` (`MOBILE_*_VIEW`).

### How admins give it out

- **Role page → "Sidebar links" → "Mobile App"** lists the five screens as ticks, with
  a note that sign-in still needs "Can login outside counter" (that one stays in the
  Global card). The section is built from `MOBILE_SCREENS` by `MOBILE_APP_MODULE` in
  [`sidebarModules.ts`](../src/shared/lib/auth/sidebarModules.ts); its links carry the
  screens' own `mobile:*` ids (flag `ownIds`, so `sidebarPermissionSeeds()` does not
  mint them a second time as `ui:sidebar:*`).
- **Departments page → pool chip "Mobile App"**, like any other module. It obeys the
  department pool: a role is offered the screens only if its department carries the
  chip (a tick a role already holds is always shown). Pooling one id pools all five
  (and any screen added later — `expandSidebarModules`).
- **Taking the chip off a department strips the phone ticks from that department's
  roles** (the ordinary cascade in `PUT /api/departments/[id]/permissions`) and
  revokes those roles' sessions. Adding the chip strips nothing.
- The desktop sidebar reads `MODULE_SECTIONS`, not this module — no "Mobile App" link
  appears in the office menu, and `pageAccess.ts` locks only `/office` paths, so the
  phone app is untouched by it.
- Seed: `personal.local.json` pools Mobile App on Management (`DEP-OP`). `DEP-ADMIN` is
  all-access and needs no row.
- **Rolling out to live:** tick "Mobile App" on the live Departments page for the
  departments that should have it (do **not** reseed for this — a full seed re-adds
  R1 permissions). Roles that already hold a phone tick keep working meanwhile.
  Permission rows themselves reach a database with `seed:sync-permissions` (or the
  first Role / Departments save, via `ensureCatalogPermissions`); to grant R1 on live:
  `seed:sync-permissions --grant … --roles R1 --apply`.

---

## 2. Address and staying in its own area

The address lives ONLY in [`PHONE_APP_HOME`](../src/shared/lib/device/phone.ts)
(`/m-staff-app`), plus the route folder name `src/app/m-staff-app` and `PHONE_APP_DIRS`
in `appModeCore.ts`. Owner: *"change the /m to other, to keep /m reserved for
future use"* — a future `/m` app must use PWA scope `/m/`.

Owner: *"mobile app should be within its area, not open desktop app or webapp pages"*.

- [`isPhoneRequest`](../src/shared/lib/device/phone.ts) (Client Hint `Sec-CH-UA-Mobile`,
  else the user agent; tablets and Chrome's "Desktop site" read as computers — the admin
  escape hatch) makes `proxy.ts` send phones from every staff page (`/office`,
  `/vouchers`, prints, previews) to the app.
- Shop / portal / sign-in pages are untouched (customers on phones; a customer shop
  app will come on shop.networkservice.in).
- A signed-in visit to a sign-in page goes back to the app when `callbackUrl` is in it or
  the device is a phone (`staffHome`). Sign out goes through `signOutTo` (NextAuth's own
  redirect could land on shop.*). The sign-in page hides "Customer? Sign in here" when
  signing in for the app. `?from=` back addresses pass `appBack`.
- The app has its own `not-found` / `error` with Back to Home.
- The app is stripped from the public (shop) and counter builds (`PHONE_APP_DIRS`).

---

## 3. Install

An installable PWA on the office site: manifest `id` = the app path, name "Network
Service Staff" / "NS Staff" (kept apart from the future customer app), 192 + 512 +
maskable icons (`public/m-icon-*.png`, from `build/icon.png` — the 512 is upscaled;
replace it with a sharper source when there is one). Manifest route:
[`manifest.webmanifest`](../src/app/m-staff-app/manifest.webmanifest/route.ts), scope
the app path only, so the office site and shop stay plain websites. A `.apk` wrapper
can come later.

Owner: *"i want the QR force install instead of just open the website"*. A phone never
lets a site install itself, so the Downloads QR is always `COMPANY_DETAILS.sites.office`
+ [`PHONE_APP_INSTALL`](../src/shared/lib/device/phone.ts) — the install page
[`install/page.tsx`](../src/app/m-staff-app/install/page.tsx), open **without** sign-in
(`isPublicPath`; the app's screens sit in the signed-in `(app)` route group so this page
is outside it). It shows only the app and
[`InstallAppButton`](../src/modules/mobile/components/InstallAppButton.tsx):

- Android Chrome → "Install NS Staff" (Chrome's `beforeinstallprompt`, then its own confirm);
- iPhone → Share → Add to Home Screen;
- already installed → Open app;
- no offer (http test address / other browser) → Chrome ⋮ → Install app.

The app itself shows **no** install prompt (owner). Local testing on the shop Wi-Fi is
typed by hand.

---

## 4. Screens

One screen list, [`MOBILE_SCREENS`](../src/modules/mobile/lib/mobileScreens.ts), drives the
Home tiles (`src/app/m-staff-app/(app)/page.tsx`), the side menu, the
bottom tab bar, and the Role / Departments "Mobile App" module.

- **Side menu** ([`MobileShell`](../src/modules/mobile/components/MobileShell.tsx)): ☰ in every main
  screen's header; every screen held, grouped by `MOBILE_GROUPS` (Stock / Parties /
  Accounts); name + role at the top; **Sign out at the bottom** — the only place it
  lives; closes on a link, an outside tap or Escape.
- **Bottom tab bar** ([`MobileNav`](../src/modules/mobile/components/MobileNav.tsx)): Home + the first
  `MAX_SCREEN_TABS` = 3 screens held (owner picked "both" over side-menu-only); a tab
  stays lit on its detail pages; padded by the phone's gesture area via
  `viewportFit: "cover"`.
- A searched list uses [`MobileListScreen`](../src/modules/mobile/components/MobileListScreen.tsx)
  (optional `summary` slot for totals / chips) and supplies only its rows — filtered on
  the device for a catalogue it holds, or server-paged with
  [`useMobileList`](../src/modules/mobile/hooks/useMobileList.ts) (`more` = the next page's
  query — cursor, running balance; extra `params` such as the Day Book's date; first page
  saved; `freshMs`) when the list is too big to hold. A single GET uses
  [`useMobileResource`](../src/modules/mobile/hooks/useMobileResource.ts) (`since`, `freshMs`).
- Main screens get ☰; detail screens pass `back` (a party's bills go back to the list
  they were opened from via `?from=`).

Reference studied: the Vyapar Android app (left menu of Parties / Items / Reports,
dashboard of outstanding, Day Book by date, per-party WhatsApp / SMS reminder).

### Stock & price
[`MobileStock`](../src/modules/mobile/components/MobileStock.tsx) searches the POS product catalogue
already on the device (`useProductCatalog` — Dexie `products`, one full download then
deltas, live on the stock / catalogue signals) with the till's own `searchProducts`
(name, SKU, any barcode, typos) — **no request per search**, works offline. Shows on-hand,
sale price and MRP, **never cost** (the catalogue row carries cost for the POS; this screen
does not read it — a future narrow salesman / rider permission must get a slim catalogue
without it). Tapping a row asks
[`/api/mobile/stock/[id]`](../src/app/api/mobile/stock/[id]/route.ts) for the per-branch
split (`loadLiveStockByBranch`).

### Party
[`MobileParties`](../src/modules/mobile/components/MobileParties.tsx) searches the party list already
on the device (`usePartyList` / `searchPartyRows` — the same list `PartiesWarmup` loads on
every page, so no extra download). **There is no party search endpoint**, per the standing
rule — do not add one. Suppliers are hidden without "Show suppliers (creditors)". Named
"Party" (was "Party balance"; owner, 2026-10-03 — same tick id).

Balances for the rows on screen only:
[`/api/mobile/parties?ids=…`](../src/app/api/mobile/parties/route.ts) (max 60, the hook
batches 50), summed from the ledger ([`partyBalances`](../src/modules/mobile/lib/partyBalances.ts)),
held in memory for the session by
[`usePartyBalances`](../src/modules/mobile/hooks/usePartyBalances.ts) — it asks only for ids it
lacks, and after `MOBILE_FRESH_MS` re-checks with `known` + `since` (unchanged books →
only the new ids are summed).

Tap a party → the party screen: balance + Pay / Receive, then two tabs.

- **Vouchers** (first tab; owner: *"in party i will see last vouchers so i know if the last
  voucher was posted"*, *"simple voucher list, and running balance"*) —
  [`/api/mobile/parties/[accountId]/vouchers`](../src/app/api/mobile/parties/[accountId]/vouchers/route.ts)
  + [`MobilePartyVouchers`](../src/modules/mobile/components/MobilePartyVouchers.tsx). Every voucher
  of the party (spine party, a leg on its ledger, or a bill made out to the person /
  company — the office Transactions tab's rule), EVERY status, newest first in the Day
  Book's order (date, real save time, id), 30 a page. Drafts are tagged "Draft — not
  posted", cancelled are struck through, posted get a small ✓. Shows the date, the real
  save time only when there is one (imported rows carry midnight UTC → date alone; a
  back-dated save says "saved 19 Sept, 2:51 pm") and who saved it. The balance after each
  POSTED voucher is walked back from the party's balance now, the next page carried by
  `more: { cursor, balance }`. Same-day order follows entry order, as the office Account
  Ledger does, so a payment entered before its bill shows a brief "to receive". Asked on
  every open (`useMobileList` `freshMs: 0`, still `?since=`).
- **Unpaid bills** — [`/api/mobile/parties/[accountId]`](../src/app/api/mobile/parties/[accountId]/route.ts):
  balance ([`partyBalances`](../src/modules/mobile/lib/partyBalances.ts), shared with the list)
  plus unpaid bills (`getLedgerOutstanding`, the Receivables engine), and the gap between
  them shown as "Not against any bill" — money on account moves the balance but settles no
  bill, so the two figures can differ.

### Receivables / Payables
[`/api/mobile/outstanding/[side]`](../src/app/api/mobile/outstanding/[side]/route.ts) +
[`MobileOutstanding`](../src/modules/mobile/components/MobileOutstanding.tsx): `getOutstandings` (the
office report's engine) sent as the party list only (no flat bill list) with primary phone
and the oldest bill's days; total + age chips (0–30 / 31–60 / 61–90 / 90+, tap to narrow and
rank by that age); search over the list on the phone (name, phone, GSTIN).

### Day Book
[`/api/mobile/daybook`](../src/app/api/mobile/daybook/route.ts) +
[`MobileDayBook`](../src/modules/mobile/components/MobileDayBook.tsx): one day (◀ date ▶, the shop's
today via `businessTodayIso`), handed to the office Day Book handler itself (`GET` imported
from its route, 100 a page, cursor) and trimmed to kind / no. / party / narration / amount /
status. Totals per kind over posted rows on screen ("so far" while more pages remain);
search passes through as the office `search`.

---

## 5. Recording money — Pay, Receive, Expense

### Pay / Receive on a party
Owner: "both" — record it AND pay by UPI; Receive added too. Buttons on a party's bills
screen ([`MobilePartyBills`](../src/modules/mobile/components/MobilePartyBills.tsx)) for whoever holds
the Payment / Receipt **create + post** ticks (no new tick; the one matching the balance's
direction is the main button) → [`MobileMoneyForm`](../src/modules/mobile/components/MobileMoneyForm.tsx)
at `/m-staff-app/parties/[id]/pay` and `/receive` (one page factory,
[`moneyFormPage`](../src/modules/mobile/components/moneyFormPage.tsx)).

- Money goes on the bills in `autoLinkOrder` (due date first — the settling step's own
  order, so the screen is what is saved; the party API sends `dueDate`), worked out by
  [`placeOnBills`](../src/modules/mobile/lib/moneyPlacement.ts):
  - untouched = every bill ticked, amount = their total;
  - **an amount typed = the ticks follow it** — the oldest bills it covers, the last in part
    ("₹100 of ₹320"), an advance only once every open bill is full (owner, 2026-10-03:
    *"the 100 should be adjusted to next bill"*);
  - a tick changed after typing = the hand-picked bills win and the amount stays;
  - amount cleared = back to the ticked total;
  - no ticks = the server's oldest-first auto-link, as in the office.
- The confirm step lists each bill with its amount; `settleFromPicks` gets exactly those
  part amounts.
- Paid from / Received in = cash / bank / OD ledgers, remembered per person and direction;
  mode chips (`PAYMENT_INSTRUMENTS` less Other) + UTR / cheque no.; date; branch
  ([`/api/mobile/pay-setup`](../src/app/api/mobile/pay-setup/route.ts) — ticks, money ledgers,
  branches, default branch; the choice goes through `useActiveBranchStore`, which
  `stampRequestContext` sends as `x-active-branch`).
- A supplier whose Bank tab has a UPI ID gets "Open UPI app" (`buildPartyUpiLink` + `&am=`),
  returned by the party API as `upiLink` with each bill's `universalVoucherId`.
- It **saves through the office `POST /api/accountancy/vouchers`** (posted, `autoLink:false`
  when ticks) and settles the ticks with the office's own `settleFromPicks` (`maxOwn` =
  amount) — a phone payment is the office Payment in every way.
- Tested on the dev DB: RV-10797-26 ₹11,700 from Prodip Kr Das ("TEST – partial") → links
  928 ₹11,600 + 1082 ₹100; PMT-10801-26 ₹9,510 to D.M. DISTRIBUTORS ("TEST – phone app")
  posted at BR-HQ, Cr Cash – Counter 21 / Dr party (UPI, UTR123456), one `VoucherAllocation`
  to DMD/2627/114928, party balance 39,390 → 29,880.

### Quick Receive / Pay
Owner: *"we need quick payment and received voucher entry"*, *"go + expenses"*. A **+**
button over the tab bar on every phone screen except the entry screens (`MobileShell`
`QuickEntryButton`) and Receive / Pay tiles on Home, shown by
[`quickEntryFor`](../src/modules/mobile/lib/mobileScreens.ts) (ticks: §1).

→ [`MobileQuickPick`](../src/modules/mobile/components/MobileQuickPick.tsx) at
`/m-staff-app/quick/receive` | `/quick/pay`: searches the party list on the device (no
request per key) and, for Pay, the expense ledgers — every ledger under
`ACCOUNT_GROUPS.DIRECT_EXPENSES` / `INDIRECT_EXPENSES`, sub-groups included, sent by
pay-setup as `expenseLedgers` (Purchase Accounts left out: purchases go through purchase
vouchers); the last 6 picked per person and direction on top (localStorage convenience).

- A party opens the ordinary form (`?from=/m-staff-app/quick/…` → back to the picker).
- An expense opens `/m-staff-app/quick/pay/expense/[accountId]` — `MobileMoneyForm`
  `expense`: no bills, no UPI, no `partyAccountId`, Dr expense (with the mode) / Cr
  cash-bank.
- The saved screen from quick entry offers **New entry** (back to the picker, same cash /
  bank and mode) and Done.

### Expense
Owner: *"in home page give exp so it allow only exp voucher is save egress"*. A third Home
tile and + option → `/m-staff-app/quick/expense`, `MobileQuickPick` `kind="expense"` —
expense ledgers ONLY, the whole list before anything is typed (recent on top), straight from
the saved pay-setup (no request on open within 10 min), no party search or balance calls;
the form saves one voucher with no bills to link. The expense form's back / New entry
return to whichever picker opened it (`?from=`). Tested on the dev DB: PMT-10802-26 ₹150 to
Electricity Charges ("TEST – expense from phone"), no party, Dr Electricity Charges / Cr
Cash – Counter 21.

---

## 6. Egress and cost (owner: "save egress cost")

- Every server answer a phone screen shows (a party's bills, receivables / payables, a Day
  Book date, pay setup) is saved on the device in the shared Dexie database (`localDb` v6
  `answers`, keyed screen + user, capped at 60) by
  [`mobileCache.ts`](../src/modules/mobile/lib/mobileCache.ts) `loadAnswer`: shown at once; not
  re-asked while younger than `MOBILE_FRESH_MS` (1 min; pay setup `MOBILE_SETUP_FRESH_MS`
  10 min); after that re-asked with `?since=<computedAt>`.
- The money APIs then answer `{ unchanged: true }` (58 bytes, no recompute — receivables'
  full answer is ~12 KB plus the open-bills scan) when
  [`booksUnchangedSince`](../src/modules/mobile/lib/booksUnchanged.ts) finds no voucher written
  **or deleted** (recycle-bin `AuditLog`) since, within `MOBILE_SINCE_TRUST_MS` (30 min;
  bounds the day rollover and anything the probe cannot see). `isUnchangedSince` took the
  trust window as a parameter for this.
- Offline: the saved figures stay up with "Showing figures from 10:42" (`offlineNote`).
- A posted payment / receipt drops the party, receivable / payable and Day Book answers
  and the held balances.
- Saved answers are read in an effect, never the first render (that was a hydration error).
- Measured in Chrome: a typed product or party search makes no `/api` request; reopening
  Receivables within a minute makes none.
- Still per page load and not phone-specific: `/api/sync/status` + `/api/counter/status`
  (DB-free on the web beyond the session check).

---

## 7. Adding a screen

1. Its `mobile:*` permission in `permissions.ts` + `permissionCatalog.ts` (then
   `seed:sync-permissions`).
2. A row in `MOBILE_SCREENS` — that alone puts it on Home, in the side menu, and under
   "Mobile App" on the Role and Departments pages.
3. Its page under `src/app/m-staff-app/(app)` guarded by `mobileUser(permission)`, and its
   API under `src/app/api/mobile` guarded by `requirePermission(permission)`.

Nothing else lists screens.

---

## 8. Code layout

`src/modules/mobile` follows the other modules' layout:

- `components/` — the screens and shell (`MobileShell`, `MobileNav`, `MobileStock`, …) and
  `moneyFormPage`, the page factory for the Pay / Receive forms.
- `hooks/` — `useMobileList`, `useMobileResource`, `usePartyBalances`.
- `lib/` — `mobileScreens` (the screen list + `quickEntryFor`), `mobileAccess` (the page
  guard), `mobileCache` (saved answers), `booksUnchanged`, `partyBalances` / `partyBalance`,
  `moneyPlacement`, `types`.

Pages are in `src/app/m-staff-app`, APIs in `src/app/api/mobile`.

---

## 9. Known gaps

- The 512 px icon is upscaled from `build/icon.png`.
- The narrow rider / salesman permission is not built (§1).
- A `.apk` wrapper and a customer shop app are future work.
