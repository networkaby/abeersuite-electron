import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { previewConvert, type ConvertDirection } from "@/modules/customer/lib/convertParty";

// GET /api/customer-tools/convert/preview?direction=personToCompany&sourceId=42
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    // Preview is a read — default-open. The convert POST keeps the edit gate.

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
