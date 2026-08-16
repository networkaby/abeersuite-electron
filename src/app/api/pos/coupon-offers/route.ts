import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import {
    checkCouponEligibility,
    computeCouponDiscount,
    loadPosOffers,
    type CouponContext,
    type EvalInput,
} from "@/modules/coupons/lib";
import { round2, formatInr } from "@/shared/lib/format";
import { resolveEffectiveCostMap } from "@/modules/pricing-strategy/lib/resolveCost";
import { resolveProductTaxBatch } from "@/modules/inventory/lib/gstResolver";
import { loadProtectedProductIds } from "@/modules/retention/lib/protection";

// POST /api/pos/coupon-offers — list every offer currently claimable on the POS
// (CODE + AUTO, active, in-window, POS/BOTH channel) with its LIVE qualification
// status against the current cart, for the POS "Offers" upsell panel.
//
// The server owns every gate — eligibility (new/returning), usage limits, the
// discount-protection blacklist, and the customer's no-discount flag (flagged
// customers simply get an empty list, the same deliberate silence as the
// coupon-validate route). The client only renders; it never computes a gate.

const lineSchema = z.object({
    productId:  z.number().int(),
    qty:        z.number().min(0),
    unitPrice:  z.number().min(0),
    // Line's snapshotted GST % — used to gross up the server-resolved cost to
    // cost-incl-tax, the PERCENT-coupon base (same snapshot /sale receives).
    taxRate:    z.number().min(0).max(100).optional(),
});

const bodySchema = z.object({
    accountId:     z.number().int().nullable().optional(),
    isNewCustomer: z.boolean().optional(),
    lines:         z.array(lineSchema).default([]),
});

const inr = (n: number): string => formatInr(round2(n));
const pctLabel = (p: number | null): boolean => (p ?? 100) >= 99.5;

/// Select shape shared by the cross-sell product queries (history/hot + fallback).
const crossSellSelect = {
    id: true, sku: true, name: true, stock: true,
    effectiveSalePricePaise: true, mrpPaise: true, requireSaleNote: true,
    groupId: true, categoryId: true,
    unit: { select: { code: true } },
    warrantyTerm: { select: { name: true, durationDays: true } },
} as const;

type CrossSellProduct = Prisma.InvProductGetPayload<{ select: typeof crossSellSelect }>;

/// Human-readable "what the customer gets" line for the card.
function benefitText(c: CouponContext, name: (id: number) => string | null): string {
    switch (c.type) {
        case "PERCENT": {
            let s = `−${c.percentOff}% off`;
            if (c.maxDiscountAmt != null) s += ` (max ${inr(c.maxDiscountAmt)})`;
            return s;
        }
        case "FLAT":
            return `−${inr(c.flatAmt ?? 0)} flat`;
        case "FREE_ITEM": {
            const n = name(c.freeProductId ?? -1) ?? "item";
            return pctLabel(c.freeDiscountPct)
                ? `${c.freeQty ?? 1} × ${n} FREE`
                : `${c.freeQty ?? 1} × ${n} at ${c.freeDiscountPct}% off`;
        }
        case "BOGO": {
            const getProductId = c.freeProductId ?? c.buyProductId;
            const buyName = c.buyProductId != null ? (name(c.buyProductId) ?? "item") : "items";
            const getName = name(getProductId ?? -1) ?? "item";
            const tail = pctLabel(c.freeDiscountPct) ? "FREE" : `at ${c.freeDiscountPct}% off`;
            const sameItem = c.buyProductId == null || c.freeProductId == null || c.freeProductId === c.buyProductId;
            return sameItem
                ? `Buy ${c.buyQty ?? 1} get ${c.getQty ?? 1} ${tail} — ${getName}`
                : `Buy ${c.buyQty ?? 1} × ${buyName} → Get ${c.getQty ?? 1} × ${getName} ${tail}`;
        }
        case "SET_PRICE":
            return `Any eligible item @ ${inr(c.setPriceAmt ?? 0)}`;
    }
}

