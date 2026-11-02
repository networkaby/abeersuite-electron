import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { salePriceSaveSchema } from "@/shared/lib/schemas/pricingSchemas";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";

// PUT /api/pricing-strategy/sale-price — bulk-freeze the saved Sale Price for
// the rows ticked on Update & Print Labels.
//   • A Sale Price was entered (savedSalePricePaise != null) → store it (MRP-capped)
//                            + stamp salePriceFrozenAt + savedProfitPaise. This is
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
        const products = await prisma.invProduct.findMany({
            where:  { id: { in: ids } },
            select: { id: true, mrpPaise: true },
        });
        const mrpById = new Map(products.map((p) => [p.id, p.mrpPaise]));
        const now = new Date();

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
            return prisma.invProduct.update({
                where: { id: it.id },
                data: {
                    effectiveSalePriceSource: it.effectiveSalePriceSource,
                    savedSalePricePaise:      hasSaved ? price : null,
                    salePriceFrozenAt:        hasSaved ? now : null,
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

        // Snapshot the price that sells NOW as the barcode's original-gap basis
        // (Needs Attention → "Low barcode gap"). Cleared when the Sale Price is cleared.
        const savedIds = affected.filter((it) => it.savedSalePricePaise != null).map((it) => it.id);
        const clearedIds = affected.filter((it) => it.savedSalePricePaise == null).map((it) => it.id);
        if (savedIds.length) {
            await prisma.$executeRaw`UPDATE "InvProduct" SET "barcodeGapBasePaise" = "effectiveSalePricePaise", "updatedAt" = NOW() WHERE id = ANY(${savedIds}::int[])`;
        }
        if (clearedIds.length) {
            await prisma.invProduct.updateMany({ where: { id: { in: clearedIds } }, data: { barcodeGapBasePaise: null } });
        }

        return NextResponse.json({ saved: ops.length });
    } catch (e) {
        return handleApiError(e, "Failed to save sale prices");
    }
}
