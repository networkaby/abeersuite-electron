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
- `/office/pos/shifts` — shift report (manager/admin). Columns: counter, user, opening, declared, →vault, variance, status.
- `/office/pos/shifts/[id]` — shift audit page. Shows carry-over, vault top-up, handover chain, drops, linked Contras + variance JE.
- `/office/admin/counters` — POS counter management (admin). Create / rename / activate-deactivate / delete counters per branch. Auto-creates the till GL account under Cash-in-Hand.

### API routes

#### Counters
- `GET /api/pos/counters` — active counters in the active branch with current till balance. Consumed by `ShiftOpenDialog`.
- `GET /api/pos/counters?scope=all` — every counter in every branch (admin only). Consumed by `/office/admin/counters`.
- `POST /api/pos/counters` — create a counter. Body: `{ branchId, name }`. Auto-creates the till account `Cash – <name> – <branch>` under Cash-in-Hand. Requires `settings:manage`.
- `PATCH /api/pos/counters/[id]` — rename / toggle active. Renaming also renames the till GL account. Blocks deactivation if a shift is OPEN or AWAITING_HANDOVER on it. Requires `settings:manage`.
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
- `POST /api/pos/sale` — submit cart. Requires OPEN shift. CASH debits `shift.counter.tillAccountId`; non-CASH debits user-picked bank account.

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
- `PosCounter` (`prisma/schema/pos.prisma`) — physical billing station. Has `tillAccountId` (Account), `branchId`, `name`, `isActive`. Unique on `(branchId, name)`. (`defaultFloatPaise` was removed 2026-05-14 — operators decide opening float at shift-open time.)
- `PosShift` — cashier session. Links `userId`, `counterId`, `branchId`. Status: OPEN → AWAITING_HANDOVER → CLOSED. Carries `carryOverFloatPaise`, `vaultTopUpPaise`, `carryOverNextPaise`, `toVaultPaise`. Self-relation `handoverToShiftId` for audit chain.
- `PosCashDrop` — mid-shift log. No GL.
- `PosHandover` — two-step handover record. `fromShiftId`, `toUserId`, `toShiftId` (filled on accept). Status: PENDING → ACCEPTED / CANCELLED. Carries `declaredByAPaise`, `countedByBPaise`, `carryOverPaise`.
- `Branch.vaultAccountId` — per-branch vault; auto-created by bootstrap seed.

## Key components
- `PosScreen` (`src/modules/pos/components/PosScreen.tsx`) — full POS UI. On mount: checks `/current`, then `/pending-handover`. Shows `ActiveShiftBar` (OPEN), amber bar (AWAITING_HANDOVER), `HandoverAcceptDialog` (pending handover for B), or no-shift banner.
- `ActiveShiftBar` (`ActiveShiftBar.tsx`) — top strip. OPEN: shows sales/drops/drawer + Drop/Close buttons. AWAITING_HANDOVER: amber strip with Cancel Handover.
- `ShiftOpenDialog` (`ShiftOpenDialog.tsx`) — counter picker + carry-over balance + vault top-up input.
- `CashDropDialog` — mid-shift drop.
- `ShiftCloseDialog` (`ShiftCloseDialog.tsx`) — two tabs: **Close to vault** (carry-over field + to-vault preview) | **Hand to cashier** (cashier picker, GL posts only on acceptance).
- `HandoverAcceptDialog` (`HandoverAcceptDialog.tsx`) — shown to B. B counts cash, sees discrepancy vs A's declared, accepts to start their shift.

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
Three lookup tiers — all routed through the same `PosReturnDialog`:

| Tier | Who | Entry point |
|---|---|---|
| By invoice # | Cashier (`pos:shift:open`) | Types the invoice number |
| By customer | Cashier (`pos:shift:open`) | `PartySearchAndCreate` → `/api/pos/return/search?customerId=N` |
| Lost invoice | Manager (`pos:shift:manage`) | `PartySearchAndCreate` + free-form product lines + mandatory reason |

GL for all tiers:
- **CASH refund**: `Dr Sales Revenue / Cr Counter Till` — requires OPEN shift; cash leaves the till.
- **Credit note**: `Dr Sales Revenue / Cr Customer AR` — credit sits as advance until next sale draws it down.

Stock: `SALE_RETURN InvVoucher` + `InvStockLedger` IN row per product. `InvProductBranch.stock` + `InvProduct.stock` increment. `refVoucherId` links back to original SALE voucher (null for lost-invoice path).

Walk-ins (no customer account) are blocked on all tiers — `customerAccountId` is required.

**Schema additions for return tracing:**
- `Invoice.returnOfId Int?` — self-FK; credit note invoice → original sale invoice.
- `InvoiceLine.productId Int?` — stored by POS sale so the return can match stock.

## Reusable helpers — DO NOT duplicate

| Helper | File | Purpose |
|---|---|---|
| `postContra(tx, { date, narration, lines, userId })` | `src/modules/accountancy/lib/postContra.ts` | Atomic Contra voucher + JE + balance deltas. Used for vault top-up + vault sweep. |
| `postPosReceiptJe(tx, { invoiceId, ... })` | `src/modules/pos/lib/postPosReceiptJe.ts` | Settles AR on POS cash sales. |
| `computeExpectedCash`, `computeVariance`, `sumPaise` | `src/modules/pos/lib/shiftMath.ts` | BigInt paise arithmetic for shift close. |
| `PosReturnDialog` | `src/modules/pos/components/PosReturnDialog.tsx` | Three-tab sale return dialog (by invoice #, by customer, lost invoice). Mount inside `PosScreen`; pass `open`, `onOpenChange`, `onDone`. |

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

_Last updated: 2026-05-19 — `PosCounter.defaultFloatPaise` field removed (carry-over is per-shift, not per-counter); `POST /api/pos/shifts` documents crash-recovery `resumed: true` behaviour; thermal-relay removed in favour of direct ESC/POS (see accountancy.md)._
