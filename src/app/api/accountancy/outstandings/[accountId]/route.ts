import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { handleApiError } from "@/shared/lib/api";
import { businessToday } from "@/shared/lib/format/formatDate";

// GET /api/accountancy/outstandings/[accountId]?asOf=YYYY-MM-DD
//
// One party's open bills — the same receivables engine the Receivables and
// Payables reports use, read for a single ledger instead of a whole group. The
// customer profile's Outstanding tab is the caller: a party screen must not
// pull the entire book down to show one customer's bills.
//
// Both directions are returned ("BOTH" inside `getLedgerOutstanding`), so a
// party who is our customer AND our supplier sees each side's open bills here.
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isFinite(accountId)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const asOfParam = new URL(req.url).searchParams.get("asOf");
    const asOf = asOfParam ? new Date(asOfParam) : businessToday();
    asOf.setHours(23, 59, 59, 999);

    try {
        const data = await getLedgerOutstanding(accountId, asOf);
        if (!data) return NextResponse.json({ error: "Account not found" }, { status: 404 });
        return NextResponse.json(data);
    } catch (e) {
        return handleApiError(e, "Failed to load this party's outstanding bills");
    }
}
