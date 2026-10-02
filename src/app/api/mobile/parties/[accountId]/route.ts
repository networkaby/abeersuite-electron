import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PARTY_DETAIL_PERMISSIONS } from "@/modules/mobile/mobileAccess";
import { handleApiError } from "@/shared/lib/api";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { businessToday } from "@/shared/lib/format/formatDate";
import { buildPartyUpiLink, parsePartyBank } from "@/shared/lib/parties/partyBank";
import { partyBalances } from "@/modules/mobile/partyBalances";

// GET /api/mobile/parties/[accountId]
//
// One party for the phone: its ledger balance AND its unpaid bills, in one call.
// Both are needed because they are not always the same figure — money received
// or paid "on account" (not against any bill) moves the balance but no bill — and
// a salesman shown ₹47,438 on the list and ₹47,428 on the bills must see why.
// Bills come from the Receivables engine (`getLedgerOutstanding`), both sides.
//
// Also what the Pay / Receive form needs from the party: each bill's spine id
// (what a bill-wise settlement links to) and the party's own UPI link, when its
// Bank tab carries a UPI ID (the same link the office scan-to-pay QR encodes).
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    // Opened from party search, receivables or payables — any of their ticks.
    const { response } = await requireAnyPermission(...PARTY_DETAIL_PERMISSIONS);
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const asOf = businessToday();
        asOf.setHours(23, 59, 59, 999);
        const [outstanding, balances, owner] = await Promise.all([
            getLedgerOutstanding(accountId, asOf),
            partyBalances([accountId]),
            prisma.account.findUnique({
                where: { id: accountId },
                select: { person: { select: { bankJson: true } }, company: { select: { bankJson: true } } },
            }),
        ]);
        if (!outstanding) return NextResponse.json({ error: "Party not found" }, { status: 404 });

        const bank = parsePartyBank(owner?.person?.bankJson ?? owner?.company?.bankJson ?? null);

        return NextResponse.json({
            accountId,
            name: outstanding.accountName,
            balance: balances.get(accountId) ?? 0,
            upiLink: buildPartyUpiLink(bank, outstanding.accountName) || null,
            bills: outstanding.bills.map((b) => ({
                key: `${b.kind}:${b.id}`,
                universalVoucherId: b.universalVoucherId,
                ref: b.ref,
                billDate: b.billDate,
                totalAmount: b.totalAmount,
                outstanding: b.outstanding,
                side: b.side,
                daysOverdue: b.daysOverdue,
            })),
        });
    } catch (e) {
        return handleApiError(e, "Could not load this party");
    }
}
