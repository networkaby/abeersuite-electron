import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { parseNumericId } from "@/shared/lib/api/parseNumericId";
import { buildDealCustomerHistory } from "@/modules/deals/lib/dealCustomerHistory";

// GET /api/deals/[id]/customer-history — the deal screen's third column:
// buying history, dues, communication and a Hot / Warm / Cold read.
// Browser-cached 2 min (the panel also keeps it in memory per deal).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;
    const id = parseNumericId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const history = await buildDealCustomerHistory(id);
        if (!history) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
        return NextResponse.json(history, { headers: { "Cache-Control": "private, max-age=120" } });
    } catch (e) {
        return handleApiError(e, "Failed to load customer history");
    }
}
