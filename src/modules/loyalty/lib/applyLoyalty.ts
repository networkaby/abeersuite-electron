// Transaction-aware loyalty mutations. Every function here MUST run inside the
// caller's prisma.$transaction so points move atomically with the sale / return.
//
// Expiry is DYNAMIC + LAZY: nothing is ever destructively expired. A lot is live
// while `earnedAt > now − expiryDays` (or always, when expiry is disabled). The
// spendable balance is therefore COMPUTED LIVE from in-window lots — never cached
// — so a config change (widen/narrow the window) is reflected immediately and can
// revive recently-lapsed points. LoyaltyLedger is the immutable audit trail; the
// LoyaltyAccount row only holds lifetime counters.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { issueMilestoneCoupon } from "@/modules/coupons/lib";
import {
    earnableBaseForCart,
    pointsForBase,
    expiryCutoff,
    type EarnLine,
    type LoyaltyRates,
    type RulesIndex,
    type TaxonomyMaps,
} from "./loyaltyMath";

type Tx = Prisma.TransactionClient | PrismaClient;

/// Upsert the wallet header so subsequent updates have a row to hit.
async function ensureAccount(tx: Tx, accountId: number): Promise<void> {
    await tx.loyaltyAccount.upsert({ where: { accountId }, create: { accountId }, update: {} });
}

/// Live spendable balance = Σ pointsRemaining of in-window lots. `rates` decides
/// the window (or no window when expiry is disabled). Exposed for the routes.
export async function liveBalance(tx: Tx, accountId: number, rates: LoyaltyRates): Promise<number> {
    const cutoff = expiryCutoff(new Date(), rates);
    const agg = await tx.loyaltyLot.aggregate({
        where: { accountId, pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
        _sum: { pointsRemaining: true },
    });
    return agg._sum.pointsRemaining ?? 0;
}

async function addLot(
    tx: Tx,
    args: { accountId: number; universalVoucherId: number | null; points: number; earnedAt: Date },
): Promise<void> {
    await tx.loyaltyLot.create({
        data: {
            accountId: args.accountId,
            universalVoucherId: args.universalVoucherId,
            pointsEarned: args.points,
            pointsRemaining: args.points,
            earnedAt: args.earnedAt,
        },
    });
}

/// Consume `points` from in-window lots, oldest first. Returns the amount actually
/// consumed (≤ available). `cutoff` null = no expiry filter.
async function consumeLotsFIFO(tx: Tx, accountId: number, points: number, cutoff: Date | null): Promise<number> {
    if (points <= 0) return 0;
    const lots = await tx.loyaltyLot.findMany({
        where: { accountId, pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
        orderBy: [{ earnedAt: "asc" }, { id: "asc" }],
        select: { id: true, pointsRemaining: true },
    });
    let remaining = points;
    let consumed = 0;
    for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.pointsRemaining, remaining);
        await tx.loyaltyLot.update({ where: { id: lot.id }, data: { pointsRemaining: lot.pointsRemaining - take } });
        remaining -= take;
        consumed += take;
    }
    return consumed;
}

/// Recompute the live balance, bump lifetime counters, append a ledger row.
async function postMovement(
    tx: Tx,
    args: {
        accountId: number;
        universalVoucherId: number | null;
        delta: number;
        reason: "EARN_SALE" | "REDEEM_SALE" | "REVERSAL_RETURN" | "ADMIN_ADJUST" | "MILESTONE_BONUS";
        note?: string | null;
        createdById: number;
        counters?: Prisma.LoyaltyAccountUpdateInput;
        rates: LoyaltyRates;
    },
): Promise<number> {
    const balanceAfter = await liveBalance(tx, args.accountId, args.rates);
    if (args.counters && Object.keys(args.counters).length > 0) {
        await tx.loyaltyAccount.update({ where: { accountId: args.accountId }, data: args.counters });
    }
    await tx.loyaltyLedger.create({
        data: {
            accountId: args.accountId,
            universalVoucherId: args.universalVoucherId,
            delta: args.delta,
            reason: args.reason,
            balanceAfter,
            note: args.note ?? null,
            createdById: args.createdById,
        },
    });
    return balanceAfter;
}

