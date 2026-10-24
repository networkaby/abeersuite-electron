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

**Two ways in.** A phone is never a counter, so sign-in (enforced in
`authorizeStaff.ts`) needs one of:

- **"Can login outside counter"** (`auth:login:outside-counter`) — a full session: the
  phone app, and the office website on a computer.
- **"Can use Mobile App"** (`mobile:app:access`, owner 2026-10-05: *"who i want can
  access mobile but not web"*) — a **phone-only** session. The token carries
  `phoneOnly: true`, and [`proxy.ts`](../src/proxy.ts) keeps it inside the app on any
  device: every other staff page redirects to the app's Home, and every API outside
  `PHONE_ONLY_APIS` ([`phoneOnly.ts`](../src/shared/lib/auth/phoneOnly.ts) — `/api/auth`,
  `/api/mobile`, `/api/accountancy/vouchers` for the quick entries, `/api/hr/activity`,
  `/api/counter/status`) answers 403. The API fence lives in the proxy, not the routes,
  because several routes read `auth()` directly; it decrypts the token (no DB read).
  Website only: the desktop app with no counter still refuses it, since a PC with no
  counter is there to be set up. A new phone API must be under `/api/mobile` or added
  to that list.
  Two office **catalogue reads** the device holds are open to a phone-only session only
  with a screen's tick — `PHONE_ONLY_CATALOGUE_APIS` / `phoneOnlyMayCall` in the same
  file, read off the token's own ticks: `/api/inventory/products/lookup` (Stock or
  Photos — it carries the till's purchase cost, so it must not open to every phone
  sign-in) and `/api/inventory/masters/sync` (Photos). Office sessions pass both on
  `requireAuth()` as before.

**Each screen has its own tick**, checked by the page ([`mobileAccess.ts`](../src/modules/mobile/lib/mobileAccess.ts),
`mobileUser(permission)`) and again by its API (`requirePermission(permission)`):

| Screen | Tick | API |
| --- | --- | --- |
| Stock & price | `mobile:stock:view` | `/api/mobile/stock/[id]` |
| Party | `mobile:parties:view` | `/api/mobile/parties`, `/parties/[accountId]`, `/parties/[accountId]/vouchers` |
| Receivables | `mobile:receivables:view` | `/api/mobile/outstanding/[side]` |
| Payables | `mobile:payables:view` | `/api/mobile/outstanding/[side]` |
| Day Book | `mobile:daybook:view` | `/api/mobile/daybook` |
| Voucher (opened from a party's Vouchers tab or the Day Book) | any party tick or `mobile:daybook:view` | `/api/mobile/vouchers/[id]` |
| Photos | `mobile:photos:edit` | `/api/mobile/photos/signature`, `/photos/product/[id]`, `/photos/master/[kind]/[id]` |
| Inbox | `mobile:inbox:view` | `/api/messages`, `/api/inbox`, `/api/users` |

- A party's bills open on any of the three party ticks (`PARTY_TICKS` /
  `PARTY_DETAIL_PERMISSIONS`), because receivables and payables open them too.
- **Quick Receive / Pay / Expense and the Pay / Receive forms use no tick of their
  own**: they need the office Payment / Receipt **create + post** ticks (read through
  the CRUD ladder, `hasPermissionWithScope` — a session carries only the highest
  rung) plus a party tick. That is [`quickEntryFor`](../src/modules/mobile/lib/mobileScreens.ts).
- The permission rows are in `permissionCatalog.ts` (module `mobile`) and
  `permissions.ts` (`MOBILE_*_VIEW`).
- **"Show suppliers (creditors)"** (`customers:view:creditors`, the office Global tick)
  hides the supplier side on the phone exactly as the office does (owner, 2026-10-03:
  "to protect purchase and supplier details"). Without it: no Sundry Creditors in the
  party list or Quick Pay; no **Payables** tile / tab / menu / page, and its API answers
  403 (`suppliers: true` on the screen row); a supplier's party screen, its APIs and the
  Pay / Receive form answer "not found" ([`supplierGuard`](../src/modules/mobile/lib/supplierGuard.ts));
  the Day Book drops purchase-side kinds (`SUPPLIER_SIDE_TYPES`, shared with SL Search)
  and any voucher whose party is a Sundry Creditor. One check, `seesSuppliers`
  ([`mobileScreens.ts`](../src/modules/mobile/lib/mobileScreens.ts)); one rule — the
  ledger group is **Sundry Creditors**.

### How admins give it out

