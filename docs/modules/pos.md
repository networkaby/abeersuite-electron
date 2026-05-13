# POS (Point of Sale)

> Counter-side sale screen. Search a customer, build a cart of inventory items, take cash / card / cheque / bank-transfer / wallet payment, post the sale to the GL. As of 2026-05-14 the POS runs inside a **shift** lifecycle: each cashier opens a till session with a cash float, bills throughout, drops cash to safe mid-shift, then hands over to manager at close.

## URLs

### UI pages
- `/office/pos` — the single-page POS register. Full-screen, keyboard-driven (Ctrl+Enter checkout). File: `src/app/(protected)/office/pos/page.tsx` (thin wrapper) + `src/modules/pos/components/PosScreen.tsx` (client component).
- `/office/pos/shifts` — **NEW (2026-05-14)** shift report. List of shifts with filters (status, branch, user, date range) and variance column. Manager/admin view.
- `/office/pos/shifts/[id]` — shift detail / audit page. Drops timeline, linked opening + closing Contras, variance JE.

### API routes
- `GET /api/people?lookup=…` — debounced party search consumed by shared `PartySearchAndCreate` (`src/shared/components/PartySearchAndCreate.tsx`).
- `GET /api/pos/account-snapshot/[accountId]` — full customer profile (balance, credit limit, turnover, loyalty, recent tickets, warranty alerts, personalised offers).
- `GET /api/pos/person-snapshot/[id]` — same as above but keyed on `personId` (for company-linked persons).
- `GET /api/pos/people/search?q=…` — alternate search endpoint (kept for back-compat with older POS calls).
- `POST /api/pos/sale` — submit the cart. Creates `Invoice` + AR/Revenue JE + **cash-receipt JE** (closes AR) + parallel `InvVoucher` (type=SALE) + stock. Requires an OPEN shift for the cashier in the active branch.
- **NEW**: `GET /api/pos/shifts/current` — returns the current user's OPEN shift in active branch, or null.
- **NEW**: `GET /api/pos/shifts` — list shifts (`?branchId=`, `?userId=`, `?status=`, `?from=`, `?to=`). Branch-scoped by default; `branchId=all` needs `pos:shift:view:org`.
- **NEW**: `POST /api/pos/shifts` — open a shift. Body `{ openingFloatPaise, notes? }`. Posts opening Contra (Vault → Till) when float > 0.
- **NEW**: `GET /api/pos/shifts/[id]` — shift detail including drops + linked vouchers + live running expected balance.
- **NEW**: `POST /api/pos/shifts/[id]/drops` — log mid-shift cash drop. Body `{ amountPaise, notes? }`. No GL movement.
- **NEW**: `PATCH /api/pos/shifts/[id]/close` — close shift. Body `{ declaredCashPaise, notes? }`. Computes variance, posts closing Contra (Till → Vault) + variance JE (Cash Short/Over) if needed.

## Permissions (gate keys)
- `pos:shift:open` — open own shift (R3 Front Desk, R4 Despatch by default).
- `pos:shift:close` — close own shift.
- `pos:shift:drop` — log mid-shift cash drops.
- `pos:shift:view:branch` — see all shifts in user's branches (managers/owners).
- `pos:shift:view:org` — see shifts across all branches (admin / owner).
- `pos:shift:manage` — force-close a stuck shift, edit drops, override variance, close another user's shift.
- POS sale itself still goes through `requirePermission(ACCOUNTANCY_VIEW_ORG)` for now (legacy gate; not POS-specific).

## Prisma models
- `InvVoucher` (file: `prisma/schema/inventory.prisma`) — the receipt; `type = "SALE"`, `journalEntryId` back-links the AR/Revenue JE. `branchId` (since 2026-05-13) ties the voucher to the cashier's active branch.
- `InvVoucherLine` — one row per cart item; carries qty, rate, tax, discount.
- `JournalEntry` + `JournalLine` — GL posts (one for AR/Revenue, a second for the cash receipt that closes the AR).
- `Account` — party ledger (debited then credited) + Sales A/c (credited) + Cash/Bank ledger (debited on receipt).
- `Payment` — **now actually written by POS sales (2026-05-14)** — one row per payment method line. Links to invoice + journalEntryId for traceability.
- **NEW** `PosShift` (file: `prisma/schema/pos.prisma`) — cashier till session. Carries `userId`, `branchId`, `tillAccountId` (snapshot), opening float, declared/expected/variance at close, FKs to opening + closing Contra Vouchers + variance JournalEntry.
- **NEW** `PosCashDrop` — mid-shift safe drops. Log-only, no GL impact.
- **`User.tillAccountId`** (FK Account) — each cashier's permanent till account. Auto-created by `dummy-users.ts` for R3/R4 demo users; production setup via UI (TODO).
- **`Branch.vaultAccountId`** (FK Account) — per-branch vault where shift-close handovers land. Auto-created by `bootstrap-seed.ts` for every seeded branch.

