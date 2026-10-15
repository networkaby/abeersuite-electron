import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parseRange } from "@/modules/accountancy/lib/period";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { ledgerStatusFilterUv } from "@/modules/accountancy/lib/aggregateLedger";
import { OPENING_TYPE } from "@/modules/accountancy/lib/openingBills";
import { collapseEditReversals } from "@/modules/accountancy/lib/collapseEditReversals";
import { resolveSourceBatch } from "@/modules/accountancy/lib/journalEntrySource";
import { r2 } from "@/modules/bi/lib/marginEngine";
import { referenceHref, voucherSourceForType } from "@/modules/accountancy/lib/voucherUrls";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { toDateOnly } from "@/shared/lib/format/formatDate";
import { withApiError } from "@/shared/lib/api";

// GET /api/bi/ledger-vs-ledger?a&b&from&to&branchId
//
// Only the vouchers that touch BOTH ledger A and ledger B — Tally's "contra
// ledger" view. A voucher with more ledgers on it shows whole (like Tally);
// the amount is what that voucher posted on A. Running balance starts at zero
// and reads Dr-positive from A's side, so the closing figure is "A vs B".
export const GET = withApiError("Failed to build the ledger vs ledger report", async (req: Request) => {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);
    const branchId = searchParams.get("branchId") || null;
    const a = Number(searchParams.get("a"));
    const b = Number(searchParams.get("b"));

    const branches = await prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    if (!a || !b || a === b) {
        return NextResponse.json({ branches, rows: [], totals: { vouchers: 0, debit: 0, credit: 0, net: 0 } });
    }

    // One read: A's lines whose voucher also carries a line on B.
    const lines = await prisma.voucherGlLine.findMany({
        where: {
            accountId: a,
            universalVoucher: {
                ...ledgerStatusFilterUv(),
                type: { not: OPENING_TYPE },
                date: { gte: from, lte: to },
                ...(branchId ? { branchId } : {}),
                lines: { some: { accountId: b } },
            },
        },
        orderBy: [{ universalVoucher: { date: "asc" } }, { id: "asc" }],
        select: {
            type: true,
            amount: true,
            universalVoucher: {
                select: { id: true, date: true, voucherNo: true, description: true, narration: true, type: true },
            },
        },
    });

    // Fold A's lines per voucher (a voucher may hit A more than once).
    const byVoucher = new Map<number, { uv: (typeof lines)[number]["universalVoucher"]; debit: number; credit: number }>();
    for (const l of collapseEditReversals(lines)) {
        const row = byVoucher.get(l.universalVoucher.id) ?? { uv: l.universalVoucher, debit: 0, credit: 0 };
        if (l.type === "DEBIT") row.debit += toNumber(l.amount);
        else row.credit += toNumber(l.amount);
        byVoucher.set(l.universalVoucher.id, row);
    }

    const sourceMap = await resolveSourceBatch([...byVoucher.keys()]);

    let balance = 0;
    const rows = [...byVoucher.values()].map(({ uv, debit, credit }) => {
        balance += debit - credit;
        return {
            voucherId: uv.id,
            voucherType: uv.type,
            date: toDateOnly(uv.date),
            reference: uv.voucherNo ?? formatUvNo(uv.id),
            description: uv.narration || uv.description || "",
            debit: r2(debit),
            credit: r2(credit),
            balance: r2(balance),
            href: sourceMap.get(uv.id)?.url ?? referenceHref(voucherSourceForType(uv.type), uv.id, uv.type),
        };
    });

    const debit = r2(rows.reduce((s, r) => s + r.debit, 0));
    const credit = r2(rows.reduce((s, r) => s + r.credit, 0));
    return NextResponse.json({
        branches,
        rows,
        totals: { vouchers: rows.length, debit, credit, net: r2(debit - credit) },
    });
});
