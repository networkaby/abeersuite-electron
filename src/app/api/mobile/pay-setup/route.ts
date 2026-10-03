import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission, userCanVoucher } from "@/shared/lib/auth/permissions";
import { COMBINED_BRANCH, resolveActiveBranchId } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { MONEY_ACCOUNT_GROUPS } from "@/modules/accountancy/lib/moneyAccount";
import { accountIdsUnderGroup } from "@/modules/accountancy/lib/accountGroups";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { PARTY_DETAIL_PERMISSIONS } from "@/modules/mobile/lib/mobileAccess";

// GET /api/mobile/pay-setup
//
// What the phone's Pay / Receive form needs besides the party itself:
//   • canPay / canReceive — the Role page's Payment / Receipt CREATE and POST
//     ticks, the same two the office voucher API checks (the phone saves through
//     that API, so these only decide whether to show the buttons);
//   • the cash / bank / OD ledgers money can be paid from or received in — the
//     office "Paid from" picker's own rule (MONEY_ACCOUNT_GROUPS);
//   • the expense ledgers a payment can go straight to (quick Pay: rent, tea…) —
//     every ledger under Direct / Indirect Expenses, sub-groups included;
//   • the branches this person may post in, and which one the voucher would take.
// The same for every party, so the phone keeps one copy.
export async function GET(req: Request) {
    const { user, response } = await requireAnyPermission(...PARTY_DETAIL_PERMISSIONS);
    if (response) return response;

    const canPay = userCanVoucher(user, "PAYMENT", "create") && userCanVoucher(user, "PAYMENT", "post");
    const canReceive = userCanVoucher(user, "RECEIPT", "create") && userCanVoucher(user, "RECEIPT", "post");
    if (!canPay && !canReceive) {
        return NextResponse.json({ canPay, canReceive, moneyLedgers: [], expenseLedgers: [], branches: [], defaultBranchId: null });
    }

    try {
        const isAdmin = user.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        const expenseIds = canPay
            ? (await Promise.all([
                accountIdsUnderGroup(ACCOUNT_GROUPS.DIRECT_EXPENSES),
                accountIdsUnderGroup(ACCOUNT_GROUPS.INDIRECT_EXPENSES),
            ])).flat()
            : [];
        const [moneyLedgers, expenseLedgers, branches] = await Promise.all([
            prisma.account.findMany({
                // Counter tills move only through a POS shift — never offered here.
                where: { isActive: true, counterTills: { none: {} }, group: { name: { in: [...MONEY_ACCOUNT_GROUPS] } } },
                select: { id: true, name: true, group: { select: { name: true } } },
                orderBy: { name: "asc" },
            }),
            expenseIds.length === 0 ? Promise.resolve([]) : prisma.account.findMany({
                where: { id: { in: expenseIds }, isActive: true },
                select: { id: true, name: true, group: { select: { name: true } } },
                orderBy: { name: "asc" },
            }),
            prisma.branch.findMany({
                where: isAdmin ? {} : { id: { in: user.branchIds } },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
            }),
        ]);

        // The branch the voucher API would stamp — header / cookie / first assigned.
        // "All branches" cannot post, so it falls to the first real one.
        let defaultBranchId: string | null = null;
        try {
            const resolved = resolveActiveBranchId(req, await auth());
            defaultBranchId = resolved === COMBINED_BRANCH ? null : resolved;
        } catch { /* no branch at all — the form says so */ }
        if (!defaultBranchId || !branches.some((b) => b.id === defaultBranchId)) defaultBranchId = branches[0]?.id ?? null;

        return NextResponse.json({
            canPay,
            canReceive,
            moneyLedgers: moneyLedgers.map((a) => ({ id: a.id, name: a.name, group: a.group?.name ?? null })),
            expenseLedgers: expenseLedgers.map((a) => ({ id: a.id, name: a.name, group: a.group?.name ?? null })),
            branches,
            defaultBranchId,
        });
    } catch (e) {
        return handleApiError(e, "Could not load the payment form");
    }
}
