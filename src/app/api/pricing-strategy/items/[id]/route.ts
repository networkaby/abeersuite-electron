import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { pricingItemUpdateSchema } from "@/shared/lib/schemas/pricingSchemas";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { nextBarcodeDate } from "@/modules/pricing-strategy/lib/barcodeDate";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("pricing-strategy");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, pricingItemUpdateSchema);
        if (error) return error;

        // openingRatePaise lands on two columns:
        //   • openingRate (Decimal rupees) — the Tally-style master entry
        //   • openingValue (Decimal rupees) — qty × rate, recomputed if qty known
        // PR 3 dropped the costPaise cache — cost is now derived from the
        // ledger walk (which picks up openingRate as a synthetic first lot).
        let openingPatch: Record<string, unknown> = {};
        if (data.openingRatePaise !== undefined) {
            const existing = await prisma.invProduct.findUnique({
                where:  { id },
                select: { openingStock: true },
            });
            if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
            const rateRupees = data.openingRatePaise != null ? data.openingRatePaise / 100 : null;
            const stock = existing.openingStock != null ? Number(existing.openingStock) : null;
            openingPatch = {
                openingRate:  rateRupees,
                openingValue: rateRupees != null && stock != null ? stock * rateRupees : null,
            };
        }

        // Manual barcode: never above MRP (the MRP in this same patch, else the stored one).
        // MRP caps the auto tag too, so either edit can move the printed barcode ₹ —
        // re-stamp its date (salePriceFrozenAt) only when it actually moves.
        const barcodePatch: Record<string, unknown> = {};
        if (data.barcodeManualPaise !== undefined || data.mrpPaise !== undefined) {
            const [before, bands] = await Promise.all([
                prisma.invProduct.findUnique({
                    where:  { id },
                    select: { mrpPaise: true, savedSalePricePaise: true, barcodeManualPaise: true, salePriceFrozenAt: true },
                }),
                loadBarcodeBands(),
            ]);
            if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
            const mrp = data.mrpPaise !== undefined ? data.mrpPaise : before.mrpPaise;
            let manual = before.barcodeManualPaise;
            if (data.barcodeManualPaise !== undefined) {
                manual = data.barcodeManualPaise;
                if (manual != null && mrp != null && mrp > 0 && manual > mrp) manual = mrp;
                barcodePatch.barcodeManualPaise = manual;
            }
            barcodePatch.salePriceFrozenAt = nextBarcodeDate(
                before, { savedSalePricePaise: before.savedSalePricePaise, mrpPaise: mrp, barcodeManualPaise: manual }, bands, new Date(),
            );
        }

        const row = await prisma.invProduct.update({
            where: { id },
            data: {
                ...(data.costMethod      !== undefined ? { costMethod:    data.costMethod } : {}),
                ...(data.marginPercent   !== undefined ? { marginPercent: data.marginPercent != null ? data.marginPercent.toString() : null } : {}),
                ...(data.mrpPaise        !== undefined ? { mrpPaise:      data.mrpPaise } : {}),
                ...openingPatch,
                ...barcodePatch,
            },
            select: {
                id:               true,
                costMethod:       true,
                marginPercent:    true,
                effectiveSalePricePaise:       true,
                mrpPaise:         true,
                barcodeManualPaise: true,
                salePriceFrozenAt: true,
                openingRate:      true,
                openingStock:     true,
                openingValue:     true,
            },
        });
        // Margin %, cost method and MRP all feed the materialized
        // effectiveSalePricePaise (COMPUTED = cost × margin; STRATEGY = engine;
        // both MRP-capped). Re-materialize now so POS/shop reflect the edit
        // immediately instead of waiting for the next Save or voucher. Best-effort
        // — never fail the save on a recompute error (it heals on the next voucher).
        // SAVED rows keep their human price inside recompute.
        try {
            await recomputePricesForProducts([id]);
        } catch { /* best-effort; price heals on next voucher */ }

        return NextResponse.json(row);
    } catch (e) {
        return handleApiError(e, "Failed to update pricing item");
    }
}
