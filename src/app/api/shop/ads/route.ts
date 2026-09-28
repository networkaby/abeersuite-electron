import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { handleApiError } from "@/shared/lib/api";
import { isAdLive } from "@/shared/lib/shop/ads";
import { loadShopAds } from "@/shared/lib/shop/loadShopAds";
import { businessTodayIso } from "@/shared/lib/format/formatDate";

/**
 * Public: the ads that may show right now, for the client-rendered shop pages
 * (wishlist, cart) — the server-rendered ones load the pool directly.
 * `staff` tells the page whether `?adPreview=1` may draw placeholders: only a
 * signed-in office session, never a customer.
 */
export async function GET() {
    try {
        const [ads, session] = await Promise.all([loadShopAds(), auth()]);
        const todayIso = businessTodayIso();
        return NextResponse.json(
            { ads: ads.filter((a) => isAdLive(a, todayIso)), staff: Boolean(session?.user) },
            { headers: { "Cache-Control": "private, max-age=300" } },
        );
    } catch (e) {
        return handleApiError(e, "Failed to load ads");
    }
}
