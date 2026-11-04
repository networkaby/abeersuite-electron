// Transaction-aware coupon helpers. Resolution + usage checks read the DB; the
// recording/reversal mutations MUST run inside the caller's $transaction so the
// redemption log moves atomically with the sale / return.
//
// `selectCouponForCart` is the single entry point shared by /api/pos/sale and
// /api/pos/coupon-validate, so the validated ₹ and the posted ₹ are identical.

import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { round2 } from "@/shared/lib/format/moneyInr";
import {
    checkCouponEligibility,
    checkFreeGrantEligibility,
    computeCouponDiscount,
    computeOnTopPartial,
    freeGrantForCoupon,
    isFreeGrantCoupon,
    isIndependentFreeItem,
    isMoneyGrantCoupon,
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
        isPrivate: row.isPrivate,
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
        where: { applyMode: "AUTO", isActive: true, isPrivate: false, ...channelFilter(channel) },
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
            // Private coupons are never listed — staff type the code like anyone else.
            isPrivate: false,
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
    /// Rule 3 — a NON-independent fully-free FREE_ITEM / BOGO coupon WON the
    /// MONEY slot: its item is granted as zero-price lines (auto-added, need
    /// not be in the cart) with money-slot semantics — the exclusivity mask
    /// still applies and it is the one non-independent coupon on the bill.
    | { kind: "money-grant"; coupon: CouponContext; grant: { productId: number; freeQty: number } }
    /// Rule 1 — an independent FREE-GRANT coupon (FREE_ITEM / BOGO, fully
    /// free): not a ₹ discount — it adds the grant as zero-price lines ON TOP.
    /// `grant` is the product + free units. The money-coupon slot hands this
    /// back and the free slot consumes it, so one code typed in either box
    /// ends up in the right place.
    | { kind: "free-grant"; coupon: CouponContext; grant: { productId: number; freeQty: number } }
    /// Rule 2 — an independent PARTIAL (<100%) FREE_ITEM / BOGO coupon: a ₹
    /// discount on its item (once in the cart), ON TOP of the money coupon —
    /// never competes for the money slot, never drops tier / blocks loyalty /
    /// hits the guard.
    | { kind: "on-top"; coupon: CouponContext; discountRupees: number };

/// The on-top slot selector — resolves a code to an INDEPENDENT FREE_ITEM /
/// BOGO coupon and returns its on-top effect: fully free → the grant (zero-
/// price lines, rule 1), partial → the on-top ₹ (rule 2). A non-independent
/// coupon is rejected here — it belongs to the money slot (the Coupon code
/// box). Mirrors selectCouponForCart's split so the validated grant/₹ and the
/// posted grant/₹ are identical.
export async function selectOnTopCouponByCode(
    tx: Tx,
    args: { code: string; channel: CouponChannel; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "free-grant" } | { kind: "on-top" }>> {
    const c = await resolveCouponByCode(tx, args.code, args.channel);
    if (!c) return { kind: "error", reason: "Invalid coupon code" };
    if (!isIndependentFreeItem(c)) {
        return { kind: "error", reason: "This coupon gives a ₹ discount — apply it in the Coupon code box" };
    }
    return selectOnTop(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
}

/// Force-apply a SPECIFIC coupon by id — AUTO coupons carry no code, so the
/// POS "Apply" button on an AUTO offer card resolves them this way. Runs the
/// same pipeline as a typed code: channel, eligibility, usage limits, and the
/// free-grant route when the coupon is an independent FREE_ITEM / BOGO.
export async function selectCouponForCartById(
    tx: Tx,
    args: { couponId: number; channel: CouponChannel; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<CouponSelection> {
    const row = await tx.coupon.findUnique({ where: { id: args.couponId }, include: { rules: true } });
    if (!row || !row.isActive) return { kind: "error", reason: "Coupon not found or inactive" };
    const c = toContext(row);
    if (![args.channel, "BOTH"].includes(c.channels)) return { kind: "error", reason: "Coupon is not usable here" };
    // Independent FREE_ITEM / BOGO — the on-top slot (rules 1-2), never the
    // money slot.
    if (isIndependentFreeItem(c)) {
        return selectOnTop(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
    }
    // Rule 3 — a non-independent fully-free FREE_ITEM / BOGO grants when it
    // wins the money slot.
    if (isMoneyGrantCoupon(c)) {
        return selectMoneyGrant(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
    }
    const usage = await checkCouponUsage(tx, c, args.input.accountId);
    if (!usage.ok) return { kind: "error", reason: usage.reason };
    const res = computeCouponDiscount(c, args.input);
    if (!res.ok) return { kind: "error", reason: res.reason };
    return { kind: "ok", coupon: c, discountRupees: res.discountRupees };
}

/// Pick the best eligible AUTO on-top coupon (independent FREE_ITEM / BOGO) for
/// the cart — the on-top analogue of the money auto-apply path. Pass 1: fully-
/// free grants (no ₹ to compare, so the first eligible in creation order wins).
/// Pass 2: independent partials — the one with the largest on-top ₹. Runs
/// eligibility + usage + the buy-side gate, so a no-code AUTO freebie fires on
/// its own the moment the cart qualifies. Used by the POS freeAutoApply slot
/// (coupon-validate + sale) and the shop — the sale route re-derives the
/// grant/₹ from the cart, so a stale client state can't drop it off the
/// invoice.
export async function selectAutoOnTopCoupon(
    tx: Tx,
    args: { channel: CouponChannel; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "free-grant" } | { kind: "on-top" } | { kind: "none" }>> {
    const candidates = await loadAutoCoupons(tx, args.channel);
    // Pass 1 — fully-free grants, first eligible in creation order.
    for (const c of candidates) {
        if (!isFreeGrantCoupon(c)) continue;
        const sel = await selectOnTop(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
        if (sel.kind === "free-grant") return sel;
    }
    // Pass 2 — independent partials, best ₹ value.
    let best: Extract<CouponSelection, { kind: "on-top" }> | null = null;
    for (const c of candidates) {
        if (!isIndependentFreeItem(c) || isFreeGrantCoupon(c)) continue;
        const sel = await selectOnTop(tx, { c, input: args.input, protectedProductIds: args.protectedProductIds });
        if (sel.kind === "on-top" && (!best || sel.discountRupees > best.discountRupees)) best = sel;
    }
    return best ?? { kind: "none" };
}

/// Estimate the customer-facing ₹ a grant is worth on the current cart — the
/// grant item's unit price (its cart line when present, else the product's
/// effective sale price) × freeQty. Used only to rank AUTO money-slot
/// candidates (rule 3) against ₹ coupons.
async function grantValueRupees(tx: Tx, input: EvalInput, grant: { productId: number; freeQty: number }): Promise<number> {
    const line = input.lines.find((l) => l.productId === grant.productId);
    if (line) return round2(line.unitPrice * grant.freeQty);
    const p = await tx.invProduct.findUnique({ where: { id: grant.productId }, select: { effectiveSalePricePaise: true } });
    return round2(((p?.effectiveSalePricePaise ?? 0) / 100) * grant.freeQty);
}

/// Rule 3 money-slot grant path — a non-independent fully-free FREE_ITEM / BOGO
/// coupon: gate + usage + the buy-side-unlocked grant. The item need NOT be in
/// the cart — the coupon adds it as a zero-price line when it wins.
async function selectMoneyGrant(
    tx: Tx,
    args: { c: CouponContext; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "money-grant" }>> {
    const { c, input, protectedProductIds } = args;
    const gate = checkFreeGrantEligibility(c, input);
    if (!gate.ok) return { kind: "error", reason: gate.reason };
    const usage = await checkCouponUsage(tx, c, input.accountId);
    if (!usage.ok) return { kind: "error", reason: usage.reason };
    const grant = freeGrantForCoupon(c, input.lines);
    if (!grant) return { kind: "error", reason: "Buy more to unlock the offer" };
    if (protectedProductIds?.has(grant.productId)) {
        return { kind: "error", reason: "Coupon is not applicable on this bill" };
    }
    // Cross-item BOGO: a protected BUY item can't unlock the offer either.
    if (c.type === "BOGO" && c.buyProductId != null && grant.productId !== c.buyProductId) {
        const buyLine = input.lines.find((l) => l.productId === c.buyProductId);
        if (buyLine?.protected) return { kind: "error", reason: "Coupon is not applicable on this bill" };
    }
    return { kind: "money-grant", coupon: c, grant };
}

/// Route an INDEPENDENT FREE_ITEM / BOGO coupon to the on-top slot: fully free
/// → the grant (rule 1); partial → the on-top ₹ (rule 2). Shared by the
/// dedicated on-top selectors and the money selector (a code typed in the
/// Coupon box that turns out independent lands here too).
async function selectOnTop(
    tx: Tx,
    args: { c: CouponContext; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<Extract<CouponSelection, { kind: "error" } | { kind: "free-grant" } | { kind: "on-top" }>> {
    const { c, input, protectedProductIds } = args;
    const gate = checkFreeGrantEligibility(c, input);
    if (!gate.ok) return { kind: "error", reason: gate.reason };
    const usage = await checkCouponUsage(tx, c, input.accountId);
    if (!usage.ok) return { kind: "error", reason: usage.reason };
    if (isFreeGrantCoupon(c)) {
        const grant = freeGrantForCoupon(c, input.lines);
        if (!grant) return { kind: "error", reason: "Buy more to unlock the offer" };
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
    const res = computeOnTopPartial(c, input);
    if (!res.ok) return { kind: "error", reason: res.reason };
    return { kind: "on-top", coupon: c, discountRupees: res.discountRupees };
}

/// THE shared selector. Resolves a code (or picks the best AUTO coupon), runs the
/// full eligibility + usage + value pipeline, and returns the winning coupon + ₹.
/// Slots: independent FREE_ITEM / BOGO coupons never enter the money slot (they
/// return `free-grant` / `on-top` for the on-top slot); a non-independent
/// fully-free FREE_ITEM / BOGO that wins returns `money-grant` (grant-style
/// posting with money semantics).
export async function selectCouponForCart(
    tx: Tx,
    args: { code?: string | null; autoApply?: boolean; channel: CouponChannel; input: EvalInput; protectedProductIds?: Set<number> },
): Promise<CouponSelection> {
    const { code, autoApply, channel, input, protectedProductIds } = args;

    // Explicit code path — surface a precise rejection reason to the cashier.
    if (code && code.trim()) {
        const c = await resolveCouponByCode(tx, code, channel);
        if (!c) return { kind: "error", reason: "Invalid coupon code" };
        // Independent FREE_ITEM / BOGO (rules 1-2) — never the money slot:
        // fully free → grant lines on top; partial → ₹ on top.
        if (isIndependentFreeItem(c)) return selectOnTop(tx, { c, input, protectedProductIds });
        // Rule 3 — a non-independent fully-free FREE_ITEM / BOGO grants its
        // item as free lines when it wins the money slot (the item need not be
        // in the cart — the coupon adds it).
        if (isMoneyGrantCoupon(c)) return selectMoneyGrant(tx, { c, input, protectedProductIds });
        const usage = await checkCouponUsage(tx, c, input.accountId);
        if (!usage.ok) return { kind: "error", reason: usage.reason };
        const res = computeCouponDiscount(c, input);
        if (!res.ok) return { kind: "error", reason: res.reason };
        return { kind: "ok", coupon: c, discountRupees: res.discountRupees };
    }

    // Auto-apply path — silently pick the best-value usable AUTO coupon.
    // Independent FREE_ITEM / BOGO coupons are skipped here entirely: they live
    // in the on-top slot (selectAutoOnTopCoupon), never competing for the money
    // slot. A non-independent fully-free FREE_ITEM / BOGO competes as a grant
    // (rule 3) — ranked by its item's worth.
    if (autoApply) {
        const candidates = await loadAutoCoupons(tx, channel);
        let best: { coupon: CouponContext; discountRupees: number; grant?: { productId: number; freeQty: number } } | null = null;
        for (const c of candidates) {
            if (isIndependentFreeItem(c)) continue;
            if (isMoneyGrantCoupon(c)) {
                const gate = checkFreeGrantEligibility(c, input);
                if (!gate.ok) continue;
                if (!(await checkCouponUsage(tx, c, input.accountId)).ok) continue;
                const grant = freeGrantForCoupon(c, input.lines);
                if (!grant) continue;
                if (protectedProductIds?.has(grant.productId)) continue;
                const value = await grantValueRupees(tx, input, grant);
                if (!best || value > best.discountRupees) best = { coupon: c, discountRupees: value, grant };
                continue;
            }
            if (!checkCouponEligibility(c, input).ok) continue;
            if (!(await checkCouponUsage(tx, c, input.accountId)).ok) continue;
            const res = computeCouponDiscount(c, input);
            if (!res.ok) continue;
            if (!best || res.discountRupees > best.discountRupees) best = { coupon: c, discountRupees: res.discountRupees };
        }
        if (!best) return { kind: "none" };
        if (best.grant) return { kind: "money-grant", coupon: best.coupon, grant: best.grant };
        return { kind: "ok", coupon: best.coupon, discountRupees: best.discountRupees };
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
            ownerAccountId: args.accountId, totalUsageLimit: 1,
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

/// Re-consume the usage slot a CANCEL freed — the mirror of
/// `reverseCouponRedemption`, used when a cancelled sale is restored.
///
/// The coupon's own limits are NOT re-checked: the slot belonged to this sale
/// before it was cancelled, so taking it back is restoring the truth, not a new
/// redemption. If the freed slot was meanwhile spent elsewhere the coupon ends up
/// over its limit and the office adjusts it — the restore never refuses.
export async function restoreCouponRedemption(
    tx: Tx,
    args: { originalUniversalVoucherId: number | null },
): Promise<{ restored: number }> {
    if (args.originalUniversalVoucherId == null) return { restored: 0 };
    const res = await tx.couponRedemption.updateMany({
        where: { universalVoucherId: args.originalUniversalVoucherId, reversedAt: { not: null } },
        data: { reversedAt: null },
    });
    return { restored: res.count };
}
