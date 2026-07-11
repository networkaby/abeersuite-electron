import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// GET /api/accountancy/opening-balance
// Returns: per-account opening balance rows, per-product opening stock rows,
// totals, and the Difference in Opening Balances (auto-parked to suspense).
export async function GET() {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    try {
        const [accounts, products] = await Promise.all([
            prisma.account.findMany({
                where: { openingBalance: { not: null } },
                orderBy: [{ code: "asc" }],
                select: {
                    id: true, code: true, name: true,
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
            accounts,
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
