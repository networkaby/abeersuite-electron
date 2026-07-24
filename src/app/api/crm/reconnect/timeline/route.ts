import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { buildCustomerTimeline } from "@/modules/crm/lib/customerTimeline";

// GET /api/crm/reconnect/timeline?kind=person|company&id=123
// The right-pane feed: one customer's merged timeline + suggested talking points.
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
        const timeline = await buildCustomerTimeline({ kind, id });
        return NextResponse.json(timeline);
    } catch (e) {
        return handleApiError(e, "Failed to load timeline");
    }
}
