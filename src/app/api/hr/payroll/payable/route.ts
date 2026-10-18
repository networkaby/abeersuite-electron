import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { moneyNumber } from "@/shared/lib/format/moneyInr";
import { businessTodayIso, toDateOnlyUtc } from "@/shared/lib/format/formatDate";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import type { PayableStaffDto } from "@/modules/hr/lib/payrollTypes";

// GET /api/hr/payroll/payable — who is owed money right now.
//
// Read straight off each staff ledger's balance, NOT off the payroll runs. That
// is the whole point: the ledger already nets an advance against the accrual,
// so someone who took ₹5,000 in hand on the 10th shows ₹11,000 owed, not
// ₹16,000. Working from the run instead would pay them twice.
//
// The ledgers are CREDIT-normal, so a positive balance is owed TO them and a
// negative one is an advance they still hold. Only the positive ones are
// payable; the rest are listed with their balance so the screen can say why
// they are not being paid.
//
// `Account.balance` holds only posted vouchers — the opening balance is a
// master field kept apart from it, so it is added back here. Without it, staff
// whose salary was owed when the books started read as holding an advance.
//
// A person who has left still appears while their balance is outstanding —
// leaving does not cancel what is owed for the days already worked.

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const today = businessTodayIso();
        const profiles = await prisma.staffProfile.findMany({
            where:  { ledgerAccountId: { not: null } },
            select: {
                userId: true,
                staffCode: true,
                leftOn: true,
                user: { select: { name: true } },
                ledgerAccount: { select: { id: true, name: true, balance: true, openingBalance: true, openingBalanceType: true } },
            },
        });

        const rows: PayableStaffDto[] = profiles
            .filter((p) => p.ledgerAccount)
            .map((p) => {
                const acc = p.ledgerAccount!;
                const opening = moneyNumber(acc.openingBalance ?? 0);
                const balance = moneyNumber(acc.balance) + (acc.openingBalanceType === "DEBIT" ? -opening : opening);
                return {
                    userId: p.userId,
                    name: p.user.name,
                    staffCode: p.staffCode,
                    hasLeft: staffHasLeft({ leftOn: p.leftOn }, today),
                    ledger: { id: acc.id, name: acc.name },
                    // Positive = owed to them. Negative = an advance they hold.
                    balance,
                    leftOn: p.leftOn ? toDateOnlyUtc(p.leftOn) : null,
                };
            })
            // Biggest owed first, so the people waiting on the most money are
            // at the top of the list rather than wherever the alphabet put them.
            .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to read who is owed");
    }
}
