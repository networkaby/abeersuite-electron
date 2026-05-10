import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { getOutstandings } from "@/modules/accountancy/lib/outstandings";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

// GET /api/finance/reports/receivables?asOf=YYYY-MM-DD
// Aggregates open bills under "Sundry Debtors" group by party,
// with ageing buckets (0-30 / 30-60 / 60-90 / 90+).
export async function GET(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    asOf.setHours(23, 59, 59, 999);

    try {
        const data = await getOutstandings(ACCOUNT_GROUPS.SUNDRY_DEBTORS, asOf);
        return NextResponse.json(data);
    } catch (e) {
        return handleApiError(e, "Failed to load receivables");
    }
}
