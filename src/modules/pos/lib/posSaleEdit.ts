// Re-saving a posted POS sale from the counter (PATCH /api/inventory/vouchers/[id]
// with `posEdit`). Server-only — it reads and writes the loyalty and gift-card
// tables.
//
// The edited bill is re-billed on its SALE DAY's terms (the `promoSnapshot` on
// its settlement): the level discount at that day's %, points at that day's
// rate. What the bill used — points redeemed, gift card drawn, points earned —
// is read from its own rows, so an edit moves exactly the difference:
//
//   • Points redeemed: at most what the customer had on the sale day, and never
//     more than they have now plus what this bill already took.
//   • Gift card: what this bill drew, plus whatever is still on the card today.
//   • Points earned: in proportion to the bill's point-earning value. Points the
//     customer has already spent are taken back as owed points (see
//     adjustSaleLoyaltyForEdit).
//   • Payment: re-taken like a fresh checkout — cash on the till of the counter
//     the sale was rung on (or, for a sale with no shift, the editor's own).

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { resolveCounterPayments, isGiftCardTender, type CounterPayment } from "@/modules/pos/lib/counterTenders";
import {
    ratesFromConfig, liveBalance, buildRulesIndex, earnableBaseForCart, adjustSaleLoyaltyForEdit,
    type LoyaltyRates, type EarnLine,
} from "@/modules/loyalty/lib";
import { netDrawsByCard, adjustGiftCardDraw } from "@/modules/coupons/lib";
import { readSettlement, type ChargeInput, type PromoSnapshot, type TenderInput } from "@/shared/lib/accountancy/settlement";
import { round2 } from "@/shared/lib/format";

type Tx = Prisma.TransactionClient | PrismaClient;

/** What the counter sends with an edited POS sale. */
export type PosEditInput = { payments: CounterPayment[]; redeemPoints: number };

/** "Loyalty: 120 pts redeemed" → 120 — the sale writes the count into the row. */
const LOYALTY_ROW = /^Loyalty:\s*(\d+)\s*pts/;
export const isLoyaltyCharge = (c: { description?: string | null }) => !!c.description?.startsWith("Loyalty:");
export const isCouponCharge = (c: { description?: string | null }) => !!c.description?.startsWith("Coupon:");

/** What the sale used, read off its own settlement rows. */
function usageOf(settlement: ReturnType<typeof readSettlement>) {
    const loyaltyRow = settlement.charges.find(isLoyaltyCharge) ?? null;
    const redeemed = loyaltyRow ? Number(LOYALTY_ROW.exec(loyaltyRow.description ?? "")?.[1] ?? 0) : 0;
    const giftTenders = settlement.tenders.filter(isGiftCardTender);
    return {
        loyaltyRow,
        redeemed,
        redeemRupees: loyaltyRow ? Math.abs(loyaltyRow.amount) : 0,
        couponRow: settlement.charges.find(isCouponCharge) ?? null,
        giftTender: giftTenders[0] ?? null,
        giftUsed: round2(giftTenders.reduce((s, t) => s + t.amount, 0)),
    };
}

/**
 * The stored snapshot, unless it is one the first draft of this feature (dev
 * 5d97fad4, never released) backfilled: those carry its usage fields
 * (`pointsRedeemed`, …) and always recorded loyalty as off and 0 points before
 * the sale, even on bills that used points — so they are made up again.
 */
export function trustedSnapshot(s: PromoSnapshot | null): PromoSnapshot | null {
    return s && !("pointsRedeemed" in s) ? s : null;
}

/**
 * The sale-day offers of a POS sale saved before they were recorded, made up
 * from its own rows: the stored tier %, its points just before the sale read
 * back off the loyalty ledger (`ledger` = the sale's EARN_SALE / REDEEM_SALE
 * rows, oldest first), and today's rates at the rupee value its loyalty row was
 * actually redeemed at. No loyalty rows → loyalty was off for that sale.
 */
