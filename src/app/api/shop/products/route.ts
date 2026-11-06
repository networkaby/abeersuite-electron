import { loadStorefrontProducts, loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";

/** Most products one `?ids=` call returns (a "Recently viewed" row). */
const IDS_MAX = 24;

/**
 * The storefront list. With `?ids=3,9,4` only those products, in that order
 * (from the 5-minute cached list) — what the browser's Recently viewed row
 * asks for, so it never downloads the whole catalogue.
 */
export async function GET(req: Request) {
    try {
        const idsParam = new URL(req.url).searchParams.get("ids");
        if (idsParam != null) {
            const ids = idsParam.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, IDS_MAX);
            const byId = new Map((await loadStorefrontProductsCached()).map((p) => [p.id, p]));
            return NextResponse.json(ids.flatMap((id) => byId.get(id) ?? []));
        }
        return NextResponse.json(await loadStorefrontProducts());
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}
