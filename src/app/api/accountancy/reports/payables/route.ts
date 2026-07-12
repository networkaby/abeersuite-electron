import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { getOutstandings } from "@/modules/accountancy/lib/outstandings";
import { handleApiError } from "@/shared/lib/api";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";

// Heavy aggregation: account-hierarchy walk + unbounded open-bills scan per
// creditor. Give Vercel headroom past the default 10s function limit.
export const maxDuration = 60;

// GET /api/accountancy/reports/payables?asOf=YYYY-MM-DD
// Aggregates open bills under "Sundry Creditors" group by party,
// with ageing buckets (0-30 / 30-60 / 60-90 / 90+).
export async function GET(req: Request) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    asOf.setHours(23, 59, 59, 999);

    try {
        const data = await getOutstandings(ACCOUNT_GROUPS.SUNDRY_CREDITORS, asOf);
        return NextResponse.json(data);
    } catch (e) {
        return handleApiError(e, "Failed to load payables");
    }
}
