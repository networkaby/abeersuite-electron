import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getOutstandings } from "@/modules/tally/lib/outstandings";

// GET /api/finance/reports/receivables?asOf=YYYY-MM-DD
// Aggregates open bills under "Sundry Debtors" group by party,
// with ageing buckets (0-30 / 30-60 / 60-90 / 90+).
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    asOf.setHours(23, 59, 59, 999);

    try {
        const data = await getOutstandings("Sundry Debtors", asOf);
        return NextResponse.json(data);
    } catch (err) {
        console.error("[receivables]", err);
        return NextResponse.json({ error: "Failed to load receivables" }, { status: 500 });
    }
}
