import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatRupees } from "@/shared/lib/format/moneyInr";

export type PortalCoupon = {
    id: number;
    /** Null for an offer that applies by itself at checkout. */
    code: string | null;
    title: string;
    /** What it gives, in words: "10% off up to ₹500", "₹200 off", "Free Mouse". */
    benefit: string;
    description: string | null;
    minBill: number | null;
    endsAt: string | null;
    /** Issued to this customer (a milestone reward, a personal code). */
    mine: boolean;
    /** Uses left for this profile, when the coupon has a per-customer limit. */
    usesLeft: number | null;
    /** "New customers only" / "Returning customers only", or null. */
    forWhom: string | null;
};

const num = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));

function benefitOf(c: {
    type: string;
    percentOff: { toString(): string } | null;
    maxDiscountAmt: { toString(): string } | null;
    flatAmt: { toString(): string } | null;
    setPriceAmt: { toString(): string } | null;
    freeDiscountPct: { toString(): string } | null;
    buyQty: { toString(): string } | null;
    getQty: { toString(): string } | null;
    freeProduct: { name: string } | null;
}): string {
    const cap = num(c.maxDiscountAmt);
    switch (c.type) {
        case "PERCENT":
            return `${num(c.percentOff) ?? 0}% off${cap ? ` up to ${formatRupees(cap)}` : ""}`;
        case "FLAT":
            return `${formatRupees(num(c.flatAmt) ?? 0)} off`;
        case "SET_PRICE":
            return `Special price ${formatRupees(num(c.setPriceAmt) ?? 0)}`;
        case "BOGO":
            return `Buy ${num(c.buyQty) ?? 1} get ${num(c.getQty) ?? 1}${c.freeProduct ? ` ${c.freeProduct.name}` : ""} free`;
        case "FREE_ITEM": {
            const pct = num(c.freeDiscountPct) ?? 100;
            const item = c.freeProduct?.name ?? "item";
            return pct >= 100 ? `Free ${item}` : `${pct}% off ${item}`;
        }
        default:
            return "Offer";
    }
}

async function compute(accountId: number): Promise<PortalCoupon[]> {
    const now = new Date();
    const rows = await prisma.coupon.findMany({
        where: {
            isActive: true,
            channels: { in: ["SHOP", "BOTH"] },
            AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                // Public offers, or ones issued to this profile. A private code is shared
                // by hand — never listed for everyone to see.
                { OR: [{ ownerAccountId: accountId }, { ownerAccountId: null, isPrivate: false }] },
            ],
        },
        orderBy: [{ endsAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        select: {
            id: true, code: true, name: true, description: true, type: true, applyMode: true,
            percentOff: true, maxDiscountAmt: true, flatAmt: true, setPriceAmt: true, freeDiscountPct: true,
            buyQty: true, getQty: true, freeProduct: { select: { name: true } },
            minBillValue: true, endsAt: true, ownerAccountId: true, eligibility: true,
            totalUsageLimit: true, perCustomerLimit: true,
        },
    });
    if (rows.length === 0) return [];

    // Redemptions (not reversed) — all of them for the total cap, this profile's for its own cap.
    const ids = rows.map((r) => r.id);
    const [total, mine] = await Promise.all([
        prisma.couponRedemption.groupBy({ by: ["couponId"], where: { couponId: { in: ids }, reversedAt: null }, _count: true }),
        prisma.couponRedemption.groupBy({ by: ["couponId"], where: { couponId: { in: ids }, accountId, reversedAt: null }, _count: true }),
    ]);
    const usedAll = new Map(total.map((t) => [t.couponId, t._count]));
    const usedMine = new Map(mine.map((t) => [t.couponId, t._count]));

    return rows.flatMap((c) => {
        const limit = c.totalUsageLimit;
        if (limit != null && (usedAll.get(c.id) ?? 0) >= limit) return [];
        const usesLeft = c.perCustomerLimit != null ? c.perCustomerLimit - (usedMine.get(c.id) ?? 0) : null;
        if (usesLeft != null && usesLeft <= 0) return [];
        return [
            {
                id: c.id,
                code: c.applyMode === "AUTO" ? null : c.code,
                title: c.name,
                benefit: benefitOf(c),
                description: c.description,
                minBill: num(c.minBillValue),
                endsAt: c.endsAt?.toISOString() ?? null,
                mine: c.ownerAccountId === accountId,
                usesLeft,
                forWhom: c.eligibility === "NEW" ? "New customers only" : c.eligibility === "RETURNING" ? "Returning customers only" : null,
            },
        ];
    });
}

/**
 * The coupons a profile can use online right now: live, in their dates, for the
 * shop, public or issued to this profile, with uses still left. Offers that apply
 * by themselves come without a code. Kept a minute per profile; the portal's My
 * Coupons and the customer app both read it. Checkout still checks every rule
 * again when a code is applied.
 */
export const loadPortalCoupons = unstable_cache(compute, ["portal:coupons"], { revalidate: 60 });
