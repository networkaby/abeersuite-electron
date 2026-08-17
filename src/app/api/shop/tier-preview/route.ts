import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { resolvePortalAccountContext } from "@/shared/lib/auth/portalAccountContext";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { computeShopCartBenefits } from "@/modules/ecommerce/lib/shopTierDiscount";

// POST /api/shop/tier-preview — the customer benefits a logged-in customer's
// cart would earn (spend-tier "level" discount + coupon: typed code or the
// best AUTO offer), shown on the cart/checkout pages BEFORE placing. Same
// helper as /api/shop/orders, so the preview and the frozen checkout numbers
// can never disagree. Display-only: nothing is stored; the order route
// recomputes, freezes, and takes the coupon's usage slot itself.
//
// currentSaleValue here is goods-only (no courier chosen yet); the order route
// adds the shipping charge when it exists. That skew can only matter to a
// CURRENT_SALE period sitting within a shipping-fee of a level threshold.

const previewSchema = z.object({
    accountId: z.coerce.number().int().positive(),
    lines: z.array(z.object({
        productId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive().max(99),
    })).min(1).max(100),
    // Optional typed coupon code; the best AUTO offer previews even without one.
    couponCode: z.string().trim().max(40).optional(),
    // Loyalty points the customer wants to burn (validated/clamped server-side).
    redeemPoints: z.coerce.number().int().min(0).optional(),
});

export async function POST(req: Request) {
    try {
        const customerAuth = await requirePortalCustomer();
        if (customerAuth.response) return customerAuth.response;
        const { customerId } = customerAuth;

        const { data, error } = await validateRequest(req, previewSchema);
        if (error) return error;

        const context = await resolvePortalAccountContext(customerId, data.accountId);
        if (context.active.accountId !== data.accountId) {
            return NextResponse.json({ error: "Account is not linked to this profile" }, { status: 403 });
        }

        // Price each line exactly as the order route will (barcode tag,
        // falling back to the effective price) — unknown/unlisted products are
        // skipped, not errors: the cart page may hold a just-delisted item.
        const productIds = [...new Set(data.lines.map((l) => l.productId))];
        const [products, bands] = await Promise.all([
            invProductDb(prisma).findMany({
                where: { id: { in: productIds }, isListedInShop: true, isActive: true },
            }),
            loadBarcodeBands(),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));
        const lines: { productId: number; quantity: number; unitPricePaise: number }[] = [];
        for (const l of data.lines) {
            const p = byId.get(l.productId);
            const unitPricePaise = p
                ? barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) ?? p.effectiveSalePricePaise
                : null;
            if (p && unitPricePaise != null) {
                lines.push({ productId: l.productId, quantity: l.quantity, unitPricePaise });
            }
        }
        const goodsPaise = lines.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0);

        const benefits = await computeShopCartBenefits(prisma, data.accountId, lines, goodsPaise, {
            couponCode: data.couponCode,
            autoApply: true,
            redeemPoints: data.redeemPoints,
        });
        const couponPaise = benefits.coupon?.discountPaise ?? 0;
        const onTopPaise = benefits.onTop?.discountPaise ?? 0;
        const loyaltyPaise = benefits.loyalty?.redeemPaise ?? 0;
        return NextResponse.json({
            tierPct: benefits.tierPct,
            tierLabel: benefits.tierLabel,
            discountPaise: benefits.discountInclPaise,
            coupon: benefits.coupon
                ? {
                    // Codeless AUTO offers surface their display name as the "code".
                    code: benefits.coupon.code ?? benefits.coupon.name,
                    name: benefits.coupon.name,
                    discountPaise: couponPaise,
                    droppedTier: benefits.coupon.droppedTier,
                }
                : null,
            // An independent FREE-GRANT coupon (typed code or best AUTO) — the
            // item the order will add as a zero-price line (freeQty).
            freeGrant: benefits.freeGrant
                ? {
                    // Codeless AUTO offers surface their display name as the "code".
                    code: benefits.freeGrant.code ?? benefits.freeGrant.name,
                    productName: benefits.freeGrant.productName,
                    freeQty: benefits.freeGrant.freeQty,
                }
                : null,
            // Rule 3 — a non-independent fully-free FREE_ITEM / BOGO that won the
            // money slot: its item rides the order as a zero-price line too.
            moneyGrant: benefits.moneyGrant
                ? {
                    code: benefits.moneyGrant.code ?? benefits.moneyGrant.name,
                    productName: benefits.moneyGrant.productName,
                    freeQty: benefits.moneyGrant.freeQty,
                }
                : null,
            // Rule 2 — an independent PARTIAL (<100%) FREE_ITEM / BOGO on top:
            // a ₹ discount never guard-clamped, never dropping tier / loyalty.
            onTop: benefits.onTop
                ? {
                    code: benefits.onTop.code ?? benefits.onTop.name,
                    name: benefits.onTop.name,
                    discountPaise: benefits.onTop.discountPaise,
                }
                : null,
            // Set only when the TYPED code was rejected (auto-apply fails silently)
            // — or when it conflicts with the chosen loyalty points.
            couponError: data.couponCode?.trim() ? benefits.couponError : null,
            // Loyalty context (null = programme/redeem off) + the validated
            // redemption for the requested points.
            loyalty: benefits.loyalty,
            goodsPaise,
            netGoodsPaise: goodsPaise - benefits.discountInclPaise - couponPaise - onTopPaise - loyaltyPaise,
        });
    } catch (e) {
        return handleApiError(e, "Failed to preview the discount");
    }
}
