import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { previewMerge, type MergeKind } from "@/modules/customer/lib/convertParty";

// GET /api/customer-tools/merge/preview?kind=person&winnerId=4&loserId=3
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    // Preview is a read — default-open. The merge POST keeps the edit gate.

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind") as MergeKind | null;
    const winnerId = Number(searchParams.get("winnerId"));
    const loserId = Number(searchParams.get("loserId"));

    if (kind !== "person" && kind !== "company") {
        return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!Number.isFinite(winnerId) || winnerId <= 0 || !Number.isFinite(loserId) || loserId <= 0) {
        return NextResponse.json({ error: "Invalid winnerId or loserId" }, { status: 400 });
    }

    try {
        const preview = await previewMerge(kind, winnerId, loserId);
        return NextResponse.json(preview);
    } catch (error) {
        return handleApiError(error, "Failed to preview merge");
    }
}
