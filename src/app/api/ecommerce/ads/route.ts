import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { normalizeAds } from "@/shared/lib/shop/ads";
import { loadShopAds } from "@/shared/lib/shop/loadShopAds";

// Owner-managed storefront ad inventory (Ecommerce → Ads) — the whole list is
// saved in one go, same as the home layout. Stored on OrgDefaults (id=1).

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const ads = await loadShopAds();
        return NextResponse.json({ ads });
    } catch (e) {
        return handleApiError(e, "Failed to load ads");
    }
}

// Loosely shaped on purpose — normalizeAds() is the real sanitizer. Zod only
// guards the outer shape so a garbled body never reaches it.
const putSchema = z.array(z.record(z.string(), z.unknown()));

export async function PUT(req: Request) {
    const { response } = await requireModuleAccess("e-commerce");
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        const ads = normalizeAds(data);
        await prisma.orgDefaults.update({
            where: { id: 1 },
            data: { storefrontAdsJson: ads },
        });
        return NextResponse.json({ ads });
    } catch (e) {
        return handleApiError(e, "Failed to save ads");
    }
}
