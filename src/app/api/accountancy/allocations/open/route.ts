import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { loadLinkableDocs, loadDocOpen } from "@/modules/accountancy/lib/billLink";

// GET /api/accountancy/allocations/open?accountId=N[&excludeId=M][&side=1|-1]
//
// Everything of this party that still has something open — sale, POS, purchase,
// receipt, payment, credit/debit note, journal alike — oldest first, so the
// bill-wise popup can offer a tick-list and its Auto button can walk the same
// order (oldest first) with no re-sorting.
//
// `side` is +1 when the party owes us (receivable) and −1 when we owe them
// (payable). A link is only legal between opposite sides.
//
// Pass `excludeId` — the voucher the user has open — and the answer comes back
// already correct for it: that voucher is left out of the list, `self` says how
// much of it is free to place, and the list is narrowed to the side it can
// actually settle. The caller then needs to know nothing about signs.
//
// One list, keyed by SPINE id. The old shape split invoices from vouchers and
// returned `VoucherDetail.id` for the invoice half, which is a different id space
// from the one links live in — posting it back would have linked the wrong
// document.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const accountId = Number(searchParams.get("accountId"));
    if (!Number.isFinite(accountId) || accountId <= 0) {
        return NextResponse.json({ error: "accountId required" }, { status: 400 });
    }
    const excludeRaw = Number(searchParams.get("excludeId"));
    const excludeId = Number.isFinite(excludeRaw) && excludeRaw > 0 ? excludeRaw : undefined;
    const sideRaw = searchParams.get("side");
    const askedSide = sideRaw === "1" ? 1 : sideRaw === "-1" ? -1 : undefined;

    const self = excludeId !== undefined ? await loadDocOpen(prisma, accountId, excludeId) : null;
    // An explicit `side` wins; otherwise the open voucher's own side decides, and
    // we offer only the opposite one — the only side a link is legal against.
    const side = askedSide ?? (self ? (self.side === 1 ? -1 : 1) : undefined);

    const docs = await loadLinkableDocs(prisma, accountId, { excludeId, side });

    // The party's opening balance while it is still a bare figure on the master.
    // Reported as the fact it is, rather than left for a caller to infer by
    // subtracting the documents from the ledger balance — that subtraction is
    // only as fresh as the balance the caller happens to hold, and a stale one
    // invents an opening balance that does not exist.
    const account = await prisma.account.findUnique({
        where:  { id: accountId },
        select: { openingBalance: true, openingBalanceType: true },
    });

    return NextResponse.json({
        docs,
        self,
        scalarOpening:     account?.openingBalance != null ? Number(account.openingBalance) : null,
        scalarOpeningType: account?.openingBalanceType ?? null,
        receivableTotal: docs.filter((d) => d.side === 1).reduce((s, d) => s + d.open, 0),
        payableTotal:    docs.filter((d) => d.side === -1).reduce((s, d) => s + d.open, 0),
    });
}
