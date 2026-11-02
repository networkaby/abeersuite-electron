import { barcodeTagPaise, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";

/**
 * InvProduct.salePriceFrozenAt is the AGE OF THE PRINTED BARCODE PRICE (manual or
 * auto) — the secret date code on labels (lib/secretDateCode.ts) is read from it.
 * It moves only when the tag itself moves: a Sale Price save, manual barcode edit
 * or MRP edit that leaves the printed ₹ unchanged keeps the old date. No tag → null.
 */
type TagInputs = { savedSalePricePaise: number | null; mrpPaise: number | null; barcodeManualPaise: number | null };

export function nextBarcodeDate(
    before: TagInputs & { salePriceFrozenAt: Date | null },
    after: TagInputs,
    bands: BarcodeBand[],
    now: Date,
): Date | null {
    const tagOf = (t: TagInputs) => barcodeTagPaise(t.savedSalePricePaise, t.mrpPaise, bands, t.barcodeManualPaise);
    const newTag = tagOf(after);
    if (newTag == null) return null;
    if (newTag === tagOf(before) && before.salePriceFrozenAt) return before.salePriceFrozenAt;
    return now;
}