export type ApplySaleArgs = {
    accountId: number;
    /// Phase 5 5B: the sale's UniversalVoucher spine id (the document anchor).
    universalVoucherId: number;
    earnLines: EarnLine[];
    /// Combined voucher-level reduction (tier discount + redemption ₹).
    combinedDiscount: number;
    /// Points to burn — must already be validated/clamped by the caller.
    redeemPoints: number;
    /// Invoice value used to gate earning against minEarnInvoiceValue.
    invoiceValue: number;
    rates: LoyaltyRates;
    rulesIndex: RulesIndex;
    taxonomyMaps: TaxonomyMaps;
    createdById: number;
};

/// Redeem (consume oldest in-window lots) then earn (new lot) for a single sale.
export async function applyLoyaltyForSale(
    tx: Tx,
    args: ApplySaleArgs,
): Promise<{ pointsEarned: number; pointsRedeemed: number; newBalance: number }> {
    await ensureAccount(tx, args.accountId);
    const cutoff = expiryCutoff(new Date(), args.rates);

    let pointsRedeemed = 0;
    let newBalance: number | null = null;

    if (args.redeemPoints > 0) {
        pointsRedeemed = await consumeLotsFIFO(tx, args.accountId, args.redeemPoints, cutoff);
        newBalance = await postMovement(tx, {
            accountId: args.accountId,
            universalVoucherId: args.universalVoucherId,
            delta: -pointsRedeemed,
            reason: "REDEEM_SALE",
            createdById: args.createdById,
            counters: { totalRedeemed: { increment: pointsRedeemed } },
            rates: args.rates,
        });
    }

    // Min-invoice-to-earn gate.
    const meetsEarnFloor = args.rates.minEarnInvoiceValue == null || args.invoiceValue >= args.rates.minEarnInvoiceValue;
    const base = meetsEarnFloor ? earnableBaseForCart(args.earnLines, args.combinedDiscount, args.rulesIndex, args.taxonomyMaps) : 0;
    const pointsEarned = pointsForBase(base, args.rates);
    if (pointsEarned > 0) {
        await addLot(tx, { accountId: args.accountId, universalVoucherId: args.universalVoucherId, points: pointsEarned, earnedAt: new Date() });
        newBalance = await postMovement(tx, {
            accountId: args.accountId,
            universalVoucherId: args.universalVoucherId,
            delta: pointsEarned,
            reason: "EARN_SALE",
            createdById: args.createdById,
            counters: { totalEarned: { increment: pointsEarned } },
            rates: args.rates,
        });
    }

    if (newBalance === null) newBalance = await liveBalance(tx, args.accountId, args.rates);
    return { pointsEarned, pointsRedeemed, newBalance };
}

export type ReverseReturnArgs = {
    accountId: number;
    /// Phase 5 5B: loyalty rows are keyed by the spine; the prior-returns lookup
    /// still walks InvVoucher.refVoucherId (InvVoucher id space). So we take BOTH
    /// id faces of the original sale + the return — spine for loyalty, InvVoucher
    /// for the refVoucher graph. `originalUniversalVoucherId` may be null (a sale
    /// with no spine never carried loyalty → the function returns null).
    originalUniversalVoucherId: number | null;
    originalVoucherId: number;
    returnUniversalVoucherId: number;
    returnVoucherId: number;
    /// returnedGoods / originalGoods, clamped 0..1 by the caller.
    returnFraction: number;
    rates: LoyaltyRates;
    createdById: number;
};

