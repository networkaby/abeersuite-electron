import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import { QR_SLIDE_PRODUCTS_MAX, type QrSlideProduct } from "@/modules/pos/lib/qrSlides";

/**
 * GET /api/pos/display-slides — offer products for the customer display's idle
 * slideshow (QR display, DQ11). The counter app fetches this a few times a day
 * and hands it to the display bridge, which draws each one and keeps it on the PC.
 *
 * "Offer" = what the shop itself shows: listed, orderable, with a photo, and
 * either priced below MRP or carrying a shop badge. Biggest saving first. The
 * shop's own 5-minute cached list, so a counter asking costs no extra query.
 */

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const rows = (await loadStorefrontProductsCached())
            .map((p) => ({ p, image: p.imageUrl ?? p.galleryUrls[0] ?? null }))
            .filter(({ p, image }) => p.orderable && p.pricePaise > 0 && image && /^https?:\/\//.test(image))
            .map(({ p, image }) => {
                const saved = p.mrpPaise != null && p.mrpPaise > p.pricePaise ? p.mrpPaise - p.pricePaise : 0;
                return { p, image: image!, saved, pct: saved > 0 ? saved / p.mrpPaise! : 0 };
            })
            .filter(({ p, saved }) => saved > 0 || p.badge)
            // Biggest % off first, then the bigger rupee saving; badge-only ones last.
            .sort((a, b) => b.pct - a.pct || b.saved - a.saved)
            .slice(0, QR_SLIDE_PRODUCTS_MAX);

        const products: QrSlideProduct[] = rows.map(({ p, image }) => ({
            id: p.id,
            name: p.displayName,
            price: p.pricePaise / 100,
            mrp: p.mrpPaise != null && p.mrpPaise > p.pricePaise ? p.mrpPaise / 100 : null,
            badge: p.badge,
            image,
        }));
        return NextResponse.json({ products }, { headers: { "Cache-Control": "private, max-age=3600" } });
    } catch (e) {
        return handleApiError(e, "Failed to load the display slides");
    }
}
