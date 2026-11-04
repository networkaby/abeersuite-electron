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
 *
 * Floor rule (owner, 2026-11-04): a saved barcode is never below the lowest
 * price (effectiveSalePricePaise) — POS opens a line at the barcode and refuses
 * anything under the lowest price, so a lower label could never be billed. A
 * lower amount is raised to the lowest price, silently. The floor beats the
 * MRP cap: when the lowest price is itself above MRP, that is a pricing error
 * to fix at the Sale Price, not by printing an unbillable label.
 */

/**
 * Save the AUTO barcode — bands applied to the EFFECTIVE sale price (the price
 * that really sells now: Strategy, Computed or Sale Price), capped at MRP — for
 * these products. So the label always has headroom over the selling price.
 * `onlyMissing` skips products that already have a saved barcode (new-product
 * paths). `skipManual` leaves hand-typed barcodes alone (bulk Update barcode).
 * A product with no effective price is skipped (its barcode stays).
 */
export async function saveAutoBarcodes(ids: number[], opts: { onlyMissing?: boolean; skipManual?: boolean } = {}): Promise<number> {
    if (ids.length === 0) return 0;
    const [rows, bands] = await Promise.all([
        prisma.invProduct.findMany({
            where:  {
                id: { in: ids },
                ...(opts.onlyMissing ? { barcodeManualPaise: null } : {}),
                ...(opts.skipManual ? { barcodeIsManual: false } : {}),
            },
            select: { id: true, mrpPaise: true, effectiveSalePricePaise: true },
        }),
        loadBarcodeBands(),
    ]);
    const now = new Date();
    const ops = rows.flatMap((p) => {
        const raw = barcodeTagPaise(p.effectiveSalePricePaise, p.mrpPaise, bands);
        if (raw == null) return [];
        const tag = Math.max(raw, p.effectiveSalePricePaise ?? 0);
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
 * Save a hand-typed barcode (capped at MRP, raised to the lowest price). Stamps
 * date + gap basis. Returns what was stored.
 */
export async function saveManualBarcode(id: number, pricePaise: number): Promise<{ barcodeManualPaise: number; salePriceFrozenAt: Date } | null> {
    // One statement: the MRP cap reads the row it writes, so an MRP edit landing
    // between a read and a write can never leave the barcode above the new MRP.
    const now = new Date();
    const rows = await prisma.$queryRaw<{ barcodeManualPaise: number }[]>`
        UPDATE "InvProduct" SET
            "barcodeManualPaise"  = GREATEST(
                CASE WHEN "mrpPaise" > 0 AND ${pricePaise}::int > "mrpPaise" THEN "mrpPaise" ELSE ${pricePaise}::int END,
                COALESCE("effectiveSalePricePaise", 0)),
            "barcodeIsManual"     = true,
            "salePriceFrozenAt"   = ${now},
            "barcodeGapBasePaise" = "effectiveSalePricePaise",
            "updatedAt"           = ${now}
        WHERE id = ${id}
        RETURNING "barcodeManualPaise"`;
    if (rows.length === 0) return null;
    return { barcodeManualPaise: rows[0].barcodeManualPaise, salePriceFrozenAt: now };
}

/**
 * MRP was lowered: a saved barcode above the new MRP is capped to it — that is a
 * barcode save (date + gap stamped), but never below the lowest price. Below
 * MRP nothing moves.
 */
export async function capBarcodeToMrp(id: number): Promise<boolean> {
    // One statement, so the cap always uses the MRP that is on the row now.
    // The date is the app's clock, not the DB's NOW(): the column has no zone
    // and Prisma stores UTC, while a counter's Postgres runs on IST — NOW()
    // would be 5½ h off. Labels show it as an IST date (labelItems.localDateOf).
    const now = new Date();
    const n = await prisma.$executeRaw`
        UPDATE "InvProduct" SET
            "barcodeManualPaise"  = GREATEST("mrpPaise", COALESCE("effectiveSalePricePaise", 0)),
            "salePriceFrozenAt"   = ${now},
            "barcodeGapBasePaise" = "effectiveSalePricePaise",
            "updatedAt"           = ${now}
        WHERE id = ${id} AND "mrpPaise" > 0 AND "barcodeManualPaise" > "mrpPaise"
          AND "barcodeManualPaise" <> GREATEST("mrpPaise", COALESCE("effectiveSalePricePaise", 0))`;
    return n > 0;
}

/**
 * The selling price was changed by hand — re-measure the gap from the price
 * selling now. Barcode price and date are NOT touched. Only products that have
 * a saved barcode (there is no gap to measure otherwise).
 */
export async function rebaseBarcodeGap(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.$executeRaw`UPDATE "InvProduct" SET "barcodeGapBasePaise" = "effectiveSalePricePaise", "updatedAt" = ${new Date()}
        WHERE id = ANY(${ids}::int[]) AND "barcodeManualPaise" IS NOT NULL`;
}
