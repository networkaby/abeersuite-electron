import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { reconnectFilterSchema } from "@/shared/lib/schemas/reconnectSchema";
import { findReconnectCandidates } from "@/modules/crm/lib/reconnectCandidates";

// GET /api/crm/reconnect/candidates
// The middle-pane list: customers ranked quietest-first for the active filter.
export async function GET(req: Request) {
    const { response } = await requireModuleAccess("crm");
    if (response) return response;
    try {
        const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
        const parsed = reconnectFilterSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid filter", issues: parsed.error.flatten() }, { status: 400 });
        }
        const result = await findReconnectCandidates(parsed.data);
        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to load candidates");
    }
}
