// Transaction-aware coupon helpers. Resolution + usage checks read the DB; the
// recording/reversal mutations MUST run inside the caller's $transaction so the
// redemption log moves atomically with the sale / return.
//
// `selectCouponForCart` is the single entry point shared by /api/pos/sale and
// /api/pos/coupon-validate, so the validated ₹ and the posted ₹ are identical.

import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
    checkCouponEligibility,
    computeCouponDiscount,
    type CouponChannel,
    type CouponContext,
    type EvalInput,
} from "./couponMath";

type Tx = Prisma.TransactionClient | PrismaClient;

const num = (d: Prisma.Decimal | number | null): number | null => (d == null ? null : Number(d));

/// Narrow a Prisma Coupon row (+ rules) to the pure-engine CouponContext.
type CouponRow = Prisma.CouponGetPayload<{ include: { rules: true } }>;
function toContext(row: CouponRow): CouponContext {
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        channels: row.channels,
        applyMode: row.applyMode,
        percentOff: num(row.percentOff),
        maxDiscountAmt: num(row.maxDiscountAmt),
        flatAmt: num(row.flatAmt),
        freeProductId: row.freeProductId,
        freeQty: num(row.freeQty),
        freeDiscountPct: num(row.freeDiscountPct),
        buyProductId: row.buyProductId,
        buyQty: num(row.buyQty),
        getQty: num(row.getQty),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        minBillValue: num(row.minBillValue),
        eligibility: row.eligibility,
        stackable: row.stackable,
        ownerAccountId: row.ownerAccountId,
        isActive: row.isActive,
        totalUsageLimit: row.totalUsageLimit,
        perCustomerLimit: row.perCustomerLimit,
        singleUse: row.singleUse,
        rules: row.rules.map((r) => ({ kind: r.kind === "EXCLUDE" ? "EXCLUDE" : "INCLUDE", productId: r.productId, categoryId: r.categoryId })),
    };
}

const channelFilter = (channel: CouponChannel) => ({ channels: { in: [channel, "BOTH"] as CouponChannel[] } });

/// Resolve a typed code to a live coupon for this channel (case-insensitive). null if not found.
export async function resolveCouponByCode(tx: Tx, code: string, channel: CouponChannel): Promise<CouponContext | null> {
    const row = await tx.coupon.findFirst({
        where: { code: { equals: code.trim(), mode: "insensitive" }, isActive: true, ...channelFilter(channel) },
        include: { rules: true },
    });
    return row ? toContext(row) : null;
}

/// All live AUTO coupons for this channel (Phase 2 auto-apply candidates).
export async function loadAutoCoupons(tx: Tx, channel: CouponChannel): Promise<CouponContext[]> {
    const rows = await tx.coupon.findMany({
        where: { applyMode: "AUTO", isActive: true, ...channelFilter(channel) },
        include: { rules: true },
    });
    return rows.map(toContext);
}

/// Usage-limit + per-customer-limit gate (reads the redemption log; excludes reversed rows).
export async function checkCouponUsage(
    tx: Tx, c: CouponContext, accountId: number | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (c.totalUsageLimit != null) {
        const used = await tx.couponRedemption.count({ where: { couponId: c.id, reversedAt: null } });
        if (used >= c.totalUsageLimit) return { ok: false, reason: "Coupon usage limit reached" };
    }
    if (c.perCustomerLimit != null) {
        if (accountId == null) return { ok: false, reason: "Coupon needs an identified customer" };
        const usedByCust = await tx.couponRedemption.count({ where: { couponId: c.id, accountId, reversedAt: null } });
        if (usedByCust >= c.perCustomerLimit) return { ok: false, reason: "You have already used this coupon" };
    }
    return { ok: true };
}

export type CouponSelection =
    | { kind: "none" }
    | { kind: "error"; reason: string }
    | { kind: "ok"; coupon: CouponContext; discountRupees: number };