export function derivePromoSnapshot(
    settlement: ReturnType<typeof readSettlement>,
    discountPct: Prisma.Decimal | number | null,
    ledger: { delta: number; balanceAfter: number }[],
    configRates: LoyaltyRates | null,
): PromoSnapshot {
    const used = usageOf(settlement);
    // The first row the sale itself wrote: balanceAfter less what it moved.
    const first = ledger[0];
    const before = first ? first.balanceAfter - first.delta : 0;
    return {
        tierDiscountPct: discountPct != null ? Number(discountPct) : 0,
        availablePointsBeforeSale: Math.max(0, before),
        loyaltyRates: ledger.length > 0 && configRates
            ? { ...configRates, redeemValue: used.redeemed > 0 ? used.redeemRupees / used.redeemed : configRates.redeemValue }
            : null,
        couponCode: used.couponRow ? (used.couponRow.description?.replace(/^Coupon:\s*/, "") || "auto") : null,
    };
}

/**
 * Everything an edit of this POS sale starts from — what the counter shows and
 * what the PATCH checks against. A sale saved before the snapshot existed gets
 * one made up from its own rows (`derivePromoSnapshot`).
 */
export async function loadPosEditContext(db: Tx, voucher: {
    settlementJson: Prisma.JsonValue | null;
    discountPct: Prisma.Decimal | number | null;
    universalVoucherId: number | null;
    partyAccountId: number | null;
}) {
    const settlement = readSettlement(voucher.settlementJson);
    const used = usageOf(settlement);
    const spineId = voucher.universalVoucherId;
    // One after another: inside a transaction (one connection) pg 9 refuses parallel queries.
    const config = await db.loyaltyConfig.findUnique({ where: { id: 1 } });
    const ledger = await (spineId == null ? [] : db.loyaltyLedger.findMany({
        where: { universalVoucherId: spineId, reason: { in: ["EARN_SALE", "REDEEM_SALE"] } },
        orderBy: { id: "asc" },
        select: { reason: true, delta: true, balanceAfter: true },
    }));
    const draws = await (spineId == null || used.giftUsed <= 0 ? [] : db.giftCardTxn.findMany({
        where: { universalVoucherId: spineId, type: "REDEEM" },
        select: { giftCardId: true, amount: true },
    }));
    const configRates = config ? ratesFromConfig(config) : null;
    const promo = trustedSnapshot(settlement.promoSnapshot) ?? derivePromoSnapshot(settlement, voucher.discountPct, ledger, configRates);

    const earned = ledger.filter((r) => r.reason === "EARN_SALE").reduce((s, r) => s + r.delta, 0);
    const loyaltyBalanceNow = voucher.partyAccountId != null && configRates?.enabled
        ? await liveBalance(db, voucher.partyAccountId, configRates)
        : 0;

    // The card the sale drew, and what is still on it today.
    const cardIds = [...netDrawsByCard(draws).keys()];
    const card = cardIds.length === 1
        ? await db.giftCard.findUnique({ where: { id: cardIds[0] }, select: { id: true, code: true, balance: true, status: true, enabled: true, expiresAt: true } })
        : null;
    const cardUsable = !!card && card.status === "ACTIVE" && card.enabled && (!card.expiresAt || card.expiresAt > new Date());

    return {
        settlement,
        used,
        promo,
        earned,
        loyaltyBalanceNow,
        configRates,
        redeemExpenseAccountId: config?.redeemExpenseAccountId ?? null,
        giftCard: card ? { id: card.id, code: card.code, availableNow: cardUsable ? round2(Number(card.balance)) : 0 } : null,
    };
}
export type PosEditContext = Awaited<ReturnType<typeof loadPosEditContext>>;

/** Most points this bill may redeem on an edit (rule agreed with the owner). */
export function maxRedeemOnEdit(ctx: Pick<PosEditContext, "promo" | "used" | "loyaltyBalanceNow">): number {
    const before = ctx.used.redeemed;
    return Math.max(0, Math.min(Math.max(ctx.promo.availablePointsBeforeSale, before), ctx.loyaltyBalanceNow + before));
}

type Refusal = { error: string; status: number; code?: string };

/**
 * Step 1, before the totals: the loyalty row the edited bill carries. Unchanged
 * points keep the original row to the paisa; a change is priced at the sale
 * day's rate.
 */
