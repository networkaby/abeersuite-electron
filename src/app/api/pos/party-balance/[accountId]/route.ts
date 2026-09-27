import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { loadNormalBalanceMap, aggregateClosingAsOf } from "@/modules/accountancy/lib/aggregateLedger";

// GET /api/pos/party-balance/[accountId]
// One party's ledger balance, for the POS "Rcv" dialog — so the cashier sees
// what is due before taking the money.
//
// Summed from the GL plus the master opening, with no date ceiling — the same
// read as `closingForAccounts`, which the POS customer panel and the sale's
// credit gate use, so all three agree. Deliberately NOT the account-snapshot:
// that one resolves tiers, loyalty, turnover and tickets to show a customer
// panel; this dialog needs one number.
//
//   due > 0 → the party owes us · due < 0 → the party holds an advance
//
// Signed on the DEBIT side whatever the ledger's own nature, so a supplier
// picked here still reads the right way round.
export async function GET(_: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isFinite(accountId)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    try {
        const nbMap = await loadNormalBalanceMap([accountId]);
        const nb = nbMap.get(accountId);
        if (!nb) return NextResponse.json({ error: "Account not found" }, { status: 404 });

        const closing = (await aggregateClosingAsOf(null, nbMap, [accountId])).get(accountId) ?? 0;
        const due = nb === "DEBIT" ? closing : -closing;

        return NextResponse.json({ due: Math.round(due * 100) / 100 });
    } catch (e) {
        return handleApiError(e, "Failed to load party balance");
    }
}
