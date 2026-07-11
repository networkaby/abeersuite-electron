import { NextResponse } from "next/server";
import { requireAuth, hasPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { previewConvert, type ConvertDirection } from "@/modules/customer/lib/convertParty";

// GET /api/customer-tools/convert/preview?direction=personToCompany&sourceId=42
export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    // Page-level gate uses CUSTOMERS_EDIT + COMPANIES_MANAGE together — the
    // converter creates one party type and tombstones the other.
    if (
        !hasPermission(user, PERMISSIONS.CUSTOMERS_EDIT)
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const direction = searchParams.get("direction") as ConvertDirection | null;
    const sourceIdRaw = searchParams.get("sourceId");

    if (direction !== "personToCompany" && direction !== "companyToPerson") {
        return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
    }
    const sourceId = Number(sourceIdRaw);
    if (!Number.isFinite(sourceId) || sourceId <= 0) {
        return NextResponse.json({ error: "Invalid sourceId" }, { status: 400 });
    }

    try {
        const preview = await previewConvert(direction, sourceId);
        return NextResponse.json(preview);
    } catch (error) {
        return handleApiError(error, "Failed to preview conversion");
    }
}