/// Reverse loyalty on a SALE_RETURN: claw back earned points (proportional, capped
/// at the original earn lot's remaining), restore redeemed points (proportional, as
/// a fresh lot). Returns null when the original sale had no loyalty activity.
export async function reverseLoyaltyForReturn(
    tx: Tx,
    args: ReverseReturnArgs,
): Promise<{ pointsClawedBack: number; pointsRestored: number; newBalance: number } | null> {
    if (args.originalUniversalVoucherId == null) return null;
    const rows = await tx.loyaltyLedger.findMany({
        where: { universalVoucherId: args.originalUniversalVoucherId, reason: { in: ["EARN_SALE", "REDEEM_SALE"] } },
        select: { reason: true, delta: true },
    });
    if (rows.length === 0) return null;

    await ensureAccount(tx, args.accountId);
    const fraction = Math.max(0, Math.min(1, args.returnFraction));

    const originalEarn = rows.filter((r) => r.reason === "EARN_SALE").reduce((s, r) => s + r.delta, 0);
    const originalRedeem = rows.filter((r) => r.reason === "REDEEM_SALE").reduce((s, r) => s - r.delta, 0);

    let pointsClawedBack = 0;
    let pointsRestored = 0;
    let newBalance: number | null = null;

    // ── Claw back earned — decrement the original earn lot (can't reclaim spent points).
    if (originalEarn > 0) {
        const target = Math.round(originalEarn * fraction);
        if (target > 0) {
            const lot = await tx.loyaltyLot.findFirst({
                where: { accountId: args.accountId, universalVoucherId: args.originalUniversalVoucherId },
                orderBy: { id: "asc" },
                select: { id: true, pointsRemaining: true },
            });
            const claw = Math.min(target, lot?.pointsRemaining ?? 0);
            if (lot && claw > 0) {
                await tx.loyaltyLot.update({ where: { id: lot.id }, data: { pointsRemaining: lot.pointsRemaining - claw } });
                pointsClawedBack = claw;
                newBalance = await postMovement(tx, {
                    accountId: args.accountId,
                    universalVoucherId: args.returnUniversalVoucherId,
                    delta: -claw,
                    reason: "REVERSAL_RETURN",
                    note: `Claw-back of points earned on sale #${args.originalVoucherId}`,
                    createdById: args.createdById,
                    counters: { totalEarned: { increment: -claw } },
                    rates: args.rates,
                });
            }
        }
    }

    // ── Restore redeemed — fresh lot, capped at original redeem net of prior restores.
    if (originalRedeem > 0) {
        // Prior returns of the SAME sale walk the InvVoucher refVoucher graph
        // (InvVoucher id space), but their loyalty rows are keyed by the spine — so
        // select each prior return's universalVoucherId for the ledger aggregate.
        const priorReturns = await tx.invVoucher.findMany({
            where: { refVoucherId: args.originalVoucherId, type: "SALE_RETURN", id: { not: args.returnVoucherId } },
            select: { universalVoucherId: true },
        });
        let alreadyRestored = 0;
        const priorReturnSpineIds = priorReturns.map((v) => v.universalVoucherId).filter((x): x is number => x != null);
        if (priorReturnSpineIds.length > 0) {
            const agg = await tx.loyaltyLedger.aggregate({
                where: { universalVoucherId: { in: priorReturnSpineIds }, reason: "REVERSAL_RETURN", delta: { gt: 0 } },
                _sum: { delta: true },
            });
            alreadyRestored = agg._sum.delta ?? 0;
        }
        const target = Math.min(Math.round(originalRedeem * fraction), originalRedeem - alreadyRestored);
        if (target > 0) {
            await addLot(tx, { accountId: args.accountId, universalVoucherId: args.returnUniversalVoucherId, points: target, earnedAt: new Date() });
            pointsRestored = target;
            newBalance = await postMovement(tx, {
                accountId: args.accountId,
                universalVoucherId: args.returnUniversalVoucherId,
                delta: target,
                reason: "REVERSAL_RETURN",
                note: `Restore of points redeemed on sale #${args.originalVoucherId}`,
                createdById: args.createdById,
                counters: { totalRedeemed: { increment: -target } },
                rates: args.rates,
            });
        }
    }

    if (newBalance === null) newBalance = await liveBalance(tx, args.accountId, args.rates);
    return { pointsClawedBack, pointsRestored, newBalance };
}

/// A milestone tier, narrowed to what the awarder needs.
export type MilestoneTier = { id: number; threshold: number; bonusPoints: number; label: string | null; issuesCouponTemplateId: number | null };

export type AwardMilestonesArgs = {
    accountId: number;
    /// Lifetime spend (₹) AFTER the current sale — computed by the caller inside the tx.
    lifetimeSpend: number;
    /// Phase 5 5B: the crossing sale's UniversalVoucher spine id (null if admin).
    universalVoucherId: number | null;
    /// Enabled milestone tiers (any order); already filtered to enabled.
    milestones: MilestoneTier[];
    rates: LoyaltyRates;
    createdById: number;
};

