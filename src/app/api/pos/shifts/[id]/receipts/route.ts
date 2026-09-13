// POST /api/pos/shifts/[id]/receipts
//
// Collect a cash payment from a party (customer) at the counter — e.g. a
// customer clears their outstanding credit, or pays an advance. Posts a RECEIPT
// voucher (Dr counter till / Cr party AR) via postReceiptVoucher. The till debit
// moves the till's book balance, which is what the shift close reads — no
// separate bookkeeping needed here. The PosReceipt row is the audit link that
// feeds the "Payments collected this shift" tally.
//
// Funding destination is always the shift's counter till (cash into the drawer),
// mirroring the per-counter routing at /office/admin/counters.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { requestBusinessDate } from "@/shared/lib/api/requestBusinessDate";
import { touchPosShift } from "@/modules/pos/lib/touchShift";

const receiptSchema = z.object({
    accountId: z.number().int().positive(),   // party AR ledger to credit
    // One debit leg per tender. paymentAccountId null = CASH (the counter till);
    // else one of the counter's payment accounts (UPI/Card/…) → its ledger.
    tenders: z.array(z.object({
        paymentAccountId: z.number().int().positive().nullable(),
        amountPaise:      z.number().int().positive(),
    })).min(1, "At least one tender is required"),
    note: z.string().trim().max(200).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_DROP);
    if (response) return response;

    const { id: idStr } = await params;
    const shiftId = Number(idStr);
    if (!Number.isFinite(shiftId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const { data, error } = await validateRequest(req, receiptSchema);
    if (error) return error;

    try {
        const shift = await prisma.posShift.findUnique({
            where:  { id: shiftId },
            select: {
                id: true, userId: true, status: true, branchId: true,
                counter: {
                    select: {
                        tillAccountId: true, name: true,
                        paymentAccounts: { where: { isActive: true }, select: { id: true, accountId: true, label: true } },
                    },
                },
            },
        });
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
        if (shift.status !== "OPEN") {
            return NextResponse.json({ error: "Cannot record a receipt on a closed shift" }, { status: 409 });
        }
        const canManage = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (shift.userId !== user!.id && !canManage) {
            return NextResponse.json({ error: "Not your shift" }, { status: 403 });
        }

        const party = await prisma.account.findUnique({
            where:  { id: data.accountId },
            select: { id: true, name: true },
        });
        if (!party) return NextResponse.json({ error: "Party account not found" }, { status: 404 });

        // Resolve each tender → its debit ledger: CASH = the counter till; else the
        // chosen counter payment account (e.g. a UPI receipt debits the UPI bank).
        const payAcctById = new Map(shift.counter.paymentAccounts.map((a) => [a.id, a]));
        const tenders: { accountId: number; amount: number; description: string }[] = [];
        for (const t of data.tenders) {
            if (t.paymentAccountId == null) {
                tenders.push({ accountId: shift.counter.tillAccountId, amount: t.amountPaise / 100, description: `Cash at ${shift.counter.name}` });
                continue;
            }
            const acct = payAcctById.get(t.paymentAccountId);
            if (!acct) return NextResponse.json({ error: "That payment account isn't on this counter.", code: "PAYMENT_METHOD_NOT_MAPPED" }, { status: 422 });
            tenders.push({ accountId: acct.accountId, amount: t.amountPaise / 100, description: `${acct.label} at ${shift.counter.name}` });
        }
        const totalPaise = data.tenders.reduce((s, t) => s + t.amountPaise, 0);

        const result = await prisma.$transaction(async (tx) => {
            const r = await postReceiptVoucher(tx, {
                customerAccountId: party.id,
                tenders,
                date:      requestBusinessDate(req),
                userId:    user!.id,
                branchId:  shift.branchId,
                narration: data.note ? `POS receipt — ${data.note}` : `POS receipt from ${party.name}`,
            });
            // Audit link: tie this receipt to the shift (which receipts on which shift).
            await tx.posReceipt.create({
                data: {
                    shiftId,
                    amountPaise: BigInt(totalPaise),
                    accountId:   party.id,
                    note:        data.note ?? null,
                    voucherId:   r.voucherId,
                    createdById: user!.id,
                },
            });
            await touchPosShift(tx, shiftId);
            return r;
        });

        return NextResponse.json(
            { voucherId: result.voucherId, voucherRef: result.voucherRef, amountPaise: String(totalPaise) },
            { status: 201 },
        );
    } catch (e) {
        return handleApiError(e, "Failed to record receipt");
    }
}
