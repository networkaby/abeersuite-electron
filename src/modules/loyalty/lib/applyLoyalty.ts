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
    args: { accountId: number; voucherId: number | null; points: number; earnedAt: Date },
): Promise<void> {
    await tx.loyaltyLot.create({
        data: {
            accountId: args.accountId,
            voucherId: args.voucherId,
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
        voucherId: number | null;
        delta: number;
        reason: "EARN_SALE" | "REDEEM_SALE" | "REVERSAL_RETURN" | "ADMIN_ADJUST";
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
            voucherId: args.voucherId,
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
    voucherId: number;
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
            voucherId: args.voucherId,
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
        await addLot(tx, { accountId: args.accountId, voucherId: args.voucherId, points: pointsEarned, earnedAt: new Date() });
        newBalance = await postMovement(tx, {
            accountId: args.accountId,
            voucherId: args.voucherId,
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
    originalVoucherId: number;
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
    const rows = await tx.loyaltyLedger.findMany({
        where: { voucherId: args.originalVoucherId, reason: { in: ["EARN_SALE", "REDEEM_SALE"] } },
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
                where: { accountId: args.accountId, voucherId: args.originalVoucherId },
                orderBy: { id: "asc" },
                select: { id: true, pointsRemaining: true },
            });
            const claw = Math.min(target, lot?.pointsRemaining ?? 0);
            if (lot && claw > 0) {
                await tx.loyaltyLot.update({ where: { id: lot.id }, data: { pointsRemaining: lot.pointsRemaining - claw } });
                pointsClawedBack = claw;
                newBalance = await postMovement(tx, {
                    accountId: args.accountId,
                    voucherId: args.returnVoucherId,
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
        const priorReturns = await tx.invVoucher.findMany({
            where: { refVoucherId: args.originalVoucherId, type: "SALE_RETURN", id: { not: args.returnVoucherId } },
            select: { id: true },
        });
        let alreadyRestored = 0;
        if (priorReturns.length > 0) {
            const agg = await tx.loyaltyLedger.aggregate({
                where: { voucherId: { in: priorReturns.map((v) => v.id) }, reason: "REVERSAL_RETURN", delta: { gt: 0 } },
                _sum: { delta: true },
            });
            alreadyRestored = agg._sum.delta ?? 0;
        }
        const target = Math.min(Math.round(originalRedeem * fraction), originalRedeem - alreadyRestored);
        if (target > 0) {
            await addLot(tx, { accountId: args.accountId, voucherId: args.returnVoucherId, points: target, earnedAt: new Date() });
            pointsRestored = target;
            newBalance = await postMovement(tx, {
                accountId: args.accountId,
                voucherId: args.returnVoucherId,
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

/// Manual admin adjustment. Positive → new lot; negative → consume in-window FIFO
/// (rejects if it would drive the balance negative).
export async function adjustPoints(
    tx: Tx,
    args: { accountId: number; delta: number; note: string | null; createdById: number; rates: LoyaltyRates },
): Promise<{ newBalance: number }> {
    await ensureAccount(tx, args.accountId);
    if (args.delta > 0) {
        await addLot(tx, { accountId: args.accountId, voucherId: null, points: args.delta, earnedAt: new Date() });
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
        voucherId: null,
        delta: args.delta,
        reason: "ADMIN_ADJUST",
        note: args.note,
        createdById: args.createdById,
        rates: args.rates,
    });
    return { newBalance };
}
