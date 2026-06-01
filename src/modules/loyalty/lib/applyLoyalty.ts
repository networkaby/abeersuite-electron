// Transaction-aware loyalty mutations. Every function here MUST run inside the
// caller's prisma.$transaction so points move atomically with the sale / return.
//
// Lots are the source of truth for the balance; LoyaltyAccount.pointsBalance is
// a cached mirror recomputed from active lots after every movement. LoyaltyLedger
// is the immutable audit trail (one row per movement).

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
    earnableBaseForCart,
    pointsForBase,
    type EarnLine,
    type LoyaltyRates,
    type RulesIndex,
    type TaxonomyMaps,
} from "./loyaltyMath";

type Tx = Prisma.TransactionClient | PrismaClient;

/// Upsert the wallet header so subsequent updates have a row to hit.
async function ensureAccount(tx: Tx, accountId: number): Promise<void> {
    await tx.loyaltyAccount.upsert({
        where: { accountId },
        create: { accountId },
        update: {},
    });
}

/// Σ of active lot remaining points — the authoritative balance.
async function recomputeBalance(tx: Tx, accountId: number): Promise<number> {
    const agg = await tx.loyaltyLot.aggregate({
        where: { accountId, status: "ACTIVE" },
        _sum: { pointsRemaining: true },
    });
    return agg._sum.pointsRemaining ?? 0;
}

function addMonths(base: Date, months: number): Date {
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    return d;
}

async function addLot(
    tx: Tx,
    args: { accountId: number; voucherId: number | null; points: number; earnedAt: Date; expiryMonths: number },
): Promise<void> {
    await tx.loyaltyLot.create({
        data: {
            accountId: args.accountId,
            voucherId: args.voucherId,
            pointsEarned: args.points,
            pointsRemaining: args.points,
            earnedAt: args.earnedAt,
            expiresAt: addMonths(args.earnedAt, args.expiryMonths),
            status: "ACTIVE",
        },
    });
}

