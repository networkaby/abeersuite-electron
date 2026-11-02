import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { salePriceSaveSchema } from "@/shared/lib/schemas/pricingSchemas";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { nextBarcodeDate } from "@/modules/pricing-strategy/lib/barcodeDate";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";

// PUT /api/pricing-strategy/sale-price — bulk-freeze the saved Sale Price for
// the rows ticked on Update & Print Labels.
//   • A Sale Price was entered (savedSalePricePaise != null) → store it (MRP-capped)
//                            + savedProfitPaise; salePriceFrozenAt is re-stamped
//                            only if the printed barcode ₹ changes (barcodeDate.ts). This is
//                            the printed barcode tag and persists INDEPENDENTLY of
//                            the selling source — Strategy/Computed rows keep their
//                            saved tag; only a blank Sale Price clears it.
//   • Blank Sale Price (savedSalePricePaise == null) → clear the frozen fields.
// `effectiveSalePriceSource` is written separately and only decides which voice POS
// charges; it no longer wipes the saved tag. After the write, recompute
// re-materializes effectiveSalePricePaise from the source immediately, so POS/shop
// sell the new price without waiting for a voucher.
// Gated by Pricing Strategy page access — seeing the module means doing the work
// on it (only "reset all points" keeps its own permission).
export async function PUT(req: Request) {
    const { response } = await requireModuleAccess("pricing-strategy");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, salePriceSaveSchema);
        if (error) return error;

        const ids = data.items.map((i) => i.id);
        const [products, bands] = await Promise.all([
            prisma.invProduct.findMany({
                where:  { id: { in: ids } },
                select: { id: true, mrpPaise: true, savedSalePricePaise: true, barcodeManualPaise: true, salePriceFrozenAt: true },
            }),
            loadBarcodeBands(),
        ]);
        const byId = new Map(products.map((p) => [p.id, p]));
        const mrpById = new Map(products.map((p) => [p.id, p.mrpPaise]));
        const now = new Date();
        const frozenAt: Record<number, string | null> = {};

        const affected = data.items.filter((it) => mrpById.has(it.id)); // skip ids that don't exist
        const ops = affected.map((it) => {
            // The saved Sale Price (and its barcode tag) persists whenever one was
            // entered, INDEPENDENT of the selling source — the source only controls
            // which voice POS charges. A blank Sale Price (null) clears the tag.
            const hasSaved = it.savedSalePricePaise != null;
            let price = it.savedSalePricePaise;
            if (hasSaved && price != null) {
                const mrp = mrpById.get(it.id);
                if (mrp != null && mrp > 0 && price > mrp) price = mrp; // clamp to MRP
            }
            // Date = age of the printed barcode price: moves only if the tag moves.
            const before = byId.get(it.id)!;
            const at = nextBarcodeDate(before, { ...before, savedSalePricePaise: hasSaved ? price : null }, bands, now);
            frozenAt[it.id] = at ? at.toISOString() : null;
            return prisma.invProduct.update({
                where: { id: it.id },
                data: {
                    effectiveSalePriceSource: it.effectiveSalePriceSource,
                    savedSalePricePaise:      hasSaved ? price : null,
                    salePriceFrozenAt:        at,
                    savedProfitPaise:         hasSaved ? it.savedProfitPaise : null,
                },
            });
        });

        await prisma.$transaction(ops);

        // Re-materialize effectiveSalePricePaise from the freshly-written source so
        // POS/shop reflect the change immediately. Never fail the freeze on a
        // recompute error — the next voucher would heal it anyway.
        try {
            await recomputePricesForProducts(affected.map((it) => it.id));
        } catch { /* best-effort; price heals on next voucher */ }

        return NextResponse.json({ saved: ops.length, frozenAt });
    } catch (e) {
        return handleApiError(e, "Failed to save sale prices");
    }
}
