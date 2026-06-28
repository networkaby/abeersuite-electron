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
            include: { universalVoucher: { select: { id: true, date: true, reference: true, voucherNo: true, description: true, type: true } } },
        });

        // Resolve reprint targets via the direct spine link (G5): InvVoucher (POS
        // sale) → /receipt/invoice; GL RECEIPT/PAYMENT spine → /receipt/payment.
        // Phase 5 5E: the spine IS the financial voucher, so the RECEIPT/PAYMENT
        // case reads straight off the spine — no separate Voucher lookup.
        const uvIds = [...new Set(lines.map((l) => l.universalVoucher.id))];
        const invs = await prisma.invVoucher.findMany({ where: { universalVoucherId: { in: uvIds } }, select: { id: true, universalVoucherId: true } });
        const invByUv = new Map(invs.filter((i) => i.universalVoucherId != null).map((i) => [i.universalVoucherId!, i]));

        let balance = openingBalance;
        const rows = lines.map((l) => {
            const amt    = toNumber(l.amount);
            const debit  = l.type === "DEBIT"  ? amt : null;
            const credit = l.type === "CREDIT" ? amt : null;
            balance += delta(l.type, amt);
            const je  = l.universalVoucher;
            const inv = invByUv.get(je.id);
            const printUrl =
                inv                                                   ? `/receipt/invoice/${inv.id}?kind=POS`
              : je.type === "RECEIPT" || je.type === "PAYMENT"        ? `/receipt/payment/${je.id}`
              :                                                         null;
            return {
                id:          l.id,
                date:        je.date,
                // Prefer the user-facing voucher ref (POS-/RV-/PMT-/CV-) over the GL ref.
                reference:   je.voucherNo ?? je.reference,
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
