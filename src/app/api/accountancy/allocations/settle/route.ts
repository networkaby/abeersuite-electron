import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucherKind } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { postSettlementVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { assertLinkable, createLink, loadDocOpen, BillLinkError } from "@/modules/accountancy/lib/billLink";
import { isMoneyGroupName } from "@/modules/accountancy/lib/moneyAccount";

// POST /api/accountancy/allocations/settle
//
// "There is nothing to link this bill against — so make one."
//
// Creates the settling voucher AND links it to the bill, in ONE transaction: the
// voucher and its link land together or neither does, so a settlement voucher can
// never be left floating unlinked because the second step failed.
//
// The KIND is not asked for — it is derived from which side of the party's book
// the bill sits on, because there is only ever one right answer:
//
//   receivable bill (a sale, a debit note) → RECEIPT, money coming in
//   payable bill    (a purchase, a credit note) → PAYMENT, money going out
//
// The full `assertLinkable` check runs here (unlike the POS path, which trusts its
// own FIFO planner for speed) because a human chose this bill and this amount.
const schema = z.object({
    /** The party ledger the bill stands against. */
    accountId:      z.number().int().positive(),
    /** The bill being settled — a spine id. */
    billVoucherId:  z.number().int().positive(),
    /** How much of it to settle now. */
    amount:         z.number().positive(),
    /** Which till / bank account the money moves through. */
    moneyAccountId: z.number().int().positive(),
    date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    narration:      z.string().trim().max(300).optional(),
});

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    try {
        const bill = await loadDocOpen(prisma, data.accountId, data.billVoucherId);
        if (!bill) {
            return NextResponse.json(
                { error: "That voucher has nothing open against this party." },
                { status: 422 },
            );
        }

        const kind = bill.side === 1 ? "RECEIPT" as const : "PAYMENT" as const;

        // Making a settlement voucher is creating and posting one, so it needs
        // both rungs on that kind — plus the same `cancel` rung on the bill that
        // linking to it would need on its own.
        const billVoucher = await prisma.universalVoucher.findUnique({
            where:  { id: data.billVoucherId },
            select: { type: true },
        });
        if (!billVoucher) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

        // Only a DOCUMENT can be settled by creating money. A receipt, a payment
        // or a contra IS money that already moved, so making another one to
        // "settle" it would move the same amount twice — what such a voucher
        // needs is to be LINKED to a bill, which is the rest of this popup.
        if (["RECEIPT", "PAYMENT", "CONTRA"].includes(billVoucher.type)) {
            return NextResponse.json(
                { error: `A ${billVoucher.type.toLowerCase()} is money that already moved — link it to a bill instead of creating another voucher.` },
                { status: 422 },
            );
        }

        const allowed = userCanVoucherKind(user, kind, "create")
            && userCanVoucherKind(user, kind, "post")
            && userCanVoucherKind(user, billVoucher.type, "cancel");
        if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        // The money has to move through a real till or bank ledger — not the party
        // itself (which would post both legs to one account and settle nothing).
        const money = await prisma.account.findUnique({
            where:  { id: data.moneyAccountId },
            select: { id: true, isActive: true, group: { select: { name: true } } },
        });
        if (!money || !money.isActive) {
            return NextResponse.json({ error: "Pick an active cash or bank account." }, { status: 422 });
        }
        if (money.id === data.accountId) {
            return NextResponse.json({ error: "The money account cannot be the party itself." }, { status: 422 });
        }
        if (!isMoneyGroupName(money.group?.name)) {
            return NextResponse.json(
                { error: `${money.group?.name ?? "That ledger"} is not a cash or bank account.` },
                { status: 422 },
            );
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create + post the settlement voucher. No allocation args here —
            //    that path skips the full check by design, and this one wants it.
            const posted = await postSettlementVoucher(tx, {
                kind,
                partyAccountId: data.accountId,
                tenders:        [{ accountId: data.moneyAccountId, amount: data.amount }],
                date:           new Date(`${data.date}T00:00:00.000Z`),
                userId:         user!.id,
                narration:      data.narration,
            });

            // 2. Link it to the bill under every guard. A refusal rolls the
            //    voucher back with it, so nothing is left half-done.
            const orient = await assertLinkable(tx, {
                accountId: data.accountId,
                aId:       posted.voucherId,
                bId:       data.billVoucherId,
                amount:    data.amount,
            });
            const linkId = await createLink(tx, {
                ...orient,
                amount:    data.amount,
                reference: posted.voucherRef,
                userId:    user!.id,
            });
            return { voucherId: posted.voucherId, voucherRef: posted.voucherRef, linkId };
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, kind, ...result }, { status: 201 });
    } catch (e) {
        if (e instanceof BillLinkError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to create the settlement voucher");
    }
}
