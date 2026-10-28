import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { loadOwnedBillDetail } from "@/modules/external/portal/portalBillDetail";

/**
 * GET /api/portal/bill/<uvId> — one of the signed-in customer's bills as plain
 * rows (items, charges, tax, total, paid, due), for a My Bills row opened in
 * place. Someone else's bill answers 404, the same as a missing one.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ uvId: string }> }) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;
    const uvId = Number((await params).uvId);
    if (!Number.isInteger(uvId) || uvId <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
        const detail = await loadOwnedBillDetail(customerId, uvId);
        if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(detail, { headers: { "Cache-Control": "private, max-age=60" } });
    } catch (e) {
        return handleApiError(e, "Could not load the bill");
    }
}
