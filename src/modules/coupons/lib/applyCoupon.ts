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
    checkFreeGrantEligibility,
    computeCouponDiscount,
    freeGrantForCoupon,
    isFreeGrantCoupon,
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
        setPriceAmt: num(row.setPriceAmt),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        minBillValue: num(row.minBillValue),
        eligibility: row.eligibility,
        stackable: row.stackable,
        stackScope: row.stackScope,
        independent: row.independent,
        ownerAccountId: row.ownerAccountId,
        isActive: row.isActive,
        totalUsageLimit: row.totalUsageLimit,
        perCustomerLimit: row.perCustomerLimit,
        singleUse: row.singleUse,
        rules: row.rules.map((r) => ({
            kind: r.kind === "EXCLUDE" ? "EXCLUDE" : "INCLUDE",
            productId: r.productId, categoryId: r.categoryId, groupId: r.groupId, brandId: r.brandId,
        })),
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
        orderBy: { createdAt: "asc" },
    });
    return rows.map(toContext);
}

/// Every offer currently valid for the POS "Offers" panel: active, in-window
/// (startsAt/endsAt), POS-or-both channel — CODE and AUTO alike. Window-filtered
/// here so the panel never lists an offer that isn't actually claimable today.
export async function loadPosOffers(tx: Tx, now: Date): Promise<CouponContext[]> {
    const rows = await tx.coupon.findMany({
        where: {
            isActive: true,
            ...channelFilter("POS"),
            OR: [
                { startsAt: null },
                { startsAt: { lte: now } },
            ],
            AND: [
                { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
        },
        include: { rules: true },
        orderBy: { createdAt: "desc" },
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
    | { kind: "ok"; coupon: CouponContext; discountRupees: number }
    /// An independent FREE-GRANT coupon (FREE_ITEM / BOGO): not a ₹ discount —
    /// it adds the grant as zero-price lines on top. `grant` is the product +
    /// free units. The money-coupon slot hands this back and the free slot
    /// consumes it, so one code typed in either box ends up in the right place.
    | { kind: "free-grant"; coupon: CouponContext; grant: { productId: number; freeQty: number } };

/// The free-grant pipeline shared by the money selector (when a free-grant
/// code is typed there) and the dedicated free-coupon selector: eligibility
/// (window / min-bill / owner / new-vs-returning — no "eligible lines" check,
/// the grant adds its own line), usage limits, then the buy-side-unlocked grant.
/// `protectedProductIds` is the discount-protection blacklist (loaded once by
/// the caller); a protected grant product refuses the offer.
async function selectFreeGrant(
    tx: Tx,
    args: { c: CouponContext; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "free-grant" }>> {
    const { c, input, protectedProductIds } = args;
    const gate = checkFreeGrantEligibility(c, input);
    if (!gate.ok) return { kind: "error", reason: gate.reason };
    const usage = await checkCouponUsage(tx, c, input.accountId);
    if (!usage.ok) return { kind: "error", reason: usage.reason };
    const grant = freeGrantForCoupon(c, input.lines);
    if (!grant) return { kind: "error", reason: "Buy more to unlock the offer" };
    // Discount-protection blacklist: never give away a protected product.
    if (protectedProductIds?.has(grant.productId)) {
        return { kind: "error", reason: "Coupon is not applicable on this bill" };
    }
    // Cross-item BOGO: a protected BUY item can't unlock the offer either
    // (the buy line is in the cart, so its line-level `protected` flag is set).
    if (c.type === "BOGO" && c.buyProductId != null && grant.productId !== c.buyProductId) {
        const buyLine = input.lines.find((l) => l.productId === c.buyProductId);
        if (buyLine?.protected) return { kind: "error", reason: "Coupon is not applicable on this bill" };
    }
    return { kind: "free-grant", coupon: c, grant };
}

/// Dedicated selector for the free-grant coupon slot (the cashier's "Free
/// items" affordance). Resolves a code to an independent FREE_ITEM / BOGO
/// coupon, runs eligibility + usage + the buy-side check, and returns the
/// grant. Mirrors selectCouponForCart's split so the validated grant and the
/// posted grant are identical.
export async function selectFreeGrantCoupon(
    tx: Tx,
    args: { code: string; channel: CouponChannel; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "free-grant" }>> {
    const c = await resolveCouponByCode(tx, args.code, args.channel);
    if (!c) return { kind: "error", reason: "Invalid coupon code" };
    if (!isFreeGrantCoupon(c)) {
        return { kind: "error", reason: "This coupon gives a ₹ discount — apply it in the Coupon code box" };
    }
    return selectFreeGrant(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
}

/// Pick the best eligible AUTO free-grant coupon (independent FREE_ITEM / BOGO)
/// for the cart — the free-grant analogue of the money auto-apply path. Free
/// grants have no ₹ to compare, so "best" is simply the first eligible in
/// creation order. Runs eligibility + usage + the buy-side gate and returns the
/// grant, so a no-code AUTO freebie fires on its own the moment the cart
/// qualifies. Used by the POS freeAutoApply slot (coupon-validate + sale) — the
/// sale route re-derives the grant from the cart, so a stale client state can't
/// drop it off the invoice.
export async function selectAutoFreeGrant(
    tx: Tx,
    args: { channel: CouponChannel; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "free-grant" } | { kind: "none" }>> {
    const candidates = await loadAutoCoupons(tx, args.channel);
    for (const c of candidates) {
        if (!isFreeGrantCoupon(c)) continue;
        const sel = await selectFreeGrant(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
        if (sel.kind === "free-grant") return sel;
    }
    return { kind: "none" };
}

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
        // An independent free-grant coupon isn't a ₹ discount — hand it to the
        // free slot (the caller routes `free-grant` there; the POS applies the
        // free items instead of a money coupon).
        if (isFreeGrantCoupon(c)) return selectFreeGrant(tx, { c, input });
        const usage = await checkCouponUsage(tx, c, input.accountId);
        if (!usage.ok) return { kind: "error", reason: usage.reason };
        const res = computeCouponDiscount(c, input);
        if (!res.ok) return { kind: "error", reason: res.reason };
        return { kind: "ok", coupon: c, discountRupees: res.discountRupees };
    }

    // Auto-apply path — silently pick the best-value usable AUTO coupon.
    // Independent free-grant coupons are skipped here: they don't reduce the
    // bill, so they'd never win a ₹ comparison (and silently mutating the cart
    // with free lines would surprise the cashier).
    if (autoApply) {
        const candidates = await loadAutoCoupons(tx, channel);
        let best: { coupon: CouponContext; discountRupees: number } | null = null;
        for (const c of candidates) {
            if (isFreeGrantCoupon(c)) continue;
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
    args: { couponId: number; accountId: number | null; universalVoucherId: number; amount: number; channel: CouponChannel },
): Promise<void> {
    await tx.couponRedemption.create({
        data: { couponId: args.couponId, accountId: args.accountId, universalVoucherId: args.universalVoucherId, amount: args.amount, channel: args.channel },
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
            buyProductId: t.buyProductId, buyQty: t.buyQty, getQty: t.getQty, setPriceAmt: t.setPriceAmt,
            startsAt: t.startsAt, endsAt: t.endsAt, minBillValue: t.minBillValue,
            eligibility: t.eligibility, stackable: t.stackable, stackScope: t.stackScope,
            independent: t.independent,
            ownerAccountId: args.accountId, singleUse: true, totalUsageLimit: 1,
            issuedByMilestoneId: args.milestoneId, isActive: true, createdById: args.createdById,
            rules: t.rules.length
                ? { create: t.rules.map((r) => ({ kind: r.kind, productId: r.productId, categoryId: r.categoryId, groupId: r.groupId, brandId: r.brandId })) }
                : undefined,
        },
    });
    return code;
}

/// Free the usage slot(s) on a FULL return (returnFraction ≥ 1). Partial returns
/// keep the coupon "used". No GL effect — the credit note already reverses goods.
export async function reverseCouponRedemption(
    tx: Tx,
    args: { originalUniversalVoucherId: number | null; returnFraction: number },
): Promise<{ reversed: number }> {
    if (args.returnFraction < 0.999 || args.originalUniversalVoucherId == null) return { reversed: 0 };
    const res = await tx.couponRedemption.updateMany({
        where: { universalVoucherId: args.originalUniversalVoucherId, reversedAt: null },
        data: { reversedAt: new Date() },
    });
    return { reversed: res.count };
}