/// THE shared selector. Resolves a code (or picks the best AUTO coupon), runs the
/// full eligibility + usage + value pipeline, and returns the winning coupon + ₹.
export async function selectCouponForCart(
    tx: Tx,
    args: { code?: string | null; autoApply?: boolean; channel: CouponChannel; input: EvalInput },
): Promise<CouponSelection> {
    const { code, autoApply, channel, input } = args;

    // Explicit code path — surface a precise rejection reason to the cashier.
    if (code && code.trim()) {
        const c = await resolveCouponByCode(tx, code, channel);
        if (!c) return { kind: "error", reason: "Invalid coupon code" };
        const usage = await checkCouponUsage(tx, c, input.accountId);
        if (!usage.ok) return { kind: "error", reason: usage.reason };
        const res = computeCouponDiscount(c, input);
        if (!res.ok) return { kind: "error", reason: res.reason };
        return { kind: "ok", coupon: c, discountRupees: res.discountRupees };
    }

    // Auto-apply path — silently pick the best-value usable AUTO coupon.
    if (autoApply) {
        const candidates = await loadAutoCoupons(tx, channel);
        let best: { coupon: CouponContext; discountRupees: number } | null = null;
        for (const c of candidates) {
            if (!checkCouponEligibility(c, input).ok) continue;
            if (!(await checkCouponUsage(tx, c, input.accountId)).ok) continue;
            const res = computeCouponDiscount(c, input);
            if (!res.ok) continue;
            if (!best || res.discountRupees > best.discountRupees) best = { coupon: c, discountRupees: res.discountRupees };
        }
        return best ? { kind: "ok", ...best } : { kind: "none" };
    }

    return { kind: "none" };
}

/// Record a redemption inside the sale tx.
export async function recordCouponRedemption(
    tx: Tx,
    args: { couponId: number; accountId: number | null; voucherId: number; amount: number; channel: CouponChannel },
): Promise<void> {
    await tx.couponRedemption.create({
        data: { couponId: args.couponId, accountId: args.accountId, voucherId: args.voucherId, amount: args.amount, channel: args.channel },
    });
}

/// Clone an inactive template coupon into a LIVE, single-use, owner-bound coupon
/// when a loyalty milestone is crossed. Returns the generated code (or null if the
/// template is missing). Runs inside the sale tx.
export async function issueMilestoneCoupon(
    tx: Tx,
    args: { templateId: number; accountId: number; milestoneId: number; createdById: number },
): Promise<string | null> {
    const t = await tx.coupon.findUnique({ where: { id: args.templateId }, include: { rules: true } });
    if (!t) return null;
    const code = `MS-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    await tx.coupon.create({
        data: {
            code, name: t.name, description: t.description, type: t.type, channels: t.channels, applyMode: "CODE",
            percentOff: t.percentOff, maxDiscountAmt: t.maxDiscountAmt, flatAmt: t.flatAmt,
            freeProductId: t.freeProductId, freeQty: t.freeQty, freeDiscountPct: t.freeDiscountPct,
            buyProductId: t.buyProductId, buyQty: t.buyQty, getQty: t.getQty,
            startsAt: t.startsAt, endsAt: t.endsAt, minBillValue: t.minBillValue,
            eligibility: t.eligibility, stackable: t.stackable,
            ownerAccountId: args.accountId, singleUse: true, totalUsageLimit: 1,
            issuedByMilestoneId: args.milestoneId, isActive: true, createdById: args.createdById,
            rules: t.rules.length ? { create: t.rules.map((r) => ({ kind: r.kind, productId: r.productId, categoryId: r.categoryId })) } : undefined,
        },
    });
    return code;
}

/// Free the usage slot(s) on a FULL return (returnFraction ≥ 1). Partial returns
/// keep the coupon "used". No GL effect — the credit note already reverses goods.
export async function reverseCouponRedemption(
    tx: Tx,
    args: { originalVoucherId: number; returnFraction: number },
): Promise<{ reversed: number }> {
    if (args.returnFraction < 0.999) return { reversed: 0 };
    const res = await tx.couponRedemption.updateMany({
        where: { voucherId: args.originalVoucherId, reversedAt: null },
        data: { reversedAt: new Date() },
    });
    return { reversed: res.count };
}