- **Role page → "Sidebar links" → "Mobile App"** lists "Can use Mobile App" (the
  module's gate, first row) and then the five screens as ticks; "Can login outside
  counter" stays in the Global card. The section is built from `MOBILE_SCREENS` by `MOBILE_APP_MODULE` in
  [`sidebarModules.ts`](../src/shared/lib/auth/sidebarModules.ts); its links carry the
  screens' own `mobile:*` ids (flag `ownIds`, so `sidebarPermissionSeeds()` does not
  mint them a second time as `ui:sidebar:*`).
- **Departments page → pool chip "Mobile App"**, like any other module. It obeys the
  department pool: a role is offered the screens only if its department carries the
  chip (a tick a role already holds is always shown). Pooling one id pools all six
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
- Signed out, the app asks for the sign-in on its own page,
  [`login/page.tsx`](../src/app/m-staff-app/login/page.tsx) (`PHONE_APP_LOGIN`) — the
  staff sign-in form served inside the app's scope. `/staff/login` sits outside it, and an
  installed app leaving its scope makes Chrome draw an address bar with an ✕ on top.
  Forgot password has its twin, `m-staff-app/forgot-password` (`PHONE_APP_FORGOT`).
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
the app path only, so the office site and shop stay plain websites.

### Android APK (Capacitor, sideloaded, 2026-10-05)

