import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { salePriceSaveSchema } from "@/shared/lib/schemas/pricingSchemas";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { capBarcodeToMrp, rebaseBarcodeGap } from "@/modules/pricing-strategy/lib/barcodeStore";

// PUT /api/pricing-strategy/sale-price — save the Sale Price + selling source
// for the rows ticked on Update prices ("Save").
//   • savedSalePricePaise (MRP-capped); blank clears it.
//   • The BARCODE price and its date are NOT touched here — they move only on
//     a barcode save (POST /api/pricing-strategy/barcode-price, a hand edit). See
//     barcodeStore.ts.
//   • Margin % (Computed box) and MRP ride along when edited — they are
//     unsaved on the screen until Save too. An MRP change caps the barcode.
//   • A hand change of the selling price (source switched, or Sale Price moved
//     while SAVED) re-bases the barcode gap after the recompute.
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
            select: { id: true, mrpPaise: true, savedSalePricePaise: true, effectiveSalePriceSource: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        const affected = data.items.filter((it) => byId.has(it.id)); // skip ids that don't exist
        // Rows whose SELLING price was changed by hand: the source was switched,
        // or the Sale Price moved while it is the selling voice. Their barcode
        // gap is re-measured after the recompute; the barcode itself is not touched.
        const rebaseIds: number[] = [];
        const mrpIds: number[] = [];
        const ops = affected.map((it) => {
            const before = byId.get(it.id)!;
            const hasSaved = it.savedSalePricePaise != null;
            let price = it.savedSalePricePaise;
            const mrpChanged = it.mrpPaise !== undefined && it.mrpPaise !== before.mrpPaise;
            if (mrpChanged) mrpIds.push(it.id);
            if (hasSaved && price != null) {
                const mrp = it.mrpPaise !== undefined ? it.mrpPaise : before.mrpPaise;
                if (mrp != null && mrp > 0 && price > mrp) price = mrp; // clamp to MRP
            }
            const sourceChanged = before.effectiveSalePriceSource !== it.effectiveSalePriceSource;
            const salePriceChanged = (hasSaved ? price : null) !== before.savedSalePricePaise;
            // A margin edit moves the Computed price, so it re-bases the gap when Computed sells.
            const marginEdited = it.marginPercent !== undefined && it.effectiveSalePriceSource === "COMPUTED";
            if (sourceChanged || marginEdited || (it.effectiveSalePriceSource === "SAVED" && salePriceChanged)) rebaseIds.push(it.id);
            return prisma.invProduct.update({
                where: { id: it.id },
                data: {
                    effectiveSalePriceSource: it.effectiveSalePriceSource,
                    savedSalePricePaise:      hasSaved ? price : null,
                    ...(it.marginPercent !== undefined ? { marginPercent: it.marginPercent != null ? it.marginPercent.toString() : null } : {}),
                    ...(it.mrpPaise !== undefined ? { mrpPaise: it.mrpPaise } : {}),
                },
            });
        });

        await prisma.$transaction(ops);

        // Re-materialize effectiveSalePricePaise from the freshly-written source so
        // POS/shop reflect the change immediately. Never fail the freeze on a
        // recompute error — the next voucher would heal it anyway. The barcode
        // gap is measured from the new effective price, so it only moves when
        // the recompute succeeded (a stale base would mislead Needs Attention).
        try {
            await recomputePricesForProducts(affected.map((it) => it.id));
            for (const id of mrpIds) await capBarcodeToMrp(id);
            await rebaseBarcodeGap(rebaseIds);
        } catch { /* best-effort; price heals on next voucher */ }

        return NextResponse.json({ saved: ops.length });
    } catch (e) {
        return handleApiError(e, "Failed to save sale prices");
    }
}