/// Consume `points` from ACTIVE lots, oldest expiry first. Returns the amount
/// actually consumed (≤ available — never goes negative).
async function consumeLotsFIFO(tx: Tx, accountId: number, points: number): Promise<number> {
    if (points <= 0) return 0;
    const lots = await tx.loyaltyLot.findMany({
        where: { accountId, status: "ACTIVE", pointsRemaining: { gt: 0 } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
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

/// Recompute the cached balance, update counters, and append a ledger row.
async function postMovement(
    tx: Tx,
    args: {
        accountId: number;
        voucherId: number | null;
        delta: number;
        reason: "EARN_SALE" | "REDEEM_SALE" | "REVERSAL_RETURN" | "ADMIN_ADJUST" | "EXPIRY";
        note?: string | null;
        createdById: number;
        counters?: Prisma.LoyaltyAccountUpdateInput;
    },
): Promise<number> {
    const balanceAfter = await recomputeBalance(tx, args.accountId);
    await tx.loyaltyAccount.update({
        where: { accountId: args.accountId },
        data: { pointsBalance: balanceAfter, ...(args.counters ?? {}) },
    });
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
    rates: LoyaltyRates;
    rulesIndex: RulesIndex;
    taxonomyMaps: TaxonomyMaps;
    createdById: number;
};

/// Redeem (consume oldest lots) then earn (new lot) for a single sale.
export async function applyLoyaltyForSale(
    tx: Tx,
    args: ApplySaleArgs,
): Promise<{ pointsEarned: number; pointsRedeemed: number; newBalance: number }> {
    await ensureAccount(tx, args.accountId);

    let pointsRedeemed = 0;
    let newBalance: number | null = null;

    if (args.redeemPoints > 0) {
        pointsRedeemed = await consumeLotsFIFO(tx, args.accountId, args.redeemPoints);
        newBalance = await postMovement(tx, {
            accountId: args.accountId,
            voucherId: args.voucherId,
            delta: -pointsRedeemed,
            reason: "REDEEM_SALE",
            createdById: args.createdById,
            counters: { totalRedeemed: { increment: pointsRedeemed } },
        });
    }

    const base = earnableBaseForCart(args.earnLines, args.combinedDiscount, args.rulesIndex, args.taxonomyMaps);
    const pointsEarned = pointsForBase(base, args.rates);
    if (pointsEarned > 0) {
        await addLot(tx, {
            accountId: args.accountId,
            voucherId: args.voucherId,
            points: pointsEarned,
            earnedAt: new Date(),
            expiryMonths: args.rates.expiryMonths,
        });
        newBalance = await postMovement(tx, {
            accountId: args.accountId,
            voucherId: args.voucherId,
            delta: pointsEarned,
            reason: "EARN_SALE",
            createdById: args.createdById,
            counters: { totalEarned: { increment: pointsEarned } },
        });
    }

    if (newBalance === null) newBalance = await recomputeBalance(tx, args.accountId);
    return { pointsEarned, pointsRedeemed, newBalance };
}

export type ReverseReturnArgs = {
    accountId: number;
    originalVoucherId: number;
    returnVoucherId: number;
    /// returnedGoods / originalGoods, clamped 0..1 by the caller.
    returnFraction: number;
    expiryMonths: number;
    createdById: number;
};

/// Reverse loyalty on a SALE_RETURN: claw back earned points (proportional, capped
/// at the original earn lot's remaining), restore redeemed points (proportional,
/// as a fresh lot, capped at the original redeem net of prior restores).
/// Returns null when the original sale had no loyalty activity (skip silently).
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
                where: { accountId: args.accountId, voucherId: args.originalVoucherId, status: "ACTIVE" },
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
            await addLot(tx, {
                accountId: args.accountId,
                voucherId: args.returnVoucherId,
                points: target,
                earnedAt: new Date(),
                expiryMonths: args.expiryMonths,
            });
            pointsRestored = target;
            newBalance = await postMovement(tx, {
                accountId: args.accountId,
                voucherId: args.returnVoucherId,
                delta: target,
                reason: "REVERSAL_RETURN",
                note: `Restore of points redeemed on sale #${args.originalVoucherId}`,
                createdById: args.createdById,
                counters: { totalRedeemed: { increment: -target } },
            });
        }
    }

    if (newBalance === null) newBalance = await recomputeBalance(tx, args.accountId);
    return { pointsClawedBack, pointsRestored, newBalance };
}

/// Manual admin adjustment. Positive → new lot; negative → consume FIFO (rejects
/// if it would drive the balance negative). Does not touch the sale counters.
export async function adjustPoints(
    tx: Tx,
    args: { accountId: number; delta: number; note: string | null; createdById: number; expiryMonths: number },
): Promise<{ newBalance: number }> {
    await ensureAccount(tx, args.accountId);
    if (args.delta > 0) {
        await addLot(tx, {
            accountId: args.accountId,
            voucherId: null,
            points: args.delta,
            earnedAt: new Date(),
            expiryMonths: args.expiryMonths,
        });
    } else if (args.delta < 0) {
        const consumed = await consumeLotsFIFO(tx, args.accountId, -args.delta);
        if (consumed < -args.delta) {
            throw new Error("Adjustment would drive the loyalty balance negative.");
        }
    } else {
        return { newBalance: await recomputeBalance(tx, args.accountId) };
    }
    const newBalance = await postMovement(tx, {
        accountId: args.accountId,
        voucherId: null,
        delta: args.delta,
        reason: "ADMIN_ADJUST",
        note: args.note,
        createdById: args.createdById,
    });
    return { newBalance };
}

/// Expire all ACTIVE lots past their expiry. Posts one EXPIRY ledger row per
/// affected account. `createdById` is the system/admin user attributed to the run.
export async function expireLots(
    tx: Tx,
    args: { now: Date; createdById: number },
): Promise<{ accountsAffected: number; pointsExpired: number }> {
    const due = await tx.loyaltyLot.findMany({
        where: { status: "ACTIVE", pointsRemaining: { gt: 0 }, expiresAt: { lt: args.now } },
        select: { id: true, accountId: true, pointsRemaining: true },
    });
    if (due.length === 0) return { accountsAffected: 0, pointsExpired: 0 };

    const byAccount = new Map<number, number>();
    for (const lot of due) {
        await tx.loyaltyLot.update({ where: { id: lot.id }, data: { status: "EXPIRED", pointsRemaining: 0 } });
        byAccount.set(lot.accountId, (byAccount.get(lot.accountId) ?? 0) + lot.pointsRemaining);
    }

    let pointsExpired = 0;
    for (const [accountId, pts] of byAccount) {
        pointsExpired += pts;
        await postMovement(tx, {
            accountId,
            voucherId: null,
            delta: -pts,
            reason: "EXPIRY",
            note: "Points expired",
            createdById: args.createdById,
            counters: { totalExpired: { increment: pts } },
        });
    }
    return { accountsAffected: byAccount.size, pointsExpired };
}
