import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { loadStorefrontProductsCached } from "@/shared/lib/shop/storefrontProducts";
import { loadBuyAgain } from "@/shared/lib/shop/salesSignals";

/**
 * "Buy again" — products on the signed-in customer's own bills (personal and
 * every linked company), still listed in the shop. Signed out → 401 and the
 * row simply does not show.
 */
export async function GET() {
    try {
        const { context, response } = await requirePortalAccountContext();
        if (response) return response;
        const products = await loadBuyAgain(
            context.options.map((o) => o.accountId),
            await loadStorefrontProductsCached()
        );
        return NextResponse.json(products, { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) {
        return handleApiError(e, "Failed to load your past purchases");
    }
}
