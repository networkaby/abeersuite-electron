import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { quoteShipping } from "@/modules/delivery/lib/shippingQuote";
import { loadDeliveryMethod, type ShiprocketConfig } from "@/modules/delivery/lib/deliveryMethods";
import { chargeableUnitGrams } from "@/modules/delivery/lib/chargeableWeight";

// Public storefront read: given a delivery pincode + cart, return the courier
// options and their rates. Subtotal + parcel weight are computed server-side so
// the shipping charge the order stores can't be forged by the client.

const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

const quoteSchema = z.object({
    pincode: z.string().trim().regex(/^\d{6}$/u, "Enter a valid 6-digit pincode"),
    state: z.string().trim().max(60).optional(),
    neighbourhood: z.string().trim().max(120).optional(),
    cod: z.boolean().optional(),
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
        const { data, error } = await validateRequest(req, quoteSchema);
        if (error) return error;
        const { pincode, lines, cod } = data;

        const productIds = [...new Set(lines.map((l) => l.productId))];
        const [products, bands, srMethod] = await Promise.all([
            prisma.invProduct.findMany({
                where: { id: { in: productIds }, isListedInShop: true, isActive: true },
            }),
            loadBarcodeBands(),
            loadDeliveryMethod("SHIPROCKET"),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));

        // Fallback unit weight when a product has none — the Shiprocket config's
        // default, else a sensible 500 g.
        const fallbackWeight =
            Number((srMethod?.configJson as ShiprocketConfig | undefined)?.defaultItemWeightGrams) ||
            DEFAULT_ITEM_WEIGHT_GRAMS;

        let subtotalPaise = 0;
        let weightGrams = 0;
        for (const l of lines) {
            const p = byId.get(l.productId);
            if (!p) return NextResponse.json({ error: `Unknown product ${l.productId}` }, { status: 400 });
            const unitPricePaise =
                barcodeTagPaise(p.savedSalePricePaise, p.mrpPaise, bands) ?? p.effectiveSalePricePaise ?? 0;
            subtotalPaise += unitPricePaise * l.quantity;
            // Couriers bill on max(actual, volumetric) — use the chargeable weight.
            weightGrams += chargeableUnitGrams(p, fallbackWeight) * l.quantity;
        }

        const options = await quoteShipping({
            deliveryPincode: pincode,
            deliveryState: data.state,
            deliveryNeighbourhood: data.neighbourhood,
            subtotalPaise,
            weightGrams,
            cod: cod ?? true,
        });

        return NextResponse.json({ options, subtotalPaise, weightGrams });
    } catch (e) {
        return handleApiError(e, "Failed to quote shipping");
    }
}
