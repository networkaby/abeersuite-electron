import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { previewMerge, type MergeKind } from "@/modules/customer/lib/convertParty";

// GET /api/customer-tools/merge/preview?kind=person&winnerId=4&loserId=3
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    if (
        !hasPermission(user, PERMISSIONS.CUSTOMERS_EDIT) ||
        !hasPermission(user, PERMISSIONS.COMPANIES_MANAGE)
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