## Key components
- `PosScreen` (file: `src/modules/pos/components/PosScreen.tsx`) — the entire POS UI. Now mounts `ActiveShiftBar` at top when shift is open and `ShiftOpenDialog` when no shift exists.
- **NEW** `ActiveShiftBar` (`src/modules/pos/components/ActiveShiftBar.tsx`) — top strip showing shift #, till, opened time, running cash sales / drops / drawer estimate. Has [Drop to safe] and [Close shift] buttons. Polls `/api/pos/shifts/[id]` every 30 s.
- **NEW** `ShiftOpenDialog` (`src/modules/pos/components/ShiftOpenDialog.tsx`) — opening float modal.
- **NEW** `CashDropDialog` (`src/modules/pos/components/CashDropDialog.tsx`) — mid-shift drop modal.
- **NEW** `ShiftCloseDialog` (`src/modules/pos/components/ShiftCloseDialog.tsx`) — declared-count + variance preview + handover Contra.
- `PartySearchAndCreate` (`src/shared/components/PartySearchAndCreate.tsx`) — shared party omnibox used by POS.

## Library / helpers
- **NEW** `postPosReceiptJe` (`src/modules/pos/lib/postPosReceiptJe.ts`) — closes AR for a POS invoice by creating Payment rows + a single cash-receipt JE (Dr Till/Bank / Cr AR) + setting `invoice.amountPaid = total`, `status = PAID`.
- **NEW** `computeExpectedCash` / `computeVariance` / `sumPaise` (`src/modules/pos/lib/shiftMath.ts`) — paise-precision helpers for shift close arithmetic.
- Consumes `postContra` (`src/modules/accountancy/lib/postContra.ts`) for opening/closing Contra postings. Consumes `postInvoiceJe` (existing) for the AR/Revenue JE.

## Common workflows (wiring)

### Shift lifecycle (NEW 2026-05-14)
1. **Open shift** — cashier visits `/office/pos`. PosScreen calls `GET /api/pos/shifts/current`; if null, `ShiftOpenDialog` pops automatically (or via "Open shift" button). User enters opening float (default ₹2000) → `POST /api/pos/shifts` → opening Contra (`Cash – Vault – <Branch>` → `Cash – <User>`) posted in one transaction → PosScreen swaps the warning bar for `ActiveShiftBar`.
2. **Bill** — search customer, add items, hit Ctrl+Enter → checkout dialog → enter cash/UPI/extras → "Save (& Print)" → `POST /api/pos/sale` builds `payments: { method, amount, accountId? }[]` and submits. Server requires an OPEN shift; CASH amount auto-routes to the shift's `tillAccountId`, non-CASH methods route to user-picked bank account (default = first Bank account). Cash-receipt JE closes the AR same transaction.
3. **Mid-shift drop** — cashier clicks "Drop to safe" → `CashDropDialog` → `POST /api/pos/shifts/[id]/drops`. Log entry only; the till balance in the books is unchanged because the cash is still attributed to the cashier (it just physically lives in the safe).
4. **Close shift** — at end of shift, cashier clicks "Close shift" → `ShiftCloseDialog` loads live summary (opening + sales − drops = expected) → cashier declares physical count → variance previewed → "Hand over & close" → `PATCH /api/pos/shifts/[id]/close` → closing Contra (`Cash – <User>` → `Cash – Vault – <Branch>`) for the **declared** amount + variance JE (Dr Cash Short / Cr till for shortfall, Dr till / Cr Cash Over for overage) if variance ≠ 0.

