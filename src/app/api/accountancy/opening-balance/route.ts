import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { partyLedgerIds } from "@/modules/accountancy/lib/accountGroups";

// GET /api/accountancy/opening-balance
// Returns: per-account opening balance rows, per-product opening stock rows,
// totals, and the Difference in Opening Balances (auto-parked to suspense).
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const [accounts, products, partyIds] = await Promise.all([
            prisma.account.findMany({
                where: { openingBalance: { not: null } },
                orderBy: [{ name: "asc" }],
                select: {
                    id: true, name: true,
                    openingBalance: true, openingBalanceType: true, openingBalanceDate: true,
                    normalBalance: true,
                    group: { select: { id: true, name: true, type: true } },
                },
            }),
            prisma.invProduct.findMany({
                where: { openingStock: { not: null } },
                orderBy: [{ sku: "asc" }],
                select: {
                    id: true, sku: true, name: true,
                    openingStock: true, openingRate: true, openingValue: true, openingStockDate: true,
                    unit: { select: { code: true, label: true } },
                },
            }),
            // Which of these are parties. Bill-wise details only mean something
            // for a Sundry Debtor or Creditor — a bank or capital account has an
            // opening balance but no bills behind it — so the summary says which
            // rows may be broken up rather than leaving the UI to guess from a
            // group name that could be a sub-group.
            partyLedgerIds(),
        ]);

        const openingDrTotal = accounts
            .filter((a) => a.openingBalanceType === "DEBIT")
            .reduce((s, a) => s + Number(a.openingBalance), 0);
        const openingCrTotal = accounts
            .filter((a) => a.openingBalanceType === "CREDIT")
            .reduce((s, a) => s + Number(a.openingBalance), 0);
        const openingStockTotal = products.reduce((s, p) => s + Number(p.openingValue ?? 0), 0);

        // The "Stock-in-Hand" account, if it has an opening balance, should equal openingStockTotal.
        // Anything left over goes to Difference in Opening Balances.
        // Convention: Σ(Dr) − Σ(Cr) − stockOnly = difference, parked Cr if positive (excess Dr).
        const difference = openingDrTotal - openingCrTotal;

        return NextResponse.json({
            accounts: accounts.map((a) => ({ ...a, isParty: partyIds.has(a.id) })),
            products,
            openingDrTotal,
            openingCrTotal,
            openingStockTotal,
            difference,
            // The suspense ledger holds this when non-zero.
            // sign convention: positive `difference` means more Dr than Cr → parked as Cr.
            suspenseSide:    difference > 0 ? "CREDIT" : difference < 0 ? "DEBIT" : null,
            suspenseAmount:  Math.abs(difference),
        });
    } catch (e) {
        return handleApiError(e, "Failed to load opening balance summary");
    }
}