export function planRedemption(ctx: PosEditContext, input: PosEditInput): { row: ChargeInput | null; redeemed: number } | Refusal {
    const now = Math.max(0, Math.floor(Number(input.redeemPoints) || 0));
    if (now === ctx.used.redeemed) return { row: ctx.used.loyaltyRow, redeemed: now };
    const cap = maxRedeemOnEdit(ctx);
    if (now > cap) {
        return { error: `This bill can use at most ${cap} loyalty points.`, status: 422, code: "LOYALTY_REDEEM_REJECTED" };
    }
    if (now === 0) return { row: null, redeemed: 0 };
    const value = ctx.promo.loyaltyRates?.redeemValue ?? 0;
    const accountId = ctx.used.loyaltyRow?.accountId ?? ctx.redeemExpenseAccountId;
    if (value <= 0 || accountId == null) {
        return { error: "Loyalty points could not be priced for this bill.", status: 422, code: "LOYALTY_LEDGER_MISSING" };
    }
    return { row: { accountId, description: `Loyalty: ${now} pts redeemed`, amount: -round2(now * value) }, redeemed: now };
}

/** Goods value that earns points, after the bill's discounts — rule multipliers applied. */
async function earnBases(db: Tx, oldLines: EarnInputLine[], newLines: EarnInputLine[], oldDiscount: number, newDiscount: number) {
    const ids = [...new Set([...oldLines, ...newLines].map((l) => l.productId))];
    // One after another: inside a transaction (one connection) pg 9 refuses parallel queries.
    const products = await db.invProduct.findMany({ where: { id: { in: ids } }, select: { id: true, groupId: true, categoryId: true } });
    const groups = await db.invProductGroup.findMany({ select: { id: true, parentId: true } });
    const categories = await db.invCategory.findMany({ select: { id: true, parentId: true } });
    const rules = await db.loyaltyEarnRule.findMany({ where: { enabled: true }, select: { scope: true, categoryId: true, groupId: true, productId: true, multiplier: true, redeemCapPct: true, enabled: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const idx = buildRulesIndex(rules.map((r) => ({ ...r, multiplier: Number(r.multiplier), redeemCapPct: r.redeemCapPct == null ? null : Number(r.redeemCapPct) })));
    const maps = {
        groupParent: new Map(groups.map((g) => [g.id, g.parentId])),
        categoryParent: new Map(categories.map((c) => [c.id, c.parentId])),
    };
    const earn = (lines: EarnInputLine[]): EarnLine[] => lines.map((l) => ({
        productId: l.productId,
        groupId: byId.get(l.productId)?.groupId ?? null,
        categoryId: byId.get(l.productId)?.categoryId ?? null,
        goods: l.quantity * l.rate,
    }));
    return {
        oldBase: earnableBaseForCart(earn(oldLines), oldDiscount, idx, maps),
        newBase: earnableBaseForCart(earn(newLines), newDiscount, idx, maps),
    };
}
type EarnInputLine = { productId: number; quantity: number; rate: number; discountAmt: number };

export type PosEditPlan = {
    tenders: TenderInput[];
    promo: PromoSnapshot;
    redeemedBefore: number;
    redeemedNow: number;
    earnedBefore: number;
    earnedNow: number;
    gift: { giftCardId: number; delta: number } | null;
};

/**
 * Step 2, once the edited bill's total is known: the payment rows, the gift-card
 * draw and the points the bill earns now.
 */
export async function planSettlement(db: Tx, ctx: PosEditContext, args: {
    input: PosEditInput;
    redeemedNow: number;
    redeemRupeesNow: number;
    total: number;
    sourceShiftId: number | null;
    partyAccountId: number | null;
    editorUserId: number;
    oldLines: EarnInputLine[];
    newLines: EarnInputLine[];
    oldLineDiscount: number;
    newLineDiscount: number;
}): Promise<PosEditPlan | Refusal> {
    const { input, total } = args;

    // ── Gift card: what it drew, plus what is still on it today ───────────
    const giftBefore = ctx.used.giftUsed;
    let giftNow = 0;
    let gift: PosEditPlan["gift"] = null;
    if (giftBefore > 0) {
        if (ctx.giftCard) {
            giftNow = round2(Math.min(total, giftBefore + ctx.giftCard.availableNow));
            gift = { giftCardId: ctx.giftCard.id, delta: round2(giftNow - giftBefore) };
        } else {
            // The draw cannot be traced to one card — keep it exactly as it was.
            if (total + 0.005 < giftBefore) return { error: "This bill's gift card draw can't be reduced here — the bill would be less than the card paid.", status: 422 };
            giftNow = giftBefore;
        }
    }

    // ── Payment, re-taken on the counter the sale was rung on ─────────────
    const payments = input.payments.filter((p) => Number(p.amount) > 0.005);
    let resolved: TenderInput[] = [];
    if (payments.length > 0) {
        const counterSelect = { tillAccountId: true, paymentAccounts: { select: { id: true, channel: true, accountId: true } } } as const;
        const counter = (args.sourceShiftId != null
            ? (await db.posShift.findUnique({ where: { id: args.sourceShiftId }, select: { counter: { select: counterSelect } } }))?.counter
            : null)
            ?? (await db.posShift.findFirst({ where: { userId: args.editorUserId, status: "OPEN" }, select: { counter: { select: counterSelect } } }))?.counter;
        if (!counter) return { error: "Open a shift to take a payment on this sale.", status: 422, code: "NO_OPEN_SHIFT" };
        const r = resolveCounterPayments(payments, counter.tillAccountId, new Map(counter.paymentAccounts.map((a) => [a.id, a])));
        if (!r) return { error: "That payment account isn't on the counter this sale was rung on.", status: 422, code: "PAYMENT_METHOD_NOT_MAPPED" };
        resolved = r;
    }
    const paid = round2(resolved.reduce((s, t) => s + t.amount, 0) + giftNow);
    const onCredit = round2(total - paid);
    if (onCredit < -0.01) {
        return { error: `Payments (₹${paid.toFixed(2)}) are more than the bill (₹${total.toFixed(2)}). Return the change.`, status: 422 };
    }
    if (onCredit > 0.005 && args.partyAccountId == null) {
        return { error: "Part of this bill is unpaid, but the sale has no customer account to carry it.", status: 422 };
    }
    const tenders: TenderInput[] = [
        ...resolved,
        ...(giftNow > 0.005 && ctx.used.giftTender
            ? [{ accountId: ctx.used.giftTender.accountId, amount: giftNow, method: ctx.used.giftTender.method, reference: ctx.used.giftTender.reference }]
            : []),
        ...(onCredit > 0.005 && args.partyAccountId != null ? [{ accountId: args.partyAccountId, amount: onCredit }] : []),
    ];

    // ── Points earned: in proportion to the point-earning value ───────────
    const earnedBefore = ctx.earned;
    let earnedNow = earnedBefore;
    const couponRupees = ctx.used.couponRow ? Math.abs(ctx.used.couponRow.amount) : 0;
    const oldDiscount = args.oldLineDiscount + ctx.used.redeemRupees + couponRupees;
    const newDiscount = args.newLineDiscount + args.redeemRupeesNow + couponRupees;
    const sameLines = JSON.stringify(args.oldLines) === JSON.stringify(args.newLines);
    if (earnedBefore > 0 && (!sameLines || Math.abs(oldDiscount - newDiscount) > 0.005)) {
        const { oldBase, newBase } = await earnBases(db, args.oldLines, args.newLines, oldDiscount, newDiscount);
        earnedNow = oldBase > 0 ? Math.round(earnedBefore * (newBase / oldBase)) : earnedBefore;
    }
    // The sale-day floor still applies to the bill as it now stands.
    const floor = ctx.promo.loyaltyRates?.minEarnInvoiceValue;
    if (floor != null && total + args.redeemRupeesNow + couponRupees < floor) earnedNow = 0;

    return {
        tenders,
        promo: ctx.promo,
        redeemedBefore: ctx.used.redeemed,
        redeemedNow: args.redeemedNow,
        earnedBefore,
        earnedNow,
        gift,
    };
}

/** Step 3, inside the PATCH transaction: move the points and the gift card. */
export async function applyPosEdit(tx: Tx, plan: PosEditPlan, args: {
    universalVoucherId: number;
    partyAccountId: number | null;
    rates: LoyaltyRates | null;
    createdById: number;
}): Promise<void> {
    if (args.partyAccountId != null && args.rates) {
        await adjustSaleLoyaltyForEdit(tx, {
            accountId: args.partyAccountId,
            universalVoucherId: args.universalVoucherId,
            redeemedBefore: plan.redeemedBefore,
            redeemedNow: plan.redeemedNow,
            earnedBefore: plan.earnedBefore,
            earnedNow: plan.earnedNow,
            rates: args.rates,
            createdById: args.createdById,
        });
    }
    if (plan.gift && Math.abs(plan.gift.delta) > 0.005) {
        await adjustGiftCardDraw(tx, { giftCardId: plan.gift.giftCardId, delta: plan.gift.delta, universalVoucherId: args.universalVoucherId, createdById: args.createdById });
    }
}
