import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { createResponse, listResponse } from "@/shared/lib/address/addressRoutes";

/**
 * GET  /api/portal/addresses — the signed-in customer's own address book.
 * POST /api/portal/addresses — add one (checkout's "Add a new address" too).
 */

export async function GET() {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    return listResponse(context!.customerId);
}

export async function POST(req: Request) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    return createResponse(req, context!.customerId);
}
