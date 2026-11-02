import { prisma } from "@/shared/lib/prisma/prismaClient";
import { barcodeTagPaise } from "@/shared/lib/pricing/barcodePrice";
import { loadBarcodeBands } from "@/shared/lib/shop/barcodeBands";

/**
 * The saved barcode price — the ONE place that writes it. Server-only.
 *
 * InvProduct.barcodeManualPaise holds the barcode ₹ that is printed; it is
 * written only when the barcode is SAVED, and every save stamps three things
 * together: the price, the date (salePriceFrozenAt → secret date code) and the
 * gap basis (barcodeGapBasePaise = the price selling at that moment).
 *
 * Nothing else may move the price or the date — a Sale Price, margin, cost or
 * strategy change leaves them alone. A hand change of the SELLING price only
 * re-bases the gap (`rebaseBarcodeGap`), so Needs Attention measures from it.
 *
 * Call these AFTER recomputePricesForProducts, so effectiveSalePricePaise is
 * the price that really sells now.
 */

/**
 * Save the AUTO barcode — bands applied to the EFFECTIVE sale price (the price
 * that really sells now: Strategy, Computed or Sale Price), capped at MRP — for
 * these products. So the label always has headroom over the selling price.
 * `onlyMissing` skips products that already have a saved barcode (new-product
 * paths). A product with no effective price is skipped (its barcode stays).
 */
export async function saveAutoBarcodes(ids: number[], opts: { onlyMissing?: boolean } = {}): Promise<number> {
    if (ids.length === 0) return 0;
    const [rows, bands] = await Promise.all([
        prisma.invProduct.findMany({
            where:  { id: { in: ids }, ...(opts.onlyMissing ? { barcodeManualPaise: null } : {}) },
            select: { id: true, mrpPaise: true, effectiveSalePricePaise: true },
        }),
        loadBarcodeBands(),
    ]);
    const now = new Date();
    const ops = rows.flatMap((p) => {
        const tag = barcodeTagPaise(p.effectiveSalePricePaise, p.mrpPaise, bands);
        if (tag == null) return [];
        return [prisma.invProduct.update({
            where: { id: p.id },
            data:  {
                barcodeManualPaise:  tag,
                barcodeIsManual:     false,
                salePriceFrozenAt:   now,
                barcodeGapBasePaise: p.effectiveSalePricePaise,
            },
        })];
    });
    if (ops.length) await prisma.$transaction(ops);
    return ops.length;
}

/**
 * Save a hand-typed barcode (capped at MRP). Stamps date + gap basis.
 * Returns what was stored.
 */
export async function saveManualBarcode(id: number, pricePaise: number): Promise<{ barcodeManualPaise: number; salePriceFrozenAt: Date } | null> {
    const p = await prisma.invProduct.findUnique({
        where:  { id },
        select: { mrpPaise: true, effectiveSalePricePaise: true },
    });
    if (!p) return null;
    const v = p.mrpPaise != null && p.mrpPaise > 0 && pricePaise > p.mrpPaise ? p.mrpPaise : pricePaise;
    const now = new Date();
    await prisma.invProduct.update({
        where: { id },
        data:  { barcodeManualPaise: v, barcodeIsManual: true, salePriceFrozenAt: now, barcodeGapBasePaise: p.effectiveSalePricePaise },
    });
    return { barcodeManualPaise: v, salePriceFrozenAt: now };
}

/**
 * MRP was lowered: a saved barcode above the new MRP is capped to it — that is a
 * barcode save (date + gap stamped). Below MRP nothing moves.
 */
export async function capBarcodeToMrp(id: number): Promise<boolean> {
    const p = await prisma.invProduct.findUnique({
        where:  { id },
        select: { mrpPaise: true, barcodeManualPaise: true, effectiveSalePricePaise: true },
    });
    if (!p || p.mrpPaise == null || p.mrpPaise <= 0 || p.barcodeManualPaise == null || p.barcodeManualPaise <= p.mrpPaise) return false;
    await prisma.invProduct.update({
        where: { id },
        data:  { barcodeManualPaise: p.mrpPaise, salePriceFrozenAt: new Date(), barcodeGapBasePaise: p.effectiveSalePricePaise },
    });
    return true;
}

/**
 * The selling price was changed by hand — re-measure the gap from the price
 * selling now. Barcode price and date are NOT touched. Only products that have
 * a saved barcode (there is no gap to measure otherwise).
 */
export async function rebaseBarcodeGap(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.$executeRaw`UPDATE "InvProduct" SET "barcodeGapBasePaise" = "effectiveSalePricePaise", "updatedAt" = NOW()
        WHERE id = ANY(${ids}::int[]) AND "barcodeManualPaise" IS NOT NULL`;
}
