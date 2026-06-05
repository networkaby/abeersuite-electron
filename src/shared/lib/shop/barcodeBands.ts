import { prisma } from "@/shared/lib/prisma/prismaClient";
import { normalizeBarcodeBands, type BarcodeBand } from "@/shared/lib/pricing/barcodePrice";

/**
 * Load the org's printed-barcode bands (OrgDefaults.barcodeBandsJson), falling
 * back to the seed defaults when unset. Shared by the storefront product APIs,
 * the COD order intake, and the ecommerce admin product routes so every surface
 * derives the same barcode tag price. Server-only (imports prisma).
 */
export async function loadBarcodeBands(): Promise<BarcodeBand[]> {
    const od = await prisma.orgDefaults.findUnique({
        where: { id: 1 },
        select: { barcodeBandsJson: true },
    });
    return normalizeBarcodeBands(od?.barcodeBandsJson);
}
