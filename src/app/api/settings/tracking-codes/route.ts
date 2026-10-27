import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { normalizeTrackingCodes, TRACKING_ID_PATTERNS } from "@/shared/lib/shop/trackingCodes";
import { TRACKING_CODES_TAG } from "@/shared/lib/shop/trackingCodes.server";

// Settings → Tracking Codes. Stored on the OrgDefaults singleton; the shop reads
// it through the cached loader, so a save drops that cache.

export async function GET() {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_TRACKING_MANAGE);
    if (response) return response;
    try {
        const od = await prisma.orgDefaults.findUnique({ where: { id: 1 }, select: { trackingCodesJson: true } });
        return NextResponse.json(normalizeTrackingCodes(od?.trackingCodesJson));
    } catch (e) {
        return handleApiError(e, "Failed to load tracking codes");
    }
}

/** Blank, or the id in its right shape — an id goes into inline script. */
const idField = (re: RegExp, label: string) =>
    z.string().trim().toUpperCase().refine((v) => v === "" || re.test(v), `${label} looks wrong`);

const putSchema = z.object({
    ga4Enabled: z.boolean(),
    ga4Id: idField(TRACKING_ID_PATTERNS.ga4Id, "Google Analytics id (G-XXXXXXX)"),
    gtmEnabled: z.boolean(),
    gtmId: idField(TRACKING_ID_PATTERNS.gtmId, "Tag Manager id (GTM-XXXXXX)"),
    metaPixelEnabled: z.boolean(),
    metaPixelId: idField(TRACKING_ID_PATTERNS.metaPixelId, "Meta Pixel id (numbers only)"),
    tiktokPixelEnabled: z.boolean(),
    tiktokPixelId: idField(TRACKING_ID_PATTERNS.tiktokPixelId, "TikTok Pixel id"),
    customEnabled: z.boolean(),
    customHead: z.string().max(20000),
    customBody: z.string().max(20000),
});

export async function PUT(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_TRACKING_MANAGE);
    if (response) return response;
    const { data, error } = await validateRequest(req, putSchema);
    if (error) return error;
    try {
        await prisma.orgDefaults.upsert({
            where: { id: 1 },
            create: { id: 1, trackingCodesJson: data },
            update: { trackingCodesJson: data },
        });
        revalidateTag(TRACKING_CODES_TAG, { expire: 0 });
        return NextResponse.json(normalizeTrackingCodes(data));
    } catch (e) {
        return handleApiError(e, "Failed to save tracking codes");
    }
}