/// Human-readable "what it takes" line for the card (the buy-side of a BOGO is
/// its own progress bar, so it is not repeated here).
function requirementText(c: CouponContext): string {
    const parts: string[] = [];
    if (c.minBillValue != null) parts.push(`Min bill ${inr(c.minBillValue)}`);
    if (c.rules.some((r) => r.kind === "INCLUDE")) parts.push("Eligible items only");
    if (c.eligibility === "NEW") parts.push("New customers only");
    if (c.eligibility === "RETURNING") parts.push("Returning customers only");
    return parts.join(" · ") || "No minimum";
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;

    try {
        // Customer Quality: no-discount flag — flagged customer gets no OFFERS
        // (same deliberate silence as coupon-validate; the POS never learns why),
        // but cross-sell suggestions still apply (add-ons are full-price sales).
        let noDiscountFlag = false;
        if (data.accountId != null) {
            const acct = await prisma.account.findUnique({
                where:  { id: data.accountId },
                select: { person: { select: { noDiscount: true } }, company: { select: { noDiscount: true } } },
            });
            noDiscountFlag = (acct?.person?.noDiscount ?? acct?.company?.noDiscount) === true;
        }

        const now = new Date();
        const goodsValue = round2(data.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
        const accountId = data.accountId ?? null;
        const isNewCustomer = data.isNewCustomer ?? false;

        const productIds = [...new Set(data.lines.map((l) => l.productId))];
        const [products, costPaiseById, protectedProductIds, coupons] = await Promise.all([
            prisma.invProduct.findMany({ where: { id: { in: productIds } }, select: { id: true, groupId: true, categoryId: true, brandId: true } }),
            resolveEffectiveCostMap(productIds),
            loadProtectedProductIds(prisma),
            loadPosOffers(prisma, now),
        ]);
        const taxById = new Map(products.map((p) => [p.id, p]));

        // ── Usage counts (unreversed redemptions) — total + this customer ──
        const [usageByCoupon, usageByCust] = await Promise.all([
            prisma.couponRedemption.groupBy({
                by: ["couponId"],
                where: { reversedAt: null },
                _count: true,
            }),
            accountId != null
                ? prisma.couponRedemption.groupBy({
                    by: ["couponId"],
                    where: { couponId: { in: coupons.map((c) => c.id) }, accountId, reversedAt: null },
                    _count: true,
                })
                : Promise.resolve([]),
        ]);
        const usedTotal = new Map(usageByCoupon.map((r) => [r.couponId, r._count]));
        const usedByCust = new Map(usageByCust.map((r) => [r.couponId, r._count]));

        const input: EvalInput = {
            accountId,
            lines: data.lines.map((l) => {
                const costPaise = costPaiseById.get(l.productId) ?? null;
                return {
                    productId: l.productId,
                    groupId: taxById.get(l.productId)?.groupId ?? null,
                    categoryId: taxById.get(l.productId)?.categoryId ?? null,
                    brandId: taxById.get(l.productId)?.brandId ?? null,
                    qty: l.qty,
                    unitPrice: l.unitPrice,
                    costIncl: costPaise == null ? null : (costPaise / 100) * (1 + (l.taxRate ?? 0) / 100),
                    protected: protectedProductIds.has(l.productId),
                };
            }),
            goodsValue,
            billBeforeCoupon: goodsValue,
            isNewCustomer,
            now,
        };

        // ── Resolve product names for the benefit lines ───────────────────
        const offerProductIds = [...new Set(coupons.flatMap((c) => [c.freeProductId, c.buyProductId]).filter((id): id is number => id != null))];
        const offerNames = new Map<number, string>(
            (await prisma.invProduct.findMany({ where: { id: { in: offerProductIds } }, select: { id: true, name: true } }))
                .map((p) => [p.id, p.name]),
        );
        const name = (id: number): string | null => offerNames.get(id) ?? null;

        const orderRank: Record<string, number> = { ready: 0, progress: 1, unavailable: 2 };
        const offers = noDiscountFlag ? [] : coupons.map((c) => {
            const used = usedTotal.get(c.id) ?? 0;
            const usedCust = usedByCust.get(c.id) ?? 0;
            const usageLeft = c.totalUsageLimit != null ? Math.max(0, c.totalUsageLimit - used) : null;

            // ── Hard gates → unavailable ────────────────────────────────
            let unavailableReason: string | null = null;
            if (c.ownerAccountId != null && c.ownerAccountId !== accountId) unavailableReason = "Personal offer for another customer";
            else if (c.eligibility === "NEW" && !isNewCustomer) unavailableReason = "New customers only";
            else if (c.eligibility === "RETURNING" && isNewCustomer) unavailableReason = "Returning customers only";
            else if (c.totalUsageLimit != null && used >= c.totalUsageLimit) unavailableReason = "Usage limit reached";
            else if (c.perCustomerLimit != null && accountId != null && usedCust >= c.perCustomerLimit) unavailableReason = "Already used by this customer";

            // ── Progress: the gate the cashier can push on ─────────────
            let progress: { current: number; target: number; unit: "₹" | "units"; pct: number } | null = null;
            let gapText: string | null = null;
            if (c.type === "BOGO" && c.buyProductId != null) {
                const buyUnits = input.lines.find((l) => l.productId === c.buyProductId)?.qty ?? 0;
                const buyQty = c.buyQty ?? 1;
                progress = { current: buyUnits, target: buyQty, unit: "units", pct: Math.min(100, round2((buyUnits / buyQty) * 100)) };
                if (buyUnits < buyQty) gapText = `Add ${buyQty - buyUnits} more ${name(c.buyProductId) ?? "item"} to unlock`;
            } else if (c.minBillValue != null) {
                progress = { current: goodsValue, target: c.minBillValue, unit: "₹", pct: Math.min(100, round2((goodsValue / c.minBillValue) * 100)) };
                if (goodsValue < c.minBillValue) gapText = `Add ${inr(c.minBillValue - goodsValue)} more to unlock`;
            }

            // ── Full pipeline → ready / progress-with-note ─────────────
            let status: "ready" | "progress" | "unavailable" = unavailableReason != null ? "unavailable" : "progress";
            let saveEstimate: number | null = null;
            let note: string | null = null;
            if (status !== "unavailable") {
                const gate = checkCouponEligibility(c, input);
                if (!gate.ok) {
                    if (gate.reason.startsWith("Minimum bill")) {
                        // covered by gapText
                    } else if (gate.reason === "No eligible items in the cart") {
                        note = "Add eligible items to cart";
                    } else {
                        note = gate.reason;
                    }
                } else {
                    const res = computeCouponDiscount(c, input);
                    if (res.ok) {
                        status = "ready";
                        saveEstimate = res.discountRupees;
                    } else {
                        const r = res.reason;
                        if (r.startsWith("Add the offer item")) {
                            const getProductId = c.freeProductId ?? c.buyProductId;
                            note = `Scan ${name(getProductId ?? -1) ?? "the offer item"} to collect`;
                        } else if (r !== "Buy more to unlock the offer") {
                            note = r;
                        }
                    }
                }
            }

            const getProductId = c.freeProductId ?? c.buyProductId;
            return {
                couponId: c.id,
                code: c.code,
                name: c.name,
                type: c.type,
                applyMode: c.applyMode,
                status,
                benefit: benefitText(c, name),
                requirement: requirementText(c),
                progress,
                gapText,
                note,
                saveEstimate,
                unavailableReason,
                stackable: c.stackable,
                stackScope: c.stackScope,
                expiresAt: c.endsAt?.toISOString() ?? null,
                usageLeft,
                freeProductId: c.freeProductId,
                freeProductName: getProductId != null ? name(getProductId) : null,
                buyProductId: c.buyProductId,
                buyProductName: c.buyProductId != null ? name(c.buyProductId) : null,
                buyQty: c.buyQty,
                getQty: c.getQty,
                freeQty: c.freeQty,
                freeDiscountPct: c.freeDiscountPct,
            };
        }).sort((a, b) => {
            if (a.status !== b.status) return orderRank[a.status] - orderRank[b.status];
            if (a.status === "progress") return (b.progress?.pct ?? 0) - (a.progress?.pct ?? 0);
            return (b.saveEstimate ?? 0) - (a.saveEstimate ?? 0);
        });

        // ── Cross-sell: last-bought history, topped up with hot sellers ───
        // Until full recommendation intelligence exists: show the customer's
        // most recently bought products first, then fill the remainder with the
        // store's best sellers (last 90 days). Walk-in customers (no account),
        // or an empty history/hot pool, fall back to same-shelf products (the
        // cart's own groups/categories). Products already in the cart are always
        // skipped. taxRate/costPaise are enriched so the added line prices +
        // tier-preview exactly like a scanned product; redeemCapPct is
        // intentionally omitted (client falls back to the global cap — the sale
        // route re-resolves the authoritative override anyway).
        const cartIdSet = new Set(data.lines.map((l) => l.productId));
        const picks: Array<{ id: number; source: "history" | "hot" | "shelf"; lastBoughtAt?: string; lastUnitPricePaise?: number | null }> = [];
        const pickIdSet = new Set<number>();

        // 1) Last-bought history — recency-ordered, deduped by product, carrying
        //    the date + unit rate of the customer's most recent purchase.
        if (accountId != null) {
            const recentVouchers = await prisma.universalVoucher.findMany({
                where:  { type: { in: ["POS", "SALE"] }, status: "POSTED", deletedAt: null, partyAccountId: accountId },
                orderBy: { date: "desc" },
                take:   12,
                select: { id: true },
            });
            if (recentVouchers.length > 0) {
                const historyLines = await prisma.voucherInventoryLine.findMany({
                    where:  { universalVoucherId: { in: recentVouchers.map((v) => v.id) } },
                    orderBy: { universalVoucher: { date: "desc" } },
                    select: { productId: true, rate: true, universalVoucher: { select: { date: true } } },
                });
                // productId → most recent purchase (ts + unit rate of that line).
                const lastBought = new Map<number, { ts: number; rate: number | null }>();
                for (const l of historyLines) {
                    const t = l.universalVoucher.date.getTime();
                    const prev = lastBought.get(l.productId);
                    if (prev == null || t > prev.ts) {
                        lastBought.set(l.productId, { ts: t, rate: l.rate == null ? null : Number(l.rate) });
                    }
                }
                for (const [id, m] of [...lastBought.entries()].sort((a, b) => b[1].ts - a[1].ts)) {
                    if (pickIdSet.has(id) || cartIdSet.has(id)) continue;
                    pickIdSet.add(id);
                    picks.push({
                        id,
                        source: "history",
                        lastBoughtAt: new Date(m.ts).toISOString(),
                        lastUnitPricePaise: m.rate == null ? null : Math.round(m.rate * 100),
                    });
                    if (picks.length >= 10) break;
                }
            }
        }

        // 2) Hot sellers (most units sold, last 90 days) top up the list.
        if (picks.length < 10) {
            const hotAgg = await prisma.voucherInventoryLine.groupBy({
                by: ["productId"],
                where: {
                    universalVoucher: {
                        type:  { in: ["POS", "SALE"] },
                        status: "POSTED",
                        deletedAt: null,
                        date:  { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
                    },
                },
                _sum:   { quantity: true },
                orderBy: { _sum: { quantity: "desc" } },
                take:   30,
            });
            for (const r of hotAgg) {
                if (pickIdSet.has(r.productId) || cartIdSet.has(r.productId)) continue;
                pickIdSet.add(r.productId);
                picks.push({ id: r.productId, source: "hot" });
                if (picks.length >= 10) break;
            }
        }

        const crossSell: unknown[] = [];
        let ranked: CrossSellProduct[] = [];
        if (picks.length > 0) {
            // 3a) Materialize the picked products (inactive ones drop out).
            const pickedById = new Map(
                (await prisma.invProduct.findMany({
                    where:  { id: { in: picks.map((p) => p.id) }, isActive: true },
                    select: crossSellSelect,
                })).map((p) => [p.id, p]),
            );
            ranked = picks.map((p) => pickedById.get(p.id)).filter((p): p is CrossSellProduct => p != null);
        } else {
            // 3b) Fallback — same-shelf products from the cart's groups/categories.
            const cartGroups = new Set([...taxById.values()].map((t) => t.groupId).filter((g): g is number => g != null));
            const cartCats = new Set([...taxById.values()].map((t) => t.categoryId).filter((c): c is number => c != null));
            if (cartGroups.size > 0 || cartCats.size > 0) {
                const candidates = await prisma.invProduct.findMany({
                    where: {
                        isActive: true,
                        id: { notIn: data.lines.map((l) => l.productId) },
                        OR: [
                            ...(cartGroups.size > 0 ? [{ groupId: { in: [...cartGroups] } }] : []),
                            ...(cartCats.size > 0 ? [{ categoryId: { in: [...cartCats] } }] : []),
                        ],
                    },
                    take:   30,
                    select: crossSellSelect,
                });
                ranked = candidates
                    .map((p) => ({
                        p,
                        rank: (cartGroups.has(p.groupId ?? -1) && cartCats.has(p.categoryId ?? -1)) ? 0 : 1,
                        // Untracked stock (null) sinks below any real on-hand number.
                        stock: p.stock ?? -1,
                    }))
                    .sort((a, b) => a.rank - b.rank || b.stock - a.stock || a.p.name.localeCompare(b.p.name))
                    .slice(0, 10)
                    .map(({ p }) => p);
            }
        }

        if (ranked.length > 0) {
            const ids = ranked.map((p) => p.id);
            const [taxByProduct, costMap] = await Promise.all([
                resolveProductTaxBatch({ productIds: ids }),
                resolveEffectiveCostMap(ids),
            ]);
            const metaById = new Map(picks.map((p) => [p.id, p]));
            crossSell.push(...ranked.map((p) => {
                const m = metaById.get(p.id);
                return {
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                    effectiveSalePricePaise: p.effectiveSalePricePaise,
                    mrpPaise: p.mrpPaise,
                    requireSaleNote: p.requireSaleNote,
                    unit: p.unit,
                    warrantyTerm: p.warrantyTerm,
                    protected: protectedProductIds.has(p.id),
                    taxRate: taxByProduct.products.get(p.id)?.gstRate ?? null,
                    costPaise: costMap.get(p.id) ?? null,
                    barcodePricePaise: null,
                    /// Provenance + last-purchase snapshot — the drawer renders
                    /// "history" rows (date + last price) distinctly from "hot".
                    crossSellSource: m?.source ?? "shelf",
                    lastBoughtAt: m?.lastBoughtAt ?? null,
                    lastUnitPricePaise: m?.lastUnitPricePaise ?? null,
                };
            }));
        }

        return NextResponse.json({ offers, crossSell });
    } catch (e) {
        return handleApiError(e, "Could not load offers");
    }
}
