import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { parseRange } from "@/modules/accountancy/lib/period";
import { handleApiError } from "@/shared/lib/api";

// GET /api/finance/reports/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Counts of every voucher kind in the period plus master-table totals — the
// data that powers Tally's "Statistics" screen.
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const { from, to } = parseRange(searchParams);

    try {
        const dateRange = { gte: from, lte: to };

        const [
            voucherByType,
            invVoucherByType,
            invoiceCount,
            cancelledInvoices,
            journalEntryCount,
            accountGroupCount,
            ledgerCount,
            partyAccountCount,
            stockItemCount,
            unitCount,
            stockGroupCount,
            categoryCount,
            brandCount,
        ] = await Promise.all([
            prisma.voucher.groupBy({
                by: ["type", "status"],
                where: { date: dateRange, deletedAt: null },
                _count: { _all: true },
            }),
            prisma.invVoucher.groupBy({
                by: ["type", "status"],
                where: { date: dateRange, deletedAt: null },
                _count: { _all: true },
            }),
            prisma.invoice.count({
                where: { issueDate: dateRange, deletedAt: null, status: { not: "VOID" } },
            }),
            prisma.invoice.count({
                where: { issueDate: dateRange, deletedAt: null, status: "VOID" },
            }),
            prisma.journalEntry.count({
                where: { date: dateRange, deletedAt: null },
            }),
            prisma.accountGroup.count({ where: { isActive: true } }),
            prisma.account.count({
                where: { isActive: true, personId: null, companyId: null },
            }),
            prisma.account.count({
                where: { isActive: true, OR: [{ personId: { not: null } }, { companyId: { not: null } }] },
            }),
            prisma.invProduct.count({ where: { isActive: true } }),
            prisma.invUnit.count({ where: { isActive: true } }),
            prisma.invProductGroup.count({ where: { isActive: true } }),
            prisma.invCategory.count({ where: { isActive: true } }),
            prisma.invBrand.count({ where: { isActive: true } }),
        ]);

        // Roll up by voucher type, splitting posted vs draft vs cancelled.
        type Bucket = { type: string; total: number; posted: number; draft: number; cancelled: number };
        const rollup = (rows: { type: string; status: string; _count: { _all: number } }[]): Bucket[] => {
            const map = new Map<string, Bucket>();
            for (const r of rows) {
                const b = map.get(r.type) ?? { type: r.type, total: 0, posted: 0, draft: 0, cancelled: 0 };
                b.total += r._count._all;
                if (r.status === "POSTED") b.posted += r._count._all;
                else if (r.status === "DRAFT") b.draft += r._count._all;
                else if (r.status === "CANCELLED") b.cancelled += r._count._all;
                map.set(r.type, b);
            }
            return Array.from(map.values()).sort((a, b) => a.type.localeCompare(b.type));
        };

        return NextResponse.json({
            from: from.toISOString(),
            to:   to.toISOString(),
            voucherTypes:    rollup(voucherByType),
            invVoucherTypes: rollup(invVoucherByType),
            other: {
                invoices:          invoiceCount,
                cancelledInvoices,
                journalEntries:    journalEntryCount,
            },
            masters: {
                groups:      accountGroupCount,
                ledgers:     ledgerCount,
                parties:     partyAccountCount,
                stockItems:  stockItemCount,
                stockGroups: stockGroupCount,
                categories:  categoryCount,
                brands:      brandCount,
                units:       unitCount,
            },
        });
    } catch (e) {
        return handleApiError(e, "Failed to load statistics");
    }
}