### Manager review
- Visit `/office/pos/shifts` → filter by branch / user / status / date range → row-click → audit detail with drops timeline + opening Contra ref + closing Contra ref + variance JE ref. Open shifts surface in green; closed shifts grey. Variance > ₹50 magnitude triggers a red ⚠ chip.

## Reusable helpers — DO NOT duplicate

| Helper | File | Purpose | Use when |
|---|---|---|---|
| **`postContra(tx, { date, narration, lines, userId })`** | `src/modules/accountancy/lib/postContra.ts` | Atomic create-and-post for a CONTRA Voucher + mirror JournalEntry + Account.balance deltas. | Any system-generated cross-cash-account transfer (shift open/close, future inter-branch transfers, payroll cash handover). |
| **`postPosReceiptJe(tx, { invoiceId, customerAccountId, payments, ... })`** | `src/modules/pos/lib/postPosReceiptJe.ts` | Settles the AR side of a POS invoice by creating Payment rows + a cash-receipt JE + marking invoice PAID. | Inside `POST /api/pos/sale`. Don't replicate the multi-row receipt construction. |
| **`computeExpectedCash`, `computeVariance`, `sumPaise`** | `src/modules/pos/lib/shiftMath.ts` | Paise-arithmetic for shift close. | Anywhere expected/variance is computed (shift close API + UI preview). |

## Recent decisions / gotchas

- **POS sales now close AR (2026-05-14)** — previously the route created Invoice with `amountPaid: 0` and only the AR/Revenue JE. The cash collected at the counter was lost from the GL's perspective (it lived as text in `invoice.notes`). Now `postPosReceiptJe` posts a parallel cash-receipt JE that debits the till/bank and credits AR for the full collected amount, marking the invoice PAID. **This is a regression-protected behaviour** — see `docs/completed-and-protected.md`.
- **Per-cashier till accounts** — each cashier needs `User.tillAccountId` set. R3/R4 demo users get auto-provisioned tills by `dummy-users.ts`. Production cashiers need a one-time admin setup (open their user profile, assign a `Cash – <Name>` account). Without one, `POST /api/pos/shifts` returns 400.
- **Per-branch vault** — every branch needs `Branch.vaultAccountId` (`Cash – Vault – <Branch>`). Auto-created by bootstrap seed.
- **PosScreen still has the legacy multi-line payment UI** — current behaviour: CASH auto-routes to till on the server; UPI / Card / Cheque / Bank Transfer / Wallet auto-route to the **first Bank account** on the client. Per-row account picker is a follow-up (plan TODO).
- **Mid-shift drops don't touch GL** — physically the cash leaves the drawer but books-wise the cashier still owns it. The closing Contra moves the entire till balance at once, including amounts that were physically dropped. Don't add a per-drop Contra — it'd double-count.
- **Variance accounts** — `Cash Short` (Indirect Expenses, code 6950) and `Cash Over` (Indirect Incomes, code 4950) are seeded by bootstrap. If missing, the close API returns 500 telling you to re-seed.
- **One open shift per (user, branch)** — `POST /api/pos/shifts` returns 409 if there's already an OPEN shift for the user in the active branch. To open a new shift, close the existing one first (or admin can force-close via `pos:shift:manage`).
- PosScreen is UX-critical — party search/create logic is centralized in shared `PartySearchAndCreate`. Any future changes must preserve current keyboard flow.
- `POST /api/pos/sale` is synchronous — long-running for big carts. No queue yet.

## Out of scope / deferred

- **Per-row account picker** for non-CASH payment lines in PosScreen (UPI / Card etc. — currently all auto-route to the first Bank account).
- **Two-step manager handover** — currently staff self-closes. Future: `AWAITING_HANDOVER` interstate; manager "Receive Cash & Confirm" posts the Contra.
- **Stuck-shift auto-close cron** — alert + admin force-close if shift OPEN > 24h.
- **Float carry-over** — option to leave a fixed float in drawer between shifts (Contra only the surplus).
- **Per-shift Z-report print** — printable line-item shift summary.
- Barcode scanner integration.
- Layby / hold orders.
- Cash-drawer / printer hardware control.
- Per-cashier discount permissions.

_Last updated: 2026-05-14 — multi-staff shift lifecycle (open/drop/close), per-staff tills, per-branch vaults, AR closure on POS cash sales._