Owner: *"i need full phone access like native app"* — so the first wrapper (a Bubblewrap
TWA, which is only Chrome and showed Chrome's address bar until the site vouched for it)
was replaced the same day by [`phone-app/`](../phone-app), a **Capacitor 8** app. Package
**`in.networkservice.staff`** (`PHONE_APP_ANDROID_PACKAGE` — permanent, a new id is a
different app), **same signing key**, `versionCode` 2 — so it installs over the TWA as
an update.

- **It loads the live site** (`server.url` in [`capacitor.config.json`](../phone-app/capacitor.config.json)
  = `office…/m-staff-app`) in its own WebView — no Chrome, no address bar, ever. **Every
  screen is still the website**: a Vercel deploy reaches phones with no new APK.
  Rebuild only when the native side changes (name, icon, a plugin, a permission), and
  bump `versionCode` in `phone-app/android/app/build.gradle` when you do.
- **Native features** come as Capacitor plugins added to `phone-app/package.json`; the
  web screens call them through `window.Capacitor` and must keep working in a plain
  browser (check `isNativePlatform()`). First batch not chosen yet.
- **Storage / delta sync:** Dexie, the saved answers and `?since=` all run unchanged —
  same origin, same code. The WebView keeps its own storage (not Chrome's), so moving
  from the TWA means **one fresh sign-in and one re-download** of the catalogues; there
  is no offline write queue on the phone (Receive / Pay / Expense post straight to the
  server), so nothing can be lost in the move. [`NativeAppReady`](../src/modules/mobile/components/NativeAppReady.tsx)
  (in [`m-staff-app/layout.tsx`](../src/app/m-staff-app/layout.tsx)) asks for persistent
  storage and hides the launch screen once the page is drawn.
- **Look:** launch screen and window are the app's page colour (light/dark,
  `values-night`), icons drawn from `public/m-icon-*.png` by
  [`make-icons.cjs`](../phone-app/make-icons.cjs); edge-to-edge with the existing
  `env(safe-area-inset-*)` padding (`SystemBars.insetsHandling: "css"`). No signal on
  launch → the bundled [`offline.html`](../phone-app/www/offline.html) with Try again.
  `tel:`, `wa.me`, `sms:` and other sites hand off to the phone's own apps. The user
  agent carries `NSStaffApp`.
- **Served from the site:** `public/ns-staff.apk` (`PHONE_APP_APK`) and
  `public/.well-known/assetlinks.json`; the app vouches back (`asset_statements`), so the
  install page's `getInstalledRelatedApps()` still sees it as installed. Both files carry
  an extension, so `proxy.ts` never asks for a sign-in.
- **In-app update (from 2.3.0, versionCode 6):** the bar's **Update now** downloads
  `ns-staff.apk?v=<code>` inside the app and opens Android's own Install screen —
  [`NsUpdatePlugin`](../phone-app/android/app/src/main/java/in/networkservice/staff/NsUpdatePlugin.java)
  (`REQUEST_INSTALL_PACKAGES`), called by
  [`AppUpdateBar`](../src/shared/components/AppUpdateBar.tsx). Only a `.apk` on the office
  site; refused before the Install screen unless it is this app and newer (so an APK
  not deployed yet cannot loop). First time, Android must allow the app to install
  apps: the plugin opens that switch and the person taps again. A failed download
  offers the Chrome page below. Builds before 2.3.0 have no updater and use the
  Chrome page. The customer app has the same plugin from 2.2.0 (versionCode 6,
  [`shop-app-native/…/NsUpdatePlugin.java`](../shop-app-native/android/app/src/main/java/in/networkservice/shop/NsUpdatePlugin.java),
  `ns-shop.apk` from the shop site) — keep the two files alike.
- **Update download (Chrome):** the "New version available" bar links to the install page,
  `https://office.networkservice.in./m-staff-app/install` — office only, never shop. The
  trailing dot makes Capacitor treat it as another host, so Chrome opens it (the app's
  WebView cannot download); the customer app does the same with
  `shop.networkservice.in./app`. Staff then tap **Download** there. It used to link the
  bare `.apk`, and Chrome left that download stuck (2026-10-24) while the install page's
  own button — the fresh-install path — always worked. The install page's download link
  carries `?v=<versionCode>`, so each release is a new address to Chrome.
  Deploy `d_office` with every new staff APK, or phones reinstall the old one in a loop.
- **Build:** `pwsh -File phone-app/build-apk.ps1` — `cap sync`, asks the key's passwords
  (owner types them; environment only, never written), Gradle `assembleRelease`, copies
  the APK to `public/` and writes `assetlinks.json` from the fingerprint **read off the
  signed APK**. Toolchain in `D:\AndroidTools` (JDK 21, Android SDK, Gradle cache).
  `phone-app/` is not in the pnpm workspace — `npm install` inside it.
- **Signing key:** `phone-app/ns-staff.keystore`, git-ignored. **Back it up off the PC** —
  lost key = no in-place updates ever again; leaked key = anyone can push an "update".
- Sideloaded only. Play Store would refuse SMS / call-log permissions if those are added.
- **Camera** (the Photos screen, §4) needs no plugin: a plain `<input type="file"
  capture="environment">` reaches the back camera through Capacitor's own
  `BridgeWebChromeClient.onShowFileChooser`, which writes the shot through the
  generated **FileProvider** — keep it in the manifest. Keep the
  `android.media.action.IMAGE_CAPTURE` entry in the manifest's `<queries>` too: Android
  11+ hides the camera app without it, and Capacitor then falls back to the gallery
  (seen on a Moto G45). **`CAMERA` is declared** for the
  barcode scan (Stock & price, Photos): Capacitor asks once at run time and one Allow
  covers both. A "Deny" blocks **both** scanning and Take photo until the permission is
  turned on in Android's app settings. The scan itself is web code — the browser's
  built-in `BarcodeDetector` over a `getUserMedia` back-camera stream — so the manifest
  line is the only native part; an APK built before it cannot scan.

Owner: *"i want the QR force install instead of just open the website"*. A phone never
lets a site install itself, so the Downloads QR is always `COMPANY_DETAILS.sites.office`
+ [`PHONE_APP_INSTALL`](../src/shared/lib/device/phone.ts) — the install page
[`install/page.tsx`](../src/app/m-staff-app/install/page.tsx), open **without** sign-in
(`isPublicPath`; the app's screens sit in the signed-in `(app)` route group so this page
is outside it). It shows only the app and
[`InstallAppButton`](../src/modules/mobile/components/InstallAppButton.tsx):

- Android → **"Download NS Staff"** (the APK) and three steps — open the file, allow
  *Install unknown apps* for Chrome, Install; Chrome's own install offer stays as a
  smaller second button;
- inside the Android app itself (`window.Capacitor`) → treated as installed;
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

**Barcode scan:** the search box's camera button
([`MobileBarcodeScan`](../src/modules/mobile/components/MobileBarcodeScan.tsx), turned on by
`MobileListScreen`'s `scan` prop) opens the back camera, reads one code with the browser's
built-in `BarcodeDetector` (EAN / UPC / Code-128 / Code-39 / ITF / QR — no library) and drops
it into the search box, so the same on-device search finds the product. The button is
hidden where the browser has no `BarcodeDetector` (iPhone Safari, desktop). Photos uses
the same button on its Product tab.

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
  company — the office Transactions tab's rule), POSTED only, newest first in the Day
  Book's order (date, real save time, id), 30 a page. Drafts and cancelled vouchers are
  left out (owner, 2026-10-03: the phone cannot edit or post them — the office Day Book
  still shows them), so there is no ✓ or status tag. Shows the date, the real
  save time only when there is one (imported rows carry midnight UTC → date alone; a
  back-dated save says "saved 19 Sept, 2:51 pm") and who saved it. The balance after each
  voucher is walked back from the party's balance now, the next page carried by
  `more: { cursor, balance }`. Same-day order follows entry order, as the office Account
  Ledger does, so a payment entered before its bill shows a brief "to receive". Asked on
  every open (`useMobileList` `freshMs: 0`, still `?since=`). A tap opens the voucher
  (see *Voucher* below).
- **Unpaid bills** — [`/api/mobile/parties/[accountId]`](../src/app/api/mobile/parties/[accountId]/route.ts):
  balance ([`partyBalances`](../src/modules/mobile/lib/partyBalances.ts), shared with the list)
  plus unpaid bills (`getLedgerOutstanding`, the Receivables engine), and the gap between
  them shown as "Not against any bill" — money on account moves the balance but settles no
  bill, so the two figures can differ.
- **Who this is** (owner, 2026-10-03: "same name many customer") — under the balance, and
  under each name on the party list: address / area, every phone number, linked company,
  and the group for anyone not a Sundry Debtor
  ([`partyFacts`](../src/modules/mobile/lib/partyFacts.ts)). Read from the on-device party
  catalogue (`usePartyList`), so it costs no server read and follows office edits through
  the catalogue's own `parties` realtime topic.
- **Call** — only a **Sundry Creditors** party's numbers are Call buttons (`tel:`, the
  phone's own dialler, the staff member's SIM); a customer's numbers show as plain text
  (owner, 2026-10-03: no calling customers from the phone app until calls can be logged —
  the PBX Call Log only sees the shop landline).

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
search passes through as the office `search`. Each row carries `uvId` (the office row's
`sortId`, the spine id); a tap opens the voucher.

### Voucher
Owner, 2026-10-05: *"i can see customer has a new sale today. but dont know what items"*.
[`/api/mobile/vouchers/[id]`](../src/app/api/mobile/vouchers/[id]/route.ts) +
[`MobileVoucherSheet`](../src/modules/mobile/components/MobileVoucherSheet.tsx), view only,
laid full-screen over the list it was tapped in. `useVoucherSheet` pushes `?voucher=<id>` onto
history, so the phone's Back closes it and the list keeps its state (the Day Book's day, the
party's loaded pages). Shows party, date / save time / who, narration, Draft / Cancelled;
**items** (name and line note via `readLineText`, qty × price per piece **with GST** =
amount ÷ qty — the stored rate is pre-GST, free qty); **services & charges** from
`settlementJson` (a service's net + its GST, a coupon as a negative row); the bill's
discount (off the GST-inclusive total), shipping, round off, total and "GST included"; and
**Paid** — the tender rows by ledger, or "on credit". A voucher with no trade detail
(Receipt / Payment / Journal / Contra) shows its ledger legs (Dr / Cr) instead. Without
"Show suppliers (creditors)" a purchase-side kind or a voucher touching a Sundry Creditor
answers 404. Saved per voucher on the phone, re-asked with `?since=`.

### Photos
Owner, 2026-10-05: update the images of products and masters for the shop *"from mobile
app / mobile camera"*. [`MobilePhotos`](../src/modules/mobile/components/MobilePhotos.tsx)
at `/m-staff-app/photos?kind=product|brand|group|category`: chips for the four kinds,
**No photo** on by default (with its count) so the list is the work still to do. Products
come from the catalogue on the device (`useProductCatalog`, whose rows carry `imageUrl`;
the till's search), brands / groups / categories from the lookup tables on the device
([`useShopMasters`](../src/modules/mobile/hooks/useShopMasters.ts) over `masterCatalog.ts`)
— **no request per search or tab**. The row last in `MOBILE_SCREENS`, so it never takes a
party screen's bottom tab.

- **Take photo** / **From gallery** ([`PhotoPickButtons`](../src/modules/mobile/components/PhotoPickButtons.tsx))
  — plain file inputs (§3 Camera). Each photo is shrunk in the browser
  ([`shrinkImage`](../src/shared/lib/browser/shrinkImage.ts): long side 1600 px, JPEG 0.85,
  EXIF-upright — a camera photo becomes a few hundred KB; a 3.3 MB worst-case noise image
  measured 821 KB), then uploaded to Cloudinary with
  a signature from [`/api/mobile/photos/signature`](../src/app/api/mobile/photos/signature/route.ts)
  into the office editors' own folders (`shop/products`, `shop/brands`, `shop/groups`,
  `shop/categories`; [`uploadShopPhoto`](../src/modules/mobile/lib/uploadShopPhoto.ts)).
- **Product** ([`MobileProductPhotos`](../src/modules/mobile/components/MobileProductPhotos.tsx)):
  the gallery in the shop card's frame, Main first; add (one at a time, each saved as it
  lands, failed ones keep a Retry that does not re-upload), **Make main**, **Remove** (tap
  twice). Up to `MAX_PRODUCT_PHOTOS` (12) from the phone. [`/api/mobile/photos/product/[id]`](../src/app/api/mobile/photos/product/[id]/route.ts)
  applies `{ add }` / `{ remove }` / `{ makeMain }` to the gallery **as saved now** (never
  the phone's stale copy) and writes through
  [`updateShopProduct`](../src/modules/ecommerce/lib/updateShopProduct.ts) — the office
  product page's own save — so a photo that makes the product shop-ready **lists it**, and
  removing the last photo unlists it (owner: same as office). The screen says so when the
  listing moves. Framing (Adjust) stays on the office page.
- **Brand / group / category** ([`MobileMasterPhoto`](../src/modules/mobile/components/MobileMasterPhoto.tsx)):
  one image, a new photo replaces it, Remove clears it —
  [`/api/mobile/photos/master/[kind]/[id]`](../src/app/api/mobile/photos/master/[kind]/[id]/route.ts)
  sets `imageUrl` only; name, slug and description stay on Ecommerce → Masters.
- Both APIs accept only links on our own Cloudinary cloud (`isOwnPhotoUrl`). A save
  announces `catalogue` (`topics.ts`), so office screens and tills pick it up.

### Inbox
Owner, 2026-10-09: WhatsApp conversations and customer chats available in the staff mobile app (`/m-staff-app/inbox`).
Guarded by `mobile:inbox:view` (plus `messages:reply` / `ui:sidebar:crm:messages`).
- **Responsive workspace:** Embeds [`MessagesWorkspace`](../src/modules/crm/components/MessagesWorkspace.tsx) inside [`MobileInbox`](../src/modules/mobile/components/MobileInbox.tsx).
- On mobile screen widths:
  - If no conversation/room is selected: displays the conversation list full-width with all search filters (All / Unread / Open ticket / Unknown / Team / Groups).
  - When a conversation or team room is selected: hides the list and displays the chat pane full-width with a `← Back` button in the header to return to the list.
- Reuses all CRM message features: Meta WhatsApp Cloud conversations, direct R2 media uploads / attachments, @mentions, claim/handover, and staff team rooms.
- Phone-only sessions: `PHONE_ONLY_APIS` permits `/api/messages`, `/api/inbox`, and `/api/users`.

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
  - untouched = every bill ticked, amount = their total — unless bills were ticked on the
    party screen's Unpaid bills tab (owner, 2026-10-03): the button then reads
    "Receive ₹110.00 (1 bill)" and carries them as `?bills=<universalVoucherId,…>`, so the
    form starts with only those ticked. A bill they owe rides on Receive, one we owe on Pay;
    a bill shows a tick box only when its side's button shows;
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
- **`ANSWER_SHAPE`** (in `mobileCache.ts`) is part of every saved answer's key. Bump it when
  a phone endpoint starts sending something a screen shows: `?since=` only says "the books
  have not moved", and each "unchanged" reply moves the saved copy's clock forward, so an
  old copy missing the new field would otherwise stand until someone posts a voucher —
  even ↻ sends `?since=`. 2 = party `phones` + vouchers without drafts; 3 = party `phones`
  dropped again (2026-10-03).
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
- `hooks/` — `useMobileList`, `useMobileResource`, `usePartyBalances`, `useShopMasters`.
- `lib/` — `mobileScreens` (the screen list + `quickEntryFor`), `mobileAccess` (the page
  guard), `mobileCache` (saved answers), `booksUnchanged`, `partyBalances` / `partyBalance`,
  `moneyPlacement`, `shopPhotos` (photo kinds + folders) / `uploadShopPhoto`, `types`.

Pages are in `src/app/m-staff-app`, APIs in `src/app/api/mobile`.

---

## 9. Known gaps

- The 512 px icon is upscaled from `build/icon.png`.
- The narrow rider / salesman permission is not built (§1).
- Play Store listing is future work; both APKs are sideloaded.
- **Customer app (`shop-app-native/`, Capacitor) offer:** on an Android/iPhone browser the shop + portal
  show a "Get our app" strip ([`GetAppBanner`](../src/modules/external/pwa/GetAppBanner.tsx));
  ✕ hides it for 14 days on that phone (localStorage). Android with `public/ns-shop.apk`
  present → APK download, and Chrome's own PWA install popup is held back (one offer, as
  Amazon/Flipkart do); APK not built yet, or iPhone → links to `/app`. `/app` and the staff
  install page offer the APK only after a HEAD finds it ([`installPlace.ts`](../src/modules/mobile/components/installPlace.ts)).
  Never shown inside the installed app or on a computer.
