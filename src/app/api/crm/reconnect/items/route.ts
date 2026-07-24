import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { buildCustomerPurchaseProfile } from "@/modules/crm/lib/customerItems";

// GET /api/crm/reconnect/items?kind=person|company&id=123
// The right-pane "Items" tab: what this customer normally buys (buying behaviour).
export async function GET(req: Request) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;
    try {
        const sp = new URL(req.url).searchParams;
        const kind = sp.get("kind");
        const id = Number(sp.get("id"));
        if ((kind !== "person" && kind !== "company") || !Number.isInteger(id) || id < 1) {
            return NextResponse.json({ error: "kind (person|company) and a positive id are required" }, { status: 400 });
        }
        const profile = await buildCustomerPurchaseProfile({ kind, id });
        return NextResponse.json(profile);
    } catch (e) {
        return handleApiError(e, "Failed to load items");
    }
}
