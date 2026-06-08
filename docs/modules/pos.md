# POS (Point of Sale)

> Counter-side sale screen. Search a customer, build a cart of inventory items, take cash / card / cheque / bank-transfer / wallet payment, post the sale to the GL. POS is organised around **counters** (physical billing stations in a branch) and **shifts** (a cashier's session at one counter).

## Account structure

```
Cash-in-Hand
  ├── Cash – Counter 1 – Main Branch   ← POS counter till (per billing station)
  ├── Cash – Counter 1 – Online Branch ← POS counter till
  ├── Cash – Vault – Main Branch       ← branch vault (end-of-day surplus)
  └── Cash – Vault – Online Branch
```

Personal-user till accounts no longer exist. Tills belong to counters, not people. Shortage accountability is via the shift report, not the GL ledger.

## URLs

### UI pages
- `/vouchers/pos` — single-page POS register (standalone window, no office sidebar). File: `src/app/(protected)/vouchers/pos/page.tsx` + `src/modules/pos/components/PosScreen.tsx`.
- `/vouchers/pos/order` — **POS Order mode** (counter order: deliver-later / book-and-collect). Renders `PosQuoteScreen mode="order"`; `?id=` / `?voucherId=` reopens a New / Under-Review order in edit mode (board / register links). Saves via `POST /api/pos/order` → a `POS_ORDER` voucher (no GL, no stock). File: `src/app/(protected)/vouchers/pos/order/page.tsx`.
- `/vouchers/pos/estimate` — **POS Estimate mode**. Price-privacy quotation: lines printed at the barcode/tag (cap) price with all discounts stripped; captures a CRM Deal when a party is attached. Renders `PosQuoteScreen mode="estimate"`; `?id=` / `?voucherId=` reopens an estimate in edit mode. Saves via `POST /api/pos/estimate` → a `POS_ESTIMATE` voucher. File: `src/app/(protected)/vouchers/pos/estimate/page.tsx`. Order + Estimate now share ONE screen — `PosQuoteScreen` (`mode` prop) — DRY'd from the former separate `PosOrderScreen`/`PosEstimateScreen`. Both modes are reached via the `PosModeSwitch` (Sale / Order / Estimate) on the party bar.
- `/vouchers/pos/[id]` — POS Sale detail view (`InvVoucherDetail`).
- `/office/pos/shifts` — shift report (manager/admin). Columns: counter, user, opening, declared, →vault, variance, status.
- `/office/pos/shifts/[id]` — shift audit page. Shows carry-over, vault top-up, handover chain, drops, linked Contras + variance JE.
- `/office/admin/counters` — POS counter management (admin). Create / rename / activate-deactivate / delete counters per branch. Auto-creates the till GL account under Cash-in-Hand.

### API routes

#### Counters
- `GET /api/pos/counters` — active counters in the active branch with current till balance. Consumed by `ShiftOpenDialog`.
- `GET /api/pos/counters?scope=all` — every counter in every branch (admin only). Consumed by `/office/admin/counters`.
- `POST /api/pos/counters` — create a counter. Body: `{ branchId, name }`. Auto-creates the till account `Cash – <name> – <branch>` under Cash-in-Hand. Requires `settings:manage`.
- `PATCH /api/pos/counters/[id]` — rename / toggle active, set per-method ledger mappings + labels, and set **`upiVpa`** (the counter's UPI ID for the POS "Share payment link" QR — validated as `name@bank`, empty clears). Renaming also renames the till GL account. Blocks deactivation if a shift is OPEN or AWAITING_HANDOVER on it. Requires `settings:manage`.
- `DELETE /api/pos/counters/[id]` — delete a counter. Only allowed when (a) zero shifts ever used it and (b) till balance is zero. Till GL account is preserved for audit. Requires `settings:manage`.

#### Shifts
- `GET /api/pos/shifts/current` — current user's OPEN or AWAITING_HANDOVER shift in active branch, or null.
- `GET /api/pos/shifts` — list shifts (`?branchId=`, `?counterId=`, `?userId=`, `?status=`, `?from=`, `?to=`).
- `POST /api/pos/shifts` — open shift. Body: `{ counterId, vaultTopUpPaise, notes? }`. Posts Contra (Vault → Counter till) only for the top-up portion; carry-over stays. **Crash recovery**: if the same user already has an OPEN shift on the same counter (e.g. browser crashed mid-shift), the endpoint returns the existing shift with `{ resumed: true }` (HTTP 200) instead of 409. Same user + `AWAITING_HANDOVER` returns 409. Different user always returns 409 "Counter in use by another cashier".
- `GET /api/pos/shifts/[id]` — full detail.
- `POST /api/pos/shifts/[id]/drops` — mid-shift cash drop (log only, no GL).
- `PATCH /api/pos/shifts/[id]/close` — close shift to vault. Body: `{ declaredCashPaise, carryOverNextPaise?, notes? }`. Posts variance JE + Contra (Counter → Vault) for surplus only.

#### Handover (two-step cashier-to-cashier)
- `POST /api/pos/shifts/[id]/handover` — A initiates. Body: `{ toUserId, declaredCashPaise, carryOverPaise?, notes? }`. Shift → AWAITING_HANDOVER. **No GL yet.**
- `DELETE /api/pos/shifts/[id]/handover` — A (or manager) cancels. Shift → OPEN.
- `GET /api/pos/shifts/pending-handover` — B checks for a PENDING handover addressed to them.
- `GET /api/pos/shifts/handover-candidates?counterId=` — eligible cashiers B can be (no active shift, has pos:shift:open).
- `POST /api/pos/handovers/[id]/accept` — B accepts. Body: `{ countedByBPaise, notes? }`. One transaction: variance JE + Contra + close A's shift + open B's shift.

#### Sale
- `POST /api/pos/sale` — submit cart. Requires OPEN shift. CASH debits `shift.counter.tillAccountId`; each non-CASH method debits its **per-counter mapped ledger** (`counter.upiAccountId` / `cardAccountId` / `walletAccountId` / `chequeAccountId` / `bankTransferAccountId`). Returns 422 `PAYMENT_METHOD_NOT_MAPPED` if the cashier submits a method that's null on this counter — the dialog hides unmapped methods so this is a guardrail. The client no longer sends `accountId` on payment lines; the server is the sole router. Also accepts optional `couponCode`, `autoApply`, and `giftCardCode` (see *Coupons & gift cards at POS*).

#### Coupons & gift cards (validate before the sale)
- `POST /api/pos/coupon-validate` — preview a coupon for the current cart (code entry or best AUTO offer). Runs the same engine as `/sale` so the client total matches the posted total. Returns `{ ok, couponId, code, name, discountRupees, droppedTier, blockedLoyalty, clampedByGuard }` or a reject reason. Requires `pos:shift:open`.
- `POST /api/pos/gift-card-lookup` — check a gift-card code for the redeem box. Body `{ code }` → `{ ok, id, code, balance }` or `{ ok:false, reason }` (not found / not active / **disabled** / expired / no balance). Requires `pos:shift:open`.

#### Order & Estimate — POS quotes (Order-to-Cash)
Both ride one shared creator, `createPosQuoteVoucher` (`src/modules/pos/lib/posQuoteVoucher.ts`) — **non-posting** vouchers (no stock, no GL; `journalEntryId` stays null), saved as `POSTED` (= issued). Reuses `invNextRef` + `calcLineTotals` / `calcVoucherTotals`. Gated by `accountancy:view:org` (a cashier needs no `deals:manage`). When a party is attached it **captures a Deal** (`findOpenDealForParty` reuses the party's most-recent non-terminal Deal, else creates one; SYSTEM `DealActivity` stamped; `InvVoucher.dealId` ↔ `Deal.vouchers` soft-link). Anonymous = quote only, no Deal. Tx runs with `{ timeout: 30_000, maxWait: 10_000 }`.
- `POST /api/pos/estimate` — creates a `POS_ESTIMATE` voucher. Lines printed at the **barcode/tag price** with discounts stripped (price privacy). Returns `{ voucherId, reference, dealId }`.
- `POST /api/pos/order` — creates a `POS_ORDER` voucher (counter order — deliver-later / book-and-collect). The order **locks the full sale total**: it sends the full bill discount (tier + loyalty + coupon) + shipping + round-off through the same `calcVoucherTotals` the POS sale uses, so the saved total equals the sale it will become; redemption details are recorded in the notes (actual point-burn / stock reservation is a later phase). An optional advance is posted as a **separate Receipt voucher** on the customer's account. Body also accepts `shippingAmt` / `roundOff`.

#### Sale Return
- `GET /api/pos/return/search` — two modes: `?q=INV-…` (substring match on invoice number) or `?customerId=N` (all PAID, non-return invoices for that account). Returns `FoundInvoice[]`. Requires `pos:shift:open`.
- `POST /api/pos/return` — standard return. Body: `{ originalInvoiceId, lines: [{invoiceLineId, qty}], refundMode: "CASH"|"CREDIT", notes? }`. Creates negative Invoice with `returnOfId` set, posts JE, creates `SALE_RETURN InvVoucher`, restores stock. Requires `pos:shift:open`.
- `POST /api/pos/return/lost` — manager-only lost-invoice return. Body: `{ customerAccountId, lines: [{productId, qty, unitPrice, taxRate}], refundMode, reason (min 5 chars) }`. Same GL + stock as normal return; `returnOfId = null`; `refVoucherId = null`. Requires `pos:shift:manage`.

## Permissions
- `pos:shift:open` — open a shift at a counter (R3 Front Desk, R4 Despatch).
- `pos:shift:close` — close own shift / initiate handover.
- `pos:shift:drop` — log mid-shift cash drops.
- `pos:shift:view:branch` — see all shifts in user's branches.
- `pos:shift:view:org` — see shifts across all branches.
- `pos:shift:manage` — force-close, cancel handover, override variance, close another user's shift.

## Prisma models
- `PosCounter` (`prisma/schema/pos.prisma`) — physical billing station. Has `tillAccountId` (CASH till, auto-created), `branchId`, `name`, `isActive`, plus **5 nullable per-method routing columns** (added 2026-05-24): `upiAccountId`, `cardAccountId`, `walletAccountId`, `chequeAccountId`, `bankTransferAccountId`, each with a sibling **optional label** column (`upiLabel`, `cardLabel`, …) that overrides the built-in display name in the POS checkout dialog (e.g. "PhonePe UPI" instead of "UPI"). Null id = method not accepted at this counter (hidden in checkout dialog). Also carries **`upiVpa`** (nullable, added 2026-06-09) — this counter's UPI ID (`name@bank`) that drives the POS "Share payment link" QR + WhatsApp link; distinct from `upiAccountId` (where a UPI receipt is *booked*) — `upiVpa` is what the customer actually *pays into*. Null/empty = no UPI ID set → the share dialog shows a "configure" hint instead of a link. Operator maps each one under `/office/admin/counters`; multiple counters may point at the same Account (shared settlement) or unique ones (per-terminal). Unique on `(branchId, name)`. (`defaultFloatPaise` was removed 2026-05-14 — operators decide opening float at shift-open time.)
- `PosShift` — cashier session. Links `userId`, `counterId`, `branchId`. Status: OPEN → AWAITING_HANDOVER → CLOSED. Carries `carryOverFloatPaise`, `vaultTopUpPaise`, `carryOverNextPaise`, `toVaultPaise`. Self-relation `handoverToShiftId` for audit chain.
- `PosCashDrop` — mid-shift log. No GL.
- `PosHandover` — two-step handover record. `fromShiftId`, `toUserId`, `toShiftId` (filled on accept). Status: PENDING → ACCEPTED / CANCELLED. Carries `declaredByAPaise`, `countedByBPaise`, `carryOverPaise`.
- `Branch.vaultAccountId` — per-branch vault; auto-created by bootstrap seed.

## Key components
- `PosScreen` (`src/modules/pos/components/PosScreen.tsx`) — full POS UI. On mount: checks `/current`, then `/pending-handover`. Shows `ActiveShiftBar` (OPEN), amber bar (AWAITING_HANDOVER), `HandoverAcceptDialog` (pending handover for B), or no-shift banner.
- `PosModeSwitch` (`PosModeSwitch.tsx`) — colour-coded Sale / Order / Estimate buttons on the party bar. Sale → `/vouchers/pos/new`, Order → `/vouchers/pos/order`, Estimate → `/vouchers/pos/estimate` (all three modes live). Rendered in both `PosScreen` and `PosQuoteScreen`.
- `PosQuoteScreen` (`PosQuoteScreen.tsx`) — the unified Order **and** Estimate UI (`mode="order" | "estimate"`, optional `editId`), DRY'd from the former separate `PosOrderScreen`/`PosEstimateScreen` so the POS Sale voucher stays untouched. Per-mode tint, optional party picker, product search, a cart, and Save (+ optional advance / print) → `POST /api/pos/order` or `/estimate`.
- `ActiveShiftBar` (`ActiveShiftBar.tsx`) — top strip. OPEN: shows sales/drops/drawer + Drop/Close buttons. AWAITING_HANDOVER: amber strip with Cancel Handover.
- `ShiftOpenDialog` (`ShiftOpenDialog.tsx`) — counter picker + carry-over balance + vault top-up input.
- `CashDropDialog` — mid-shift drop.
- `ShiftCloseDialog` (`ShiftCloseDialog.tsx`) — two tabs: **Close to vault** (carry-over field + to-vault preview) | **Hand to cashier** (cashier picker, GL posts only on acceptance).
- `HandoverAcceptDialog` (`HandoverAcceptDialog.tsx`) — shown to B. B counts cash, sees discrepancy vs A's declared, accepts to start their shift.
- `PaymentLinkDialog` (`PaymentLinkDialog.tsx`) — "Share payment link" panel opened from a payment method's inline **Share** button (UPI row today) — `lockedProviderId` locks it to that rail and hides the picker. Builds a `upi://pay` link + scannable QR (via the `qrcode` lib) for an editable amount (defaults to the On-Credit balance) from the active counter's `upiVpa`, and pre-builds a canvas-composed "Scan to Pay" PNG card. **WhatsApp** uses a **hybrid** send (targets the customer's number AND sends the image): copies the QR PNG to the clipboard and opens `web.whatsapp.com/send?phone=<customer>` with the amount + link as caption → the cashier pastes (Ctrl+V) the QR and sends. Falls back to the native Web-Share sheet (phones) then download. Provider-registry shape (`paymentLink.ts` → `PAYMENT_LINK_PROVIDERS`) so other rails (e.g. a hosted Razorpay link) can be added later. See *Share payment link* below.

## Common workflows

### Counter float lifecycle (daily)
```
Day start:
  Manager draws ₹2,000 from vault OR counter already has ₹2,000 carry-over
  → Cashier A opens shift at Counter 1 (top-up Contra posted only if > 0)
  → A bills through the day (Dr Counter 1 / Cr Revenue on each cash sale)

End of day (A closes to vault):
  A declares ₹15,000 physical
  A enters carry-over ₹2,000 (kept in counter overnight)
  → Variance JE if expected ≠ declared
  → Contra: Counter 1 → Vault ₹13,000
  Counter 1 overnight balance: ₹2,000 ✓

Next morning:
  Counter 1 already has ₹2,000 — no Contra needed to open
```

### Two-step cashier handover (A 9am–12:30pm, B 12:30pm–7pm)
```
12:30pm — A:
  Opens ShiftCloseDialog → "Hand to cashier" tab
  Declares ₹8,500, picks B, sets carry-over ₹2,000
  Clicks "Request handover"
  → PosHandover created (PENDING), shift → AWAITING_HANDOVER
  → No GL yet. ActiveShiftBar shows amber "Awaiting B"
  A logs out.

B logs in → PosScreen:
  GET /current → null (A's shift is AWAITING, B has no shift)
  GET /pending-handover → found (PosHandover addressed to B)
  → HandoverAcceptDialog shows: "A declared ₹8,500 · carry-over ₹2,000"
  B counts: ₹8,450
  B clicks "Accept & start shift"

Server (one transaction):
  Till discrepancy = 8,500 (expected/declared) − 8,450 (B counted) = 50
  Variance JE: Dr Cash Short ₹50 / Cr Counter 1 ₹50
  toVault = 8,450 − 2,000 = 6,450
  Contra: Counter 1 → Vault ₹6,450
  A's shift → CLOSED, B's shift → OPEN (openingFloat = 8,450)

B sees ActiveShiftBar: "Shift #43 · Counter 1 · ₹8,450"
B bills 12:30pm–7pm...
```

### Shortage accountability
GL entry: Dr Cash Short / Cr Counter 1 (counter's account, not personal).
Accountability: `/office/pos/shifts` shows variance on A's shift row — who was on when, at which counter.

### Sale return flow
Two lookup tiers — both routed through the same `PosReturnDialog`:

| Tier | Who | Entry point |
|---|---|---|
| By invoice # | Cashier (`pos:shift:open`) | Types the invoice number |
| By customer | Cashier (`pos:shift:open`) | `PartySearchAndCreate` → `/api/pos/return/search?customerId=N` |

The manager-only **lost-invoice** tier (`POST /api/pos/return/lost`) is no longer surfaced in the dialog UI (removed 2026-06-01) — the endpoint still exists for programmatic/API use but has no UI entry point.

GL for all tiers:
- **CASH refund**: `Dr Sales Revenue / Cr Counter Till` — requires OPEN shift; cash leaves the till.
- **Credit note**: `Dr Sales Revenue / Cr Customer AR` — credit sits as advance until next sale draws it down.

Implementation: SALE_RETURN `InvVoucher` carries one tender row pointing at the refund account — till for CASH refund (money leaves the drawer), customer AR for CREDIT note (sits as customer credit). `postInvVoucherToGl` handles the SALE_RETURN direction: body Dr Sales Returns + Dr GST reversal, counter Cr <tender>. `refVoucherId` links back to the original SALE voucher (null for the lost-invoice path).

Stock: `InvStockLedger` IN row per product. `InvProductBranch.stock` + `InvProduct.stock` increment.

Walk-ins (no customer account) are blocked on all tiers — `customerAccountId` is required.

## POS sale shape (Layer 7g, 2026-05-24)

POS sale = a single `InvVoucher type=POS` with one `InvVoucherTender` row per tender (Cash + UPI + Card + Customer AR for any unsettled balance). Posts ONE balanced JE per voucher — no separate Receipt voucher, no `VoucherAllocation`. Same shape as office SALE.

`postInvVoucherToGl` reads `voucher.tenders[]` directly: one Dr leg per tender, plus Cr Sales / GST / (optional Cr Shipping Income) / (optional Dr Discount Allowed for voucher-level discount). Today the POS form enforces `Σ tenders == totalAmount` (no partial), so the AR-tender row is only created when a hypothetical credit POS sale leaves a balance.

## Coupons & gift cards at POS

Both ride the existing `postInvVoucherToGl` bridge untouched — one as a charge, one as a tender.

- **Coupon** = a server-resolved ₹ value posted as a **negative `InvVoucherCharge`** to the dedicated **"Coupon Discounts"** ledger (mirrors loyalty redemption; kept separate from "Discount Allowed"). The amount is clamped to `goodsValue − 0.01` so the bill total never hits ≤ 0 (the bridge skips GL at total ≤ 0). A **non-stackable** coupon zeroes the spend-tier discount and **blocks loyalty redemption** — `/sale` returns 422 `COUPON_BLOCKS_LOYALTY` if points are also sent. A global `CouponConfig.maxTotalDiscountPct` guard clamps coupon + tier + loyalty combined. `finalizeCouponAmount` is shared by `/sale` and `/coupon-validate` so client and server totals agree.
- **Gift card** = a **payment tender**, not a discount. The server looks up the card, draws `min(balance, total)`, and appends a tender to the **"Gift Card Liability"** ledger (Dr Liability — bypasses the per-counter method map). Its amount is added to `paymentTotal` so `Σ payments + gift-card == total`. A card must be **ACTIVE and enabled** to redeem — `/sale` returns 422 `GIFT_CARD_REJECTED` for not-found / DRAFT / disabled / expired / zero-balance cards. In-tx the balance is decremented and a `REDEEM` `GiftCardTxn` written. (See the coupons/gift-cards module for the full lifecycle: generate → issue → redeem → expire-breakage.)

## Customer "Today's discount" price ladder

Customer-facing bills present a price **ladder** that hides the per-item real selling price: per line we show **MRP + barcode (tag)**, and every reduction is pooled into **"Today's discount"** (price-benefit = barcode→effective, tier, loyalty, coupon), with a **"You saved ₹X (Y%)"** hero and a net-of-discount **HSN/rate-wise** tax summary. With 2+ items the real per-item price isn't recoverable.

- **Computed view, not stored.** `src/modules/pos/lib/priceLadder.ts` → `computePriceLadder(input, labels?)` derives the whole ladder from the real voucher. Nothing obfuscated is persisted; edits/returns just re-compute. Bill arithmetic reconciles: `grossAtTag − todaysDiscountTotal = paid`, and `Σ HSN taxable + Σ tax = paid` (the bill discount is distributed proportionally per line at each line's own GST rate).
- **Snapshots (the only inputs not derivable from the voucher).** POS sale lines persist `mrpPaise` + `InvVoucherLine.savedSalePricePaise` (barcode) at sale time (`/api/pos/sale` + `PosScreen`) — product prices drift, so we snapshot rather than re-read.
- **Receipt render.** `src/app/receipt/invoice/[id]/page.tsx` builds the ladder (reads line snapshots + `voucher.discountAmt` for tier + classifies loyalty/coupon `InvVoucherCharge` rows by `LoyaltyConfig.redeemExpenseAccountId` / `CouponConfig.couponExpenseAccountId`). `A4InvoicePreview` = **C** density (per-line struck MRP + itemized + savings); `ThermalReceiptPreview` = **B** density (pooled block + savings hero, no per-line struck price). HSN summary is gated by `template.showTaxSummary` (toggle). B2B buyer GSTIN prints when present.

### Display & receipt relays — payload contract (external)

The customer QR display (`localhost:9192`, `src/modules/pos/lib/qrDisplay.ts`) and the thermal printer (`localhost:9191/print/pos`) are **external processes** — the relay source lives at `tools/thermal-relay/relay.js` (a separate git repo), not under this app. They render whatever the POS client sends. The ladder fields below are **additive**: old relays ignore them; rendering the ladder requires updating the relay.

- `qrDisplay.cart(...)` payload gained: per-item `mrp?` / `barcode?` (per-unit, ₹ tax-inclusive), `discounts?: { label, amount }[]` (the Today's-discount rows), and `savings?: { amount, pct }`.
- `POST localhost:9191/print/pos` body gained: per-line `mrp` / `barcode`, `customerGstin`, `grossAtTag`, `discounts: { label, amount }[]`, `savings: { amount, pct } | null`, `hsnSummary` (the net HSN/rate rows), and **`template`** — the resolved POS `VoucherPrintTemplate` (header/address/GSTIN/phone, the `show*` toggles, `termsText`, `footerLine`, signature, `paperWidthMm`). `/api/pos/sale` returns it as `posTemplate` (the cashier lacks `settings:manage`, so the client can't fetch it) and PosScreen forwards it.

**Relay rendering (`buildPosBuffer`).** The thermal slip now mirrors `/receipt/invoice/[id]?kind=POS`: template-driven header/address/toggles/terms/footer, and when ladder fields are present it prints the **tag (barcode) line total + struck MRP** (hiding the real per-item price) → Gross → discount rows → GST (gated by `showTaxSummary`) → Total → "You saved". Falls back to the legacy Subtotal/Tax/Total layout when no ladder/template is sent. ESC/POS limits remain: monospace hardware font (template `fontFamily`/`fontSizePx` not honored) and the logo is not rastered. Payments (Cash/UPI/Change) are POS-only — the on-screen receipt has no tender data.

## Share payment link (UPI QR + WhatsApp)

Share is **contextual to the payment method**: each shareable method has its own inline **Share** button. Today the **UPI row** in the checkout dialog has a **Share** button (the gateway/Card link button follows when Cashfree lands — same pattern). It opens `PaymentLinkDialog` **locked to that rail** (`lockedProviderId` → the provider picker is hidden). For UPI it builds a `upi://pay?pa=<vpa>&pn=<payee>&am=<amount>&cu=INR&tn=<note>` deep link from the **active counter's `upiVpa`** (set in `/office/admin/counters`), renders a scannable QR, and pre-builds a canvas-composed "Scan to Pay ₹X" PNG card. The amount is editable and defaults to the **On-Credit** balance (else the full total). Two actions:

- **WhatsApp** — a **hybrid** that both targets the customer's number *and* sends the QR image (you can't do both in one WhatsApp API call, so it does this): copies the QR PNG to the clipboard **and** opens `web.whatsapp.com/send?phone=<customer>&text=<message>` → the customer's chat opens with the message prefilled and the cashier pastes the QR (Ctrl+V) and hits Send. The message carries the **plain UPI ID (VPA)** + a "scan the QR" nudge (the QR encodes the amount). On phones without clipboard-image support it falls back to the native Web-Share sheet (`navigator.share({ files })` — sends the photo, cashier picks the chat), then to a download. `partyPhone` is normalised to a WhatsApp number (bare 10-digit Indian mobile → +91); no phone on file → blank WhatsApp compose.
- **Copy UPI ID** — copies the plain VPA (e.g. `networkservice@okhdfcbank`).

Implementation notes:
- The share image is **pre-built reactively** (on amount/link change) so the WhatsApp click calls `clipboard.write()` / `window.open()` **synchronously** — doing the async QR+canvas work inside the click would drop the user-gesture activation and the browser would refuse the copy/share.
- Pure builders live in `src/modules/pos/lib/paymentLink.ts` (`PAYMENT_LINK_PROVIDERS`, `upiProvider`, `cashfreeProvider`, `paymentLinkMessage`) — a **provider registry**. The UPI rail works today; **`cashfreeProvider`** is a disabled "coming soon" stub for a hosted gateway link (card / netbanking / UPI via Cashfree) — once its backend + keys exist, its `build()` returns the Cashfree payment-page URL and the message carries that https link (via `paymentLinkMessage`'s `payTo`) instead of the VPA. The QR-card rasterisation is dependency-free canvas in `PaymentLinkDialog`.
- The VPA is **per-counter** (`PosCounter.upiVpa`); the payee *name* is company-level (`COMPANY_DETAILS.upi.payeeName`). With no VPA set, the dialog shows a "configure UPI ID" hint and disables sharing instead of rendering a broken QR.
- Pure addition — `/api/pos/sale`, GL, and the existing Confirm flow are untouched. Reconciling the remote payment back onto the voucher is still manual (a later phase).

## Reusable helpers — DO NOT duplicate

| Helper | File | Purpose |
|---|---|---|
| `postContra(tx, { date, narration, lines, userId })` | `src/modules/accountancy/lib/postContra.ts` | Atomic Contra voucher + JE + balance deltas. Used for vault top-up + vault sweep. |
| `postInvVoucherToGl(tx, { voucherId, voucher, userId })` | `src/modules/accountancy/lib/postInvVoucher.ts` | Single GL bridge for every trading voucher (SALE / POS / PURCHASE / SALE_RETURN / PURCHASE_RETURN). Reads `voucher.tenders[]` + `voucher.charges[]`. |
| `computeExpectedCash`, `computeVariance`, `sumPaise`, `sumShiftCashSalesPaise` | `src/modules/pos/lib/shiftMath.ts` | BigInt paise arithmetic for shift close. `sumShiftCashSalesPaise` sums BOTH POS tender rows on the till AND office RECEIPT voucher lines in the shift window. |
| `PosReturnDialog` | `src/modules/pos/components/PosReturnDialog.tsx` | Two-tab sale return dialog (by invoice #, by customer). Mount inside `PosScreen`; pass `open`, `onOpenChange`, `onDone`. |

## Seeds
- **Bootstrap** (`bootstrap-seed.ts`) — creates `Cash – Vault – <Branch>` + `Cash – Counter 1 – <Branch>` accounts and one `PosCounter` row per branch. Default float ₹2,000.
- **Dummy users** (`dummy-users.ts`) — no longer creates till accounts (personal tills dropped). Just creates demo users.
- **Hard-clean** (`hard-clean.ts`) — `pos_handovers`, `pos_cash_drops`, `pos_shifts` in `TRANSACTION_TABLES`. `pos_counters` is bootstrap data — preserved.

## Gotchas / decisions
- **Counter till, not user till** — the GL till account belongs to the physical counter. Any cashier can work it. Variance on the GL hits the counter account; human accountability is via the shift report.
- **No Contra on same-counter handover** — cash never leaves the counter till account when A→B at the same counter. Contra only moves cash to/from vault.
- **Carry-over float** — `carryOverNextPaise` at close = amount left in counter overnight. `toVaultPaise = declared − carryOverNext`. Opening next shift reads the till balance directly (already non-zero).
- **Variance is always against the counter till** — Dr Cash Short / Cr Counter (or Dr Counter / Cr Cash Over). Personal payroll deductions are handled by management outside the books.
- **AWAITING_HANDOVER blocks billing** — POS sale requires `status: "OPEN"` shift. Cashier in AWAITING_HANDOVER state cannot bill.
- **B must be logged in as themselves** — accept endpoint checks `session.user.id === handover.toUserId`. A cannot accept their own handover (→ 403).
- **One active shift per counter** — `POST /api/pos/shifts` returns 409 if counter already has OPEN or AWAITING_HANDOVER.
- **Variance ledgers** — `Cash Short` (6950) and `Cash Over` (4950) seeded by bootstrap. If missing, close API returns 500.

## Out of scope / deferred
- Per-row bank account picker for UPI/Card (currently all non-CASH auto-routes to first Bank account).
- Two-step manager handover with AWAITING_HANDOVER from staff to manager (current handover is cashier-to-cashier).
- Stuck-shift auto-close cron.
- Per-shift Z-report print.
- Float carry-over by counter default already implemented; manager override per-close already supported.
- Return receipt print page (`/receipt/return/[id]`).
- Multiple partial-return guard: currently caps per-line at original qty but does not subtract qty already returned in prior return invoices.
- Exchange as one atomic transaction (currently: issue credit note, then start new sale that draws down the advance).

_Last updated: 2026-05-24 — **Per-counter custom payment-method labels.** Added 5 sibling `*Label String?` columns on `PosCounter` (`upiLabel` / `cardLabel` / etc.); operator can rename each accepted method per counter (e.g. "PhonePe UPI" → Razorpay A/c). Empty = use built-in label. Surfaced in `/office/admin/counters` edit form (label input next to each account picker), the read-only badge summary, and the POS checkout dialog (fixed UPI row + extras dropdown options). Earlier today: **Per-counter payment-method ledger mapping.** `PosCounter` gained 5 nullable columns (`upi/card/wallet/cheque/bankTransfer AccountId`) so each counter decides which non-cash methods it accepts and which GL ledger each one settles to. `/office/admin/counters` edit form gained a "Payment options accepted at this counter" section with one `GlAccountCombobox` per method (inline ledger create supported). POS checkout dialog now hides any method that's not mapped; client no longer sends `accountId` on payment lines; `POST /api/pos/sale` is the sole router (422 `PAYMENT_METHOD_NOT_MAPPED` for unmapped methods). The legacy `defaultBankAccountId` fallback in PosScreen is gone. `/api/pos/shifts/current` payload extended with `counter.{upi,card,wallet,cheque,bankTransfer}Account` so the checkout dialog can read them on shift load. Previously today: POS sale collapsed to a single InvVoucher (type=POS) carrying its own tender rows; the separate Receipt voucher + VoucherAllocation detour is gone. `postPosReceiptJe` helper deleted; all GL posting now goes through `postInvVoucherToGl`. Same Day Book shape per sale (Sale row + per-tender Dr lines on the same JE), but one fewer voucher per cash POS. Sale-return refund target moved from `paymentMode`/`paymentAccountId` columns onto a `InvVoucherTender` row whose accountId is till (CASH) or customer AR (CREDIT)._

_Last updated: 2026-06-01 — **Removed the lost-invoice tab from `PosReturnDialog`.** The manager-only "Lost invoice" return mode is no longer shown in the dialog (now a two-tab dialog: by invoice #, by customer). The backend `POST /api/pos/return/lost` endpoint is unchanged and still posts the same SALE_RETURN GL/stock — it simply has no UI entry point anymore._

_Last updated: 2026-06-02 — **Documented coupons & gift cards at POS.** `POST /api/pos/sale` accepts `couponCode` / `autoApply` / `giftCardCode`; added `POST /api/pos/coupon-validate` (cart preview, same engine as /sale) and `POST /api/pos/gift-card-lookup`. A coupon posts as a negative charge to "Coupon Discounts" (clamped below the bill; non-stackable → tier=0 + 422 `COUPON_BLOCKS_LOYALTY`; global `maxTotalDiscountPct` guard). A gift card redeems as a tender drawing down "Gift Card Liability" (min(balance,total); must be ACTIVE + enabled, else 422 `GIFT_CARD_REJECTED`)._

_Last updated: 2026-06-02 — **Customer "Today's discount" price ladder.** New `priceLadder.ts` helper drives a computed, per-item-price-hiding ladder (MRP + barcode per line → pooled "Today's discount" → "You saved" hero → net HSN summary) on the receipt (A4 `C` / thermal `B`) and the QR + thermal-relay payloads (additive — relays must render). POS sale lines now snapshot `mrpPaise` + new `InvVoucherLine.savedSalePricePaise`. Display-only; accounting math unchanged. See the two new sections above._

_Last updated: 2026-06-07 — **POS Estimate mode (Order-to-Cash Phase 1).** POS is now mode-first via `PosModeSwitch` (Sale / Order / Estimate) on the party bar. New `/vouchers/pos/estimate` page (`PosEstimateScreen`) prints the barcode/tag price with discounts stripped (price privacy) and, via `POST /api/pos/estimate`, creates an `ESTIMATE` InvVoucher (no stock/GL) that captures a CRM Deal (find-or-create the party's open deal through new `findOpenDealForParty`, SYSTEM activity, soft-link `InvVoucher.dealId` ↔ `Deal.vouchers`). Anonymous = quote only. The existing POS Sale screen is untouched except for the additive mode switch in its header. Order mode button is disabled (Phase 3). Spec: `docs/srs/order-to-cash.md`._

_Last updated: 2026-06-09 — **Per-counter UPI ID + "Share payment link" at checkout, and Order/Estimate unified.** (1) New `PaymentLinkDialog` ("Payment link" button in checkout) builds a UPI `upi://pay` QR for an editable amount from the **active counter's new `PosCounter.upiVpa`** column, and **sends it on WhatsApp** via a hybrid that targets the customer's number (`web.whatsapp.com/send?phone=…`) AND copies the QR image to paste in (Ctrl+V), with native Web-Share / download fallbacks (set in `/office/admin/counters`); provider-registry in `paymentLink.ts` for future rails. Additive — sale/GL untouched. (2) Order + Estimate were DRY'd from the former separate `PosOrderScreen`/`PosEstimateScreen` into one `PosQuoteScreen` (`mode` prop, `editId` for edit mode); both ride the shared `createPosQuoteVoucher` (`posQuoteVoucher.ts`) → non-posting `POS_ORDER` / `POS_ESTIMATE` vouchers via `/api/pos/order` + `/api/pos/estimate`; Order mode is live (no longer "Phase 3 disabled"), with the order locking the full sale total (tier + loyalty + coupon + shipping + round-off). NOTE: the wider O2C work shipped alongside (Orders board, credit gates G1/G3/G4a, pipeline unification P7) is documented in the orders/CRM module docs, not here._
