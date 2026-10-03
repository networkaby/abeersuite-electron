import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PARTY_DETAIL_PERMISSIONS } from "@/modules/mobile/lib/mobileAccess";
import { handleApiError } from "@/shared/lib/api";
import { getLedgerOutstanding } from "@/modules/accountancy/lib/outstandings";
import { businessToday } from "@/shared/lib/format/formatDate";
import { buildPartyUpiLink, parsePartyBank } from "@/shared/lib/parties/partyBank";
import { partyBalances } from "@/modules/mobile/lib/partyBalances";
import { booksUnchangedSince } from "@/modules/mobile/lib/booksUnchanged";
import { parseSince } from "@/shared/lib/prisma/counterMode";
import { supplierHidden } from "@/modules/mobile/lib/supplierGuard";

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
//
// `?since=`: `{ unchanged: true }` when nothing in the books (booksUnchangedSince) and not
// this party's own record (its UPI ID) has changed since — no recompute.
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    // Opened from party search, receivables or payables — any of their ticks.
    const { user, response } = await requireAnyPermission(...PARTY_DETAIL_PERMISSIONS);
    if (response) return response;

    const accountId = Number((await params).accountId);
    if (!Number.isInteger(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    // A supplier, without "Show suppliers": as if it did not exist.
    if (await supplierHidden(accountId, user.permissions)) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    try {
        const now = new Date();
        const sinceParam = new URL(req.url).searchParams.get("since");
        if (await booksUnchangedSince(sinceParam, now)) {
            const since = parseSince(sinceParam)!;
            const edited = await prisma.account.findFirst({
                where: {
                    id: accountId,
                    OR: [{ person: { updatedAt: { gt: since } } }, { company: { updatedAt: { gt: since } } }],
                },
                select: { id: true },
            });
            if (!edited) return NextResponse.json({ unchanged: true, computedAt: now.toISOString() });
        }

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
            computedAt: now.toISOString(),
            accountId,
            name: outstanding.accountName,
            balance: balances.get(accountId) ?? 0,
            upiLink: buildPartyUpiLink(bank, outstanding.accountName) || null,
            bills: outstanding.bills.map((b) => ({
                key: `${b.kind}:${b.id}`,
                universalVoucherId: b.universalVoucherId,
                ref: b.ref,
                billDate: b.billDate,
                dueDate: b.dueDate,
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
