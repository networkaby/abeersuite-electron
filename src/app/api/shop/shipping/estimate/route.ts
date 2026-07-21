import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { invProductDb } from "@/shared/types/inventoryTypes";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { estimateCartShipping } from "@/modules/delivery/lib/shippingQuote";
import { loadDeliveryMethod, type ShiprocketConfig } from "@/modules/delivery/lib/deliveryMethods";
import { chargeableUnitGrams } from "@/modules/delivery/lib/chargeableWeight";

// Public storefront read: a "from ₹X" shipping estimate for the cart, before a
// delivery address is known. Weight + subtotal are computed server-side; the rate
// is the cheapest courier priceable without a destination (Standard-courier
// services). The exact charge per courier is quoted at checkout once the address
// is entered. `fromPaise` is null when nothing can be priced yet.

const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

const estimateSchema = z.object({
    lines: z
        .array(
            z.object({
                productId: z.coerce.number().int().positive(),
                quantity: z.coerce.number().int().positive().max(99),
            })
        )
        .min(1),
});

export async function POST(req: Request) {
    try {
        const { data, error } = await validateRequest(req, estimateSchema);
        if (error) return error;
        const { lines } = data;

        const productIds = [...new Set(lines.map((l) => l.productId))];
        const [products, bands, srMethod] = await Promise.all([
            invProductDb(prisma).findMany({
                where: { id: { in: productIds }, isListedInShop: true, isActive: true },
            }),
            loadBarcodeBands(),
            loadDeliveryMethod("SHIPROCKET"),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));
        const fallbackWeight =
            Number((srMethod?.configJson as ShiprocketConfig | undefined)?.defaultItemWeightGrams) ||
            DEFAULT_ITEM_WEIGHT_GRAMS;

        let subtotalPaise = 0;
        let weightGrams = 0;
        for (const l of lines) {
            const p = byId.get(l.productId);
            if (!p) continue;
            const unitPricePaise =
                barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) ?? p.effectiveSalePricePaise ?? 0;
            subtotalPaise += unitPricePaise * l.quantity;
            weightGrams += chargeableUnitGrams(p, fallbackWeight) * l.quantity;
        }

        const estimate = await estimateCartShipping({ subtotalPaise, weightGrams });
        return NextResponse.json({
            fromPaise: estimate?.fromPaise ?? null,
            courierName: estimate?.courierName ?? null,
            subtotalPaise,
            weightGrams,
        });
    } catch (e) {
        return handleApiError(e, "Failed to estimate shipping");
    }
}
