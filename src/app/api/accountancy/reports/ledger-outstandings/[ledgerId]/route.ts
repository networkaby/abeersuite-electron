import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { handleApiError } from "@/shared/lib/api";

// GET /api/accountancy/reports/ledger-outstandings/:ledgerId?asOf=YYYY-MM-DD
// Open bills for a single party ledger, with ageing buckets.
export async function GET(
    req: Request,
    { params }: { params: Promise<{ ledgerId: string }> },
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { ledgerId } = await params;
    const accountId = Number(ledgerId);
    if (!Number.isFinite(accountId)) {
        return NextResponse.json({ error: "Invalid ledger id" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    asOf.setHours(23, 59, 59, 999);

    try {
        const data = await getLedgerOutstanding(accountId, asOf);
        if (!data) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });
        return NextResponse.json(data);
    } catch (e) {
        return handleApiError(e, "Failed to load ledger outstandings");
    }
}
