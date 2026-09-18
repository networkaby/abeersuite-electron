import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { loadReconciliation } from "@/modules/accountancy/lib/bankReconciliation";
import { ISO_DATE, accountIdOf, reconError } from "@/modules/accountancy/lib/bankReconRoute";

// GET /api/accountancy/bank-reconciliation/[accountId]?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Everything the reconcile screen needs for one bank ledger in one read: the
// ledger and its lock, the statement lines and book entries of the period with
// their match state, the uploads, and the reconciliation summary (which looks at
// everything up to `to`, not only the period — an unpresented cheque from last
// month still explains today's difference).
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    const { id, error: idError } = accountIdOf(await params);
    if (idError) return idError;

    const { searchParams } = new URL(req.url);
    const today = businessTodayIso();
    const to = searchParams.get("to") ?? today;
    const from = searchParams.get("from") ?? `${to.slice(0, 4)}-01-01`;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return NextResponse.json({ error: "Expected yyyy-mm-dd" }, { status: 400 });

    try {
        return NextResponse.json(await loadReconciliation(id, from, to));
    } catch (e) {
        return reconError(e, "Failed to load bank reconciliation");
    }
}
