import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError } from "@/shared/lib/api";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
import { ensureFeeds, feedState } from "@/modules/campaigns/lib/productFeed";

/**
 * GET  /api/campaigns/feeds — the stored feed state (when built, when checked,
 *      how many products) plus how many products the shop lists. No rebuild.
 * POST /api/campaigns/feeds — "Rebuild now": skips the once-a-day gate, for a
 *      change the inputs hash cannot see (a group renamed, shop rules changed).
 * Both ride the Product Feeds sidebar link.
 */

const requireFeedsPage = () => requireAnyPermission(sidebarChildPermissionId("campaigns", "product-feeds"));

export async function GET() {
    const { response } = await requireFeedsPage();
    if (response) return response;
    try {
        const [state, listed] = await Promise.all([feedState(), prisma.invProduct.count({ where: { isListedInShop: true, isActive: true } })]);
        return NextResponse.json({ state, listed });
    } catch (e) {
        return handleApiError(e, "Failed to read the feed state");
    }
}

export async function POST() {
    const { response } = await requireFeedsPage();
    if (response) return response;
    try {
        return NextResponse.json({ state: await ensureFeeds(true) });
    } catch (e) {
        return handleApiError(e, "Failed to rebuild the feeds");
    }
}