/// Award any milestone tiers the customer has now crossed but not yet received.
/// One-time per tier (guarded by the LoyaltyMilestoneAward unique). Each award
/// grants bonus points as a fresh lot + a MILESTONE_BONUS ledger row. Off-book,
/// like ordinary earning. Returns the tiers awarded on this call.
export async function applyMilestones(
    tx: Tx,
    args: AwardMilestonesArgs,
): Promise<{ awarded: { milestoneId: number; points: number; label: string | null }[]; newBalance: number; issuedCouponCodes: string[] }> {
    // A milestone qualifies if it grants points OR issues a coupon.
    const crossed = args.milestones.filter((m) => args.lifetimeSpend >= m.threshold && (m.bonusPoints > 0 || m.issuesCouponTemplateId != null));
    if (crossed.length === 0) return { awarded: [], newBalance: await liveBalance(tx, args.accountId, args.rates), issuedCouponCodes: [] };

    await ensureAccount(tx, args.accountId);
    const ids = crossed.map((m) => m.id);
    const existing = await tx.loyaltyMilestoneAward.findMany({
        where: { accountId: args.accountId, milestoneId: { in: ids } },
        select: { milestoneId: true },
    });
    const alreadyAwarded = new Set(existing.map((e) => e.milestoneId));
    const pending = crossed.filter((m) => !alreadyAwarded.has(m.id));

    const awarded: { milestoneId: number; points: number; label: string | null }[] = [];
    const issuedCouponCodes: string[] = [];
    let newBalance: number | null = null;

    for (const m of pending) {
        // Unique [accountId, milestoneId] is the real guard against double-award.
        await tx.loyaltyMilestoneAward.create({
            data: { accountId: args.accountId, milestoneId: m.id, universalVoucherId: args.universalVoucherId, pointsGranted: m.bonusPoints },
        });
        if (m.bonusPoints > 0) {
            await addLot(tx, { accountId: args.accountId, universalVoucherId: args.universalVoucherId, points: m.bonusPoints, earnedAt: new Date() });
            newBalance = await postMovement(tx, {
                accountId: args.accountId,
                universalVoucherId: args.universalVoucherId,
                delta: m.bonusPoints,
                reason: "MILESTONE_BONUS",
                note: m.label ? `Milestone reward: ${m.label}` : `Milestone reward (₹${m.threshold.toFixed(0)} lifetime)`,
                createdById: args.createdById,
                counters: { totalEarned: { increment: m.bonusPoints } },
                rates: args.rates,
            });
            awarded.push({ milestoneId: m.id, points: m.bonusPoints, label: m.label });
        }
        // Auto-issue a single-use coupon cloned from the milestone's template.
        if (m.issuesCouponTemplateId != null) {
            const code = await issueMilestoneCoupon(tx, { templateId: m.issuesCouponTemplateId, accountId: args.accountId, milestoneId: m.id, createdById: args.createdById });
            if (code) issuedCouponCodes.push(code);
        }
    }

    if (newBalance === null) newBalance = await liveBalance(tx, args.accountId, args.rates);
    return { awarded, newBalance, issuedCouponCodes };
}

/// Manual admin adjustment. Positive → new lot; negative → consume in-window FIFO
/// (rejects if it would drive the balance negative).
export async function adjustPoints(
    tx: Tx,
    args: { accountId: number; delta: number; note: string | null; createdById: number; rates: LoyaltyRates },
): Promise<{ newBalance: number }> {
    await ensureAccount(tx, args.accountId);
    if (args.delta > 0) {
        await addLot(tx, { accountId: args.accountId, universalVoucherId: null, points: args.delta, earnedAt: new Date() });
    } else if (args.delta < 0) {
        const cutoff = expiryCutoff(new Date(), args.rates);
        const consumed = await consumeLotsFIFO(tx, args.accountId, -args.delta, cutoff);
        if (consumed < -args.delta) {
            throw new Error("Adjustment would drive the loyalty balance negative.");
        }
    } else {
        return { newBalance: await liveBalance(tx, args.accountId, args.rates) };
    }
    const newBalance = await postMovement(tx, {
        accountId: args.accountId,
        universalVoucherId: null,
        delta: args.delta,
        reason: "ADMIN_ADJUST",
        note: args.note,
        createdById: args.createdById,
        rates: args.rates,
    });
    return { newBalance };
}
