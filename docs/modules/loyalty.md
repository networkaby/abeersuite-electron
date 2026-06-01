# Loyalty (POS earn + redeem wallet)

> Customer points wallet. Identified customers earn points on POS sales (configurable per-product rate) and redeem them as a discount on future POS sales. Points are **whole integers** held in **lots**, with **dynamic + lazy** expiry: a lot is valid iff it was earned within the *current* expiry window (`earnedAt > now − expiryDays`), evaluated live — so widening the window revives recently-lapsed points and narrowing it drops them. Earning posts **nothing** to the GL; redemption posts to a dedicated **"Loyalty Points Redeemed"** expense ledger via a negative `InvVoucherCharge` — the protected `postInvVoucherToGl` math is reused unchanged. Outstanding points are **not** booked as a liability — a read-only **memo** figure surfaces the obligation instead.

## How it works

- **Earn** (POS sale, identified customers only): skipped when the invoice is below `minEarnInvoiceValue`. Otherwise `pointsEarned = ⌊ effectiveBase / globalEarnRatePer ⌋`, where `effectiveBase = Σ lineNet × multiplier(line)`. `lineNet` = each line's pre-tax goods minus its proportional share of the voucher-level discount (tier + redemption). The multiplier resolves **product → group (walk parent tree) → category (walk tree) → global (1×)**. Anonymous/walk-in accounts earn nothing.
- **Redeem** (POS sale): server clamps the request to balance, `minRedeemInvoiceValue` (bill floor), `minRedeemPoints`, and `maxRedeemPctOfBill`/bill; `redemptionRupees = points × redeemValue`. Posted as a negative charge → `Dr Loyalty Points Redeemed`, lowering the bill via `chargesNet`. FIFO lots (oldest first, **in-window only**) are consumed.
- **Tier discount** (Bronze/Silver/Gold/Platinum %): rides the voucher-level `discountAmt` → `Dr Discount Allowed` path. (Wiring this also fixed a latent bug where any tier > 0% produced a "payment total mismatch".)
- **Return reversal** (SALE_RETURN): claws back earned points (∝ returned goods, capped at the original earn lot's remaining) and restores redeemed points (∝, as a fresh lot). No-ops on walk-in / pre-loyalty originals.
- **Expiry**: dynamic + lazy — **no sweep job**. The spendable balance is computed live from in-window lots everywhere it's read. `expiryEnabled=false` → points never expire.

## URLs

### UI pages
- `/office/customer-retention/loyalty` — admin hub: a read-only **outstanding-liability memo** card, the config form (Reward Setup + Redeem Setup), and the earn-rule overrides table. File: `src/app/(protected)/office/customer-retention/loyalty/page.tsx`. Gated `loyalty:manage`. Linked from the **Retention → Loyalty** sidebar item.
- Customer profile **Loyalty** tab — balance, its ₹ worth (memo), lifetime counters, active (in-window) lots, history, and an admin **Adjust** control. On `/office/customers/all` for Person and Company (`src/modules/loyalty/components/LoyaltyPanel.tsx`).
- POS register (`/vouchers/pos`) — shows the live balance, a **Redeem points** input (disabled with a hint when the bill is below `minRedeemInvoiceValue`), a "Points redeemed (−₹X)" summary row, and `+N pts` on the success toast.

### API routes
- `GET /api/loyalty/config` — singleton (auto-creates id=1). `requireAuth`.
- `PATCH /api/loyalty/config` — edit rates/expiry/floors. `loyalty:manage`.
- `GET|POST /api/loyalty/earn-rules`, `PATCH|DELETE /api/loyalty/earn-rules/[id]` — multiplier overrides. `loyalty:manage`.
- `GET /api/loyalty/[accountId]` — live balance + ₹ worth + in-window lots (with computed `expiresAt`) + recent ledger. `requireAuth`.
- `POST /api/loyalty/adjust` — manual ± grant/deduction. `loyalty:manage`; rejects driving balance negative.
- Earn/redeem are wired into `POST /api/pos/sale` (`discountAmt` + `redeemPoints` body fields; response adds `pointsEarned`/`pointsRedeemed`/`loyaltyBalance`); reversal into `POST /api/pos/return`.

## Permissions
- `loyalty:manage` — config + earn-rules + manual adjust. POS redemption reuses the sale gate (`accountancy:view:org`); return reversal reuses `pos:shift:open`. Owner (R1) gets it by default.

## Prisma models (`prisma/schema/loyalty.prisma`)
- `LoyaltyConfig` — singleton id=1: `enabled`, `globalEarnRatePer`, `redeemValue`, `expiryEnabled`, `expiryDays`, `minEarnInvoiceValue?`, `minRedeemInvoiceValue?`, `minRedeemPoints?`, `maxRedeemPctOfBill?`, `redeemExpenseAccountId?` (→ the dedicated ledger; wired by bootstrap).
- `LoyaltyEarnRule` — per `CATEGORY`/`GROUP`/`PRODUCT` `multiplier` override (0 = no earn). `@@unique([scope, categoryId, groupId, productId])`.
- `LoyaltyAccount` — per-customer wallet: lifetime `totalEarned`/`totalRedeemed` counters only (the spendable balance is **computed live**, never cached).
- `LoyaltyLot` — one row per EARN (or positive grant): `pointsEarned`, `pointsRemaining`, `earnedAt`. Validity derived from `earnedAt`; FIFO via `@@index([accountId, earnedAt])`.
- `LoyaltyLedger` — immutable audit trail: signed `delta`, `reason` (EARN_SALE/REDEEM_SALE/REVERSAL_RETURN/ADMIN_ADJUST), `balanceAfter`, optional `voucher`.

## Key components / lib
- `src/modules/loyalty/lib/loyaltyMath.ts` — pure: `resolveEarnMultiplier`, `earnableBaseForCart`, `pointsForBase`, `redeemValueOf`, `clampRedemption` (incl. min-redeem-invoice floor), `buildRulesIndex`, `ratesFromConfig`, `expiryCutoff`.
- `src/modules/loyalty/lib/applyLoyalty.ts` — tx-aware: `liveBalance`, `applyLoyaltyForSale`, `reverseLoyaltyForReturn`, `adjustPoints`. Must run inside the caller's `$transaction`.
- `src/modules/loyalty/components/` — `LoyaltyConfigForm` (Reward/Redeem sections), `LoyaltyEarnRules`, `LoyaltyPanel`.

## Seeds
- `bootstrap-seed.ts` seeds the **"Loyalty Points Redeemed"** ledger (Indirect Expenses, DEBIT), upserts `LoyaltyConfig` (1 pt/₹100, 1 pt = ₹1, `expiryEnabled` 365 days; create-only rates so admin edits survive reseed; `redeemExpenseAccountId` always backfilled), and the `loyalty:manage` permission.
- `hard-clean.ts` truncates `LoyaltyLedger`/`LoyaltyLot`/`LoyaltyAccount`; `LoyaltyConfig`, `LoyaltyEarnRule`, and the ledger account survive.

## Accounting
- **Earning: no GL entry.** **Redemption: `Dr Loyalty Points Redeemed` (expense)** at redemption time — cost recognised when redeemed. Outstanding points are **not** a balance-sheet liability; the hub shows a read-only **"Outstanding loyalty liability (₹)"** memo = `Σ unexpired points × redeemValue`, and each customer's balance shows its ₹ worth.

## Gotchas
- **Identified customers only.** The sale route forces `redeemPoints = 0` and skips earning when the account has no `personId`/`companyId`.
- **Dynamic + lazy expiry.** No stored expiry date, no cron. Validity is `earnedAt > now − expiryDays`, computed live; raising `expiryDays` revives recently-lapsed points, lowering it drops them. `expiryEnabled=false` = never expire.
- **Balance is always computed, never cached** — via `liveBalance`. Reports summing balances must filter in-window lots.
- **Server owns redemption ₹.** Client sends `redeemPoints`; server recomputes value + rejects (422) out-of-range requests; POS pre-clamps + disables the redeem input below the invoice floor.
- **Earn base excludes GST**, shipping, charges, and is net of tier discount + redemption.
- **v1 = POS only.** Office SALE / online shop don't earn yet — the lib is channel-agnostic for later.
- **Low-margin protection is manual in v1** (set loss-makers to `0×`). An automatic cost/margin guard is deferred.

_Last updated: 2026-06-01 — **Loyalty v1 (POS earn + redeem wallet).** Dynamic + lazy expiry in days (no cron); Vyapar-parity config (min-invoice-to-earn, min-invoice-to-redeem, expiry on/off, min-points) on top of per-product earn multipliers; redemption posts to a dedicated "Loyalty Points Redeemed" ledger (earning GL-silent); read-only outstanding-liability memo (no liability booked); customer-retention hub + customer-profile tab. Also fixed a latent POS tier-discount payment-total mismatch via `discountAmt` plumbing on `/api/pos/sale`._
