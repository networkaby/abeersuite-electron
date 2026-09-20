import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requireWritableBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { branchAccessResponse } from "@/shared/lib/api/branchAccessResponse";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { round2 } from "@/shared/lib/format/moneyInr";
import { payrollPaySchema } from "@/shared/lib/schemas/hrSchema";

// POST /api/hr/payroll/pay — pay several staff in one go.
//
// ONE Payment voucher, not one per person: a single withdrawal from the bank is
// a single entry in the bank book, and three hundred vouchers for one transfer
// batch would bury the day book. Each person still gets their own debit line,
// so every salary ledger settles individually and the Money tab stays right.
//
//     Dr  <Person A>            (their ledger, debt cleared)
//     Dr  <Person B>
//     …
//         Cr  Bank / Cash       (the money actually leaving)
//
// No salary expense is touched. That was taken when the run was POSTED; this
// only settles the liability it created. Paying more than is owed is allowed on
// purpose — it becomes an advance, which is exactly what a debit balance on
// their ledger means.
//
// Gated on the PAYMENT voucher permissions rather than hr:payroll:run: this is
// money leaving the business, so the authority that matters is the one to write
// and post a payment.

export async function POST(req: NextRequest) {
    const createGate = await requireVoucherPermission("PAYMENT", "create");
    if (createGate.response) return createGate.response;
    const postGate = await requireVoucherPermission("PAYMENT", "post");
    if (postGate.response) return postGate.response;
    const caller = postGate.user!;

    const { data: body, error } = await validateRequest(req, payrollPaySchema);
    if (error) return error;

    const session = await auth();
    let branchId: string;
    try { branchId = requireWritableBranchId(req, session); }
    catch (e) {
        if (e instanceof BranchAccessError) return branchAccessResponse(e);
        throw e;
    }

    try {
        // The source has to be real money — paying salary out of an income
        // ledger would balance and still be nonsense.
        const source = await prisma.account.findUnique({
            where:  { id: body.sourceAccountId },
            select: { id: true, name: true, group: { select: { name: true, type: true } } },
        });
        if (!source) return NextResponse.json({ error: "Pick the cash or bank account the money leaves" }, { status: 400 });
        if (source.group?.type !== "ASSET") {
            return NextResponse.json(
                { error: `${source.name} is not a cash or bank account` },
                { status: 422 },
            );
        }

        // Resolve each person's own ledger. Sent as user ids, never as account
        // ids, so a crafted request cannot debit some other ledger.
        const userIds = body.lines.map((l) => l.userId);
        const profiles = await prisma.staffProfile.findMany({
            where:  { userId: { in: userIds }, ledgerAccountId: { not: null } },
            select: { userId: true, ledgerAccountId: true, user: { select: { name: true } } },
        });
        const byUser = new Map(profiles.map((p) => [p.userId, p]));

        const missing = userIds.filter((id) => !byUser.has(id));
        if (missing.length) {
            return NextResponse.json(
                { error: `${missing.length} of them have no salary ledger yet — open their profile and save it once` },
                { status: 422 },
            );
        }

        const debits = body.lines.map((l) => ({
            accountId:   byUser.get(l.userId)!.ledgerAccountId!,
            type:        "DEBIT" as const,
            amount:      round2(l.amountPaise / 100),
            description: `Salary paid — ${byUser.get(l.userId)!.user.name}`,
        }));
        const total = round2(debits.reduce((s, d) => s + d.amount, 0));
        if (total <= 0) return NextResponse.json({ error: "Nothing to pay" }, { status: 422 });

        const glLines = [
            ...debits,
            { accountId: source.id, type: "CREDIT" as const, amount: total, description: body.note ?? "Salary paid" },
        ];
        if (!isBalanced(glLines)) {
            return NextResponse.json({ error: "The payment does not balance — please report this" }, { status: 500 });
        }

        const result = await prisma.$transaction(async (tx) => {
            const voucher = await engineCreateVoucher(tx, {
                type:      "PAYMENT",
                date:      new Date(`${body.date}T00:00:00.000Z`),
                userId:    caller.id,
                lines:     glLines,
                narration: body.note ?? `Salary paid to ${debits.length} staff`,
                post:      true,
                branchId,
            });
            return { voucherId: voucher.id, voucherRef: voucher.reference };
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, headcount: debits.length, total, ...result }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to pay the salary");
    }
}
