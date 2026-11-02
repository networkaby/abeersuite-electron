import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { barcodePriceSaveSchema } from "@/shared/lib/schemas/pricingSchemas";
import { saveAutoBarcodes } from "@/modules/pricing-strategy/lib/barcodeStore";

// POST /api/pricing-strategy/barcode-price — "Update barcode" on Update prices.
// Saves the AUTO barcode (bands on each product's EFFECTIVE sale price — the
// price that sells now — MRP-capped) with today's date and the current gap.
// Replaces a hand-typed barcode too when that row is sent (the screen sends
// manual rows only when ticked, with a warning). A product with no effective
// price is skipped. See barcodeStore.ts.
export async function POST(req: Request) {
    const { response } = await requireModuleAccess("pricing-strategy");
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, barcodePriceSaveSchema);
        if (error) return error;
        const saved = await saveAutoBarcodes(data.ids);
        return NextResponse.json({ saved });
    } catch (e) {
        return handleApiError(e, "Failed to save barcode prices");
    }
}
