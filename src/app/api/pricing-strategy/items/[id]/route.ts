import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { pricingItemUpdateSchema } from "@/shared/lib/schemas/pricingSchemas";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { capBarcodeToMrp, rebaseBarcodeGap, saveAutoBarcodes, saveManualBarcode } from "@/modules/pricing-strategy/lib/barcodeStore";

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

        // Barcode price / date / gap are NOT written by this PATCH directly — they
        // go through barcodeStore.ts after the recompute below.
        const before = data.marginPercent !== undefined
            ? await prisma.invProduct.findUnique({ where: { id }, select: { effectiveSalePriceSource: true } })
            : null;

        const row = await prisma.invProduct.update({
            where: { id },
            data: {
                ...(data.costMethod      !== undefined ? { costMethod:    data.costMethod } : {}),
                ...(data.marginPercent   !== undefined ? { marginPercent: data.marginPercent != null ? data.marginPercent.toString() : null } : {}),
                ...(data.mrpPaise        !== undefined ? { mrpPaise:      data.mrpPaise } : {}),
                ...openingPatch,
            },
            select: {
                id:               true,
                costMethod:       true,
                marginPercent:    true,
                effectiveSalePricePaise:       true,
                mrpPaise:         true,
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

        // Barcode rules (barcodeStore.ts):
        //   • typed barcode → save it (MRP-capped) with date + gap;
        //   • barcode set back to auto (null) → save the auto one from the Sale Price;
        //   • MRP cut below the saved barcode → cap it (a barcode save);
        //   • margin changed while COMPUTED sells → re-measure the gap only.
        if (data.barcodeManualPaise !== undefined) {
            if (data.barcodeManualPaise != null) await saveManualBarcode(id, data.barcodeManualPaise);
            else await saveAutoBarcodes([id]);
        } else if (data.mrpPaise !== undefined) {
            await capBarcodeToMrp(id);
        }
        if (before?.effectiveSalePriceSource === "COMPUTED") await rebaseBarcodeGap([id]);

        const after = await prisma.invProduct.findUnique({
            where:  { id },
            select: { barcodeManualPaise: true, barcodeIsManual: true, salePriceFrozenAt: true, effectiveSalePricePaise: true },
        });
        return NextResponse.json({ ...row, ...after });
    } catch (e) {
        return handleApiError(e, "Failed to update pricing item");
    }
}
