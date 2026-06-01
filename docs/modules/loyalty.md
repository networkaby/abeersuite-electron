# Loyalty (POS earn + redeem wallet)

> Customer points wallet. Identified customers earn points on POS sales (configurable per-product rate) and redeem them as a discount on future POS sales. Points are **whole integers**, live in **FIFO lots** with a configurable expiry, and have a full audit ledger. Earning posts **nothing** to the GL; redemption posts to a dedicated **"Loyalty Points Redeemed"** expense ledger via a negative `InvVoucherCharge` — the protected `postInvVoucherToGl` math is reused unchanged.

## How it works

- **Earn** (POS sale, identified customers only): `pointsEarned = ⌊ effectiveBase / globalEarnRatePer ⌋`, where `effectiveBase = Σ lineNet × multiplier(line)`. `lineNet` is each line's pre-tax goods minus its proportional share of the voucher-level discount (tier + redemption). The multiplier resolves **product → group (walk parent tree) → category (walk tree) → global (1×)**. Anonymous/walk-in accounts earn nothing.
- **Redeem** (POS sale): server clamps the requested points to balance, `minRedeemPoints`, and `maxRedeemPctOfBill`/bill; `redemptionRupees = points × redeemValue`. Posted as a negative charge → `Dr Loyalty Points Redeemed`, lowering the bill via `chargesNet`. FIFO lots (oldest expiry first) are consumed.
- **Tier discount** (the existing Bronze/Silver/Gold/Platinum %): rides the voucher-level `discountAmt` → `Dr Discount Allowed` path. (Wiring this also fixed a latent bug where any tier > 0% produced a "payment total mismatch".)
- **Return reversal** (SALE_RETURN): claws back earned points (∝ returned goods value, capped at the original earn lot's remaining — never reclaims spent points) and restores redeemed points (∝, as a fresh lot). No-ops on walk-in / pre-loyalty originals.
- **Expiry**: a daily GitHub Actions cron POSTs the token-guarded sweep route; ACTIVE lots past `expiresAt` flip to EXPIRED and post an EXPIRY ledger row.

## URLs

### UI pages
- `/office/customer-retention/loyalty` — admin hub: config (rates, expiry, caps) + earn-rule overrides. File: `src/app/(protected)/office/customer-retention/loyalty/page.tsx`. Gated `loyalty:manage`. Linked from the **Retention → Loyalty** sidebar item.
- Customer profile **Loyalty** tab — balance, lifetime counters, active (expiring) lots, history, and an admin **Adjust** control. Surfaced on `/office/customers/all` for both Person and Company (`src/modules/loyalty/components/LoyaltyPanel.tsx`).
- POS register (`/vouchers/pos`) — shows the real balance, a **Redeem points** input, a "Points redeemed (−₹X)" summary row, and `+N pts` on the success toast.

### API routes
- `GET /api/loyalty/config` — singleton (auto-creates id=1). `requireAuth`.
- `PATCH /api/loyalty/config` — edit rates/expiry/caps. `loyalty:manage`.
- `GET /api/loyalty/earn-rules` · `POST /api/loyalty/earn-rules` — list / create multiplier overrides. `loyalty:manage`.
- `PATCH|DELETE /api/loyalty/earn-rules/[id]` — edit multiplier/enabled, delete. `loyalty:manage`.
- `GET /api/loyalty/[accountId]` — wallet summary + active lots + recent ledger. `requireAuth`.
- `POST /api/loyalty/adjust` — manual ± grant/deduction (`{ accountId, delta, note }`). `loyalty:manage`; rejects driving balance negative.
- `POST /api/loyalty/expire-points` — sweep. Token-guarded by `LOYALTY_CRON_SECRET` bearer (NOT session-based). Driven by `.github/workflows/loyalty-expire-points.yml` (daily 02:00 UTC).
- Earn/redeem are wired into `POST /api/pos/sale` (`discountAmt` + `redeemPoints` body fields; response adds `pointsEarned`/`pointsRedeemed`/`loyaltyBalance`); reversal into `POST /api/pos/return`.

## Permissions
- `loyalty:manage` — config + earn-rules + manual adjust. POS redemption reuses the sale gate (`accountancy:view:org`); return reversal reuses `pos:shift:open`. Owner (R1) gets it by default.

## Prisma models (`prisma/schema/loyalty.prisma`)
- `LoyaltyConfig` — singleton id=1: `enabled`, `globalEarnRatePer`, `redeemValue`, `expiryMonths`, `minRedeemPoints?`, `maxRedeemPctOfBill?`, `redeemExpenseAccountId?` (→ the dedicated ledger; wired by bootstrap).
- `LoyaltyEarnRule` — per `CATEGORY`/`GROUP`/`PRODUCT` `multiplier` override (0 = no earn). `@@unique([scope, categoryId, groupId, productId])`.
- `LoyaltyAccount` — per-customer wallet: cached `pointsBalance` + lifetime `totalEarned`/`totalRedeemed`/`totalExpired`.
- `LoyaltyLot` — one row per EARN (or positive grant): `pointsEarned`, `pointsRemaining`, `earnedAt`, `expiresAt`, `status` (ACTIVE/EXPIRED). FIFO via `@@index([accountId, status, expiresAt])`.
- `LoyaltyLedger` — immutable audit trail: signed `delta`, `reason` (EARN_SALE/REDEEM_SALE/REVERSAL_RETURN/ADMIN_ADJUST/EXPIRY), `balanceAfter`, optional `voucher`.

## Key components / lib
- `src/modules/loyalty/lib/loyaltyMath.ts` — pure: `resolveEarnMultiplier`, `earnableBaseForCart`, `pointsForBase`, `redeemValueOf`, `clampRedemption`, `buildRulesIndex`, `ratesFromConfig`.
- `src/modules/loyalty/lib/applyLoyalty.ts` — tx-aware: `applyLoyaltyForSale`, `reverseLoyaltyForReturn`, `adjustPoints`, `expireLots` (FIFO lot consumption + ledger). Must run inside the caller's `$transaction`.
- `src/modules/loyalty/components/` — `LoyaltyConfigForm`, `LoyaltyEarnRules`, `LoyaltyPanel`.

## Seeds
- `bootstrap-seed.ts` seeds the **"Loyalty Points Redeemed"** ledger (Indirect Expenses, DEBIT), upserts the `LoyaltyConfig` singleton (1 pt/₹100, 1 pt = ₹1, 12-mo expiry; rates create-only so admin edits survive reseed; `redeemExpenseAccountId` always backfilled), and the `loyalty:manage` permission.
- `hard-clean.ts` truncates `LoyaltyLedger`/`LoyaltyLot`/`LoyaltyAccount`; `LoyaltyConfig`, `LoyaltyEarnRule`, and the ledger account survive (config/master data).

## Gotchas
- **Identified customers only.** The sale route forces `redeemPoints = 0` and skips earning when the account has no `personId`/`companyId`.
- **Server owns redemption ₹.** The client sends `redeemPoints`; the server recomputes value from `LoyaltyConfig` and rejects (422) out-of-range requests. The POS UI pre-clamps so it only ever sends an acceptable value.
- **Earn base excludes GST**, shipping, and charges, and is net of both tier discount and redemption (prevents a redeem→earn loop).
- **Lots are the source of truth**; `pointsBalance` is a cached mirror recomputed from active lots on every movement.
- **Cron secret.** `/api/loyalty/expire-points` returns 503 if `LOYALTY_CRON_SECRET` is unset; add it to the deployment env + GitHub Secrets (plus `APP_BASE_URL`).
- **v1 = POS only.** Office SALE / online shop don't earn yet — the lib is channel-agnostic for later adoption.
- **Low-margin protection is manual in v1** (set loss-making categories/products to `0×`). An automatic cost/margin guard is deferred.

_Last updated: 2026-06-01 — **Loyalty v1 shipped (POS earn + redeem wallet).** New `loyalty.prisma` (config/earn-rules/account/lot/ledger), the `src/modules/loyalty/lib` + components, six `/api/loyalty/*` routes, POS sale/return/snapshot wiring, customer-retention hub + customer-profile Loyalty tab, daily expiry cron. Redemption posts to a dedicated "Loyalty Points Redeemed" ledger via a negative charge; earning is GL-silent. Also fixed a latent POS tier-discount payment-total mismatch by adding `discountAmt` plumbing to `/api/pos/sale`._
