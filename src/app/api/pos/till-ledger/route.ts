// GET /api/pos/till-ledger?counterId=&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Counter cash book — the till (drawer) account's ledger with a running balance.
// Combines everything that hits the till: POS cash sales, receipts collected
// (Rcv), expenditures paid (Exp), and the opening/closing vault contras. Cash
// drops are log-only (no GL) so they don't appear. Defaults to today; pass
// from/to to view another date range. Each row carries a reprint URL where the
// source voucher is printable.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";

export async function GET(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    try {
        const sp = new URL(req.url).searchParams;
        const counterId = Number(sp.get("counterId"));
        if (!Number.isFinite(counterId)) return NextResponse.json({ error: "counterId is required" }, { status: 400 });

        const counter = await prisma.posCounter.findUnique({
            where:  { id: counterId },
            select: { id: true, name: true, tillAccountId: true, tillAccount: { select: { name: true } } },
        });
        if (!counter) return NextResponse.json({ error: "Counter not found" }, { status: 404 });
        const tid = counter.tillAccountId;

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const from = sp.get("from") ? new Date(sp.get("from")!) : todayStart;
        const to   = sp.get("to")   ? new Date(sp.get("to")!)   : now;
        to.setHours(23, 59, 59, 999);

        // Till is a Cash-in-Hand (DEBIT-normal) account: debit raises the drawer.
        const delta = (type: "DEBIT" | "CREDIT", amt: number) => (type === "DEBIT" ? amt : -amt);

        // Opening balance — every posted till line strictly before `from`.
        const openingLines = await prisma.voucherGlLine.findMany({
            where:  { accountId: tid, universalVoucher: { ...ledgerStatusFilterUv(), date: { lt: from } } },
            select: { type: true, amount: true },
        });
        const openingBalance = openingLines.reduce((b, l) => b + delta(l.type, toNumber(l.amount)), 0);

        // Lines within the range, oldest first so the running balance accumulates.
        const lines = await prisma.voucherGlLine.findMany({
            where:   { accountId: tid, universalVoucher: { ...ledgerStatusFilterUv(), date: { gte: from, lte: to } } },
            orderBy: [{ universalVoucher: { date: "asc" } }, { id: "asc" }],
            include: { universalVoucher: { select: { id: true, date: true, reference: true, description: true, sourceJournalEntryId: true } } },
        });

        // Resolve reprint targets: InvVoucher (POS sale) → /receipt/invoice; GL
        // RECEIPT/PAYMENT voucher → /receipt/payment. Contras have no receipt.
        const jeIds = [...new Set(lines.map((l) => l.universalVoucher.sourceJournalEntryId).filter((x): x is number => x != null))];
        const [invs, vouchers] = await Promise.all([
            prisma.invVoucher.findMany({ where: { journalEntryId: { in: jeIds } }, select: { id: true, journalEntryId: true, reference: true } }),
            prisma.voucher.findMany({ where: { journalEntryId: { in: jeIds } }, select: { id: true, journalEntryId: true, type: true, reference: true } }),
        ]);
        const invByJe = new Map(invs.filter((i) => i.journalEntryId != null).map((i) => [i.journalEntryId!, i]));
        const vByJe   = new Map(vouchers.filter((v) => v.journalEntryId != null).map((v) => [v.journalEntryId!, v]));

        let balance = openingBalance;
        const rows = lines.map((l) => {
            const amt    = toNumber(l.amount);
            const debit  = l.type === "DEBIT"  ? amt : null;
            const credit = l.type === "CREDIT" ? amt : null;
            balance += delta(l.type, amt);
            const je  = l.universalVoucher;
            const inv = je.sourceJournalEntryId != null ? invByJe.get(je.sourceJournalEntryId) : undefined;
            const v   = je.sourceJournalEntryId != null ? vByJe.get(je.sourceJournalEntryId) : undefined;
            const printUrl =
                inv                                                 ? `/receipt/invoice/${inv.id}?kind=POS`
              : v && (v.type === "RECEIPT" || v.type === "PAYMENT") ? `/receipt/payment/${v.id}`
              :                                                       null;
            return {
                id:          l.id,
                date:        je.date,
                // Prefer the user-facing voucher ref (POS-/RV-/PV-/CV-) over the GL ref.
                reference:   inv?.reference ?? v?.reference ?? je.reference,
                particulars: je.description ?? l.description ?? "",
                debit,
                credit,
                balance,
                printUrl,
            };
        });

        return NextResponse.json({
            counter:        { id: counter.id, name: counter.name, tillAccountName: counter.tillAccount.name },
            from:           from.toISOString(),
            to:             to.toISOString(),
            openingBalance,
            closingBalance: balance,
            rows,
        });
    } catch (e) {
        return handleApiError(e, "Failed to load till ledger");
    }
}
