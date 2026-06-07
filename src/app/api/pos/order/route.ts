import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { createPosQuoteVoucher, type PosQuoteBody } from "@/modules/pos/lib/posQuoteVoucher";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";

type PayMethod = "CASH" | "MOBILE_PAYMENT" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "OTHER";
type PayLine = { method: PayMethod; amount: number; reference?: string };

const METHOD_LABEL: Record<PayMethod, string> = {
    CASH: "Cash", MOBILE_PAYMENT: "UPI", CARD: "Card", CHEQUE: "Cheque", BANK_TRANSFER: "Bank Transfer", OTHER: "Wallet",
};

/**
 * POST /api/pos/order — O2C POS Order mode.
 *
 * Always creates a POS_ORDER voucher (counter order — deliver-later / book-and-
 * collect; NO GL, NO stock) and captures a CRM Deal. Payment is OPTIONAL: if the
 * cashier collected an advance, a SECOND voucher — a RECEIPT (Dr counter till/bank,
 * Cr customer account = advance) — is posted via the same machinery as the POS
 * sale (counter method→ledger map + postReceiptVoucher). Zero payment → no receipt.
 *
 * The advance's shift + tender accounts are validated BEFORE the order voucher is
 * created, so a receipt failure never leaves an orphan order.
 */
export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const session = await auth();
    let branchId: string;
    try {
        branchId = resolveActiveBranchId(req, session);
    } catch (e) {
        if (e instanceof BranchAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.code === "forbidden_branch" ? 403 : 400 });
        }
        throw e;
    }

    try {
        const body = (await req.json()) as PosQuoteBody & { payments?: PayLine[] };

        const payments = (Array.isArray(body.payments) ? body.payments : []).filter((p) => p && p.amount > 0);
        const advance = payments.reduce((s, p) => s + Number(p.amount), 0);

        // ── Validate the advance BEFORE creating the order voucher ──────────────
        let shiftId: number | null = null;
        let shiftBranchId = branchId;
        const tenders: { accountId: number; amount: number; description?: string }[] = [];
        if (advance > 0.005) {
            if (!body.accountId) {
                return NextResponse.json({ error: "An advance needs an identified customer (not a walk-in)." }, { status: 400 });
            }
            const shift = await prisma.posShift.findFirst({
                where: { userId: user!.id, status: "OPEN" },
                select: {
                    id: true, branchId: true,
                    counter: {
                        select: {
                            name: true, tillAccountId: true, upiAccountId: true, cardAccountId: true,
                            walletAccountId: true, chequeAccountId: true, bankTransferAccountId: true,
                        },
                    },
                },
            });
            if (!shift) {
                return NextResponse.json({ error: "Open a shift to collect an advance (or save the order with no payment).", code: "NO_OPEN_SHIFT" }, { status: 400 });
            }
            const methodMap: Record<PayMethod, number | null> = {
                CASH: shift.counter.tillAccountId,
                MOBILE_PAYMENT: shift.counter.upiAccountId,
                CARD: shift.counter.cardAccountId,
                OTHER: shift.counter.walletAccountId,
                CHEQUE: shift.counter.chequeAccountId,
                BANK_TRANSFER: shift.counter.bankTransferAccountId,
            };
            for (const p of payments) {
                const accId = methodMap[p.method];
                if (!accId) {
                    return NextResponse.json({ error: `Counter "${shift.counter.name}" does not accept ${METHOD_LABEL[p.method]}. Map it under /office/admin/counters first.`, code: "PAYMENT_METHOD_NOT_MAPPED" }, { status: 400 });
                }
                tenders.push({ accountId: accId, amount: Number(p.amount), description: p.reference || `${METHOD_LABEL[p.method]} at ${shift.counter.name}` });
            }
            shiftId = shift.id;
            shiftBranchId = shift.branchId;
        }

        // ── Create the order voucher (always) ───────────────────────────────────
        const order = await createPosQuoteVoucher({ type: "POS_ORDER", branchId, userId: user!.id, body });

        // ── Post the advance Receipt voucher (only when collected) ──────────────
        let receiptVoucherId: number | null = null;
        let receiptVoucherRef: string | null = null;
        if (shiftId != null && tenders.length > 0) {
            const r = await prisma.$transaction(async (tx) => {
                const rv = await postReceiptVoucher(tx, {
                    customerAccountId: body.accountId!,
                    tenders,
                    date: new Date(),
                    userId: user!.id,
                    branchId: shiftBranchId,
                    narration: `Advance against ${order.reference}`,
                });
                await tx.posReceipt.create({
                    data: {
                        shiftId,
                        amountPaise: BigInt(Math.round(advance * 100)),
                        accountId: body.accountId!,
                        note: `Advance against ${order.reference}`,
                        voucherId: rv.voucherId,
                        createdById: user!.id,
                    },
                });
                return rv;
            }, { timeout: 30_000, maxWait: 10_000 });
            receiptVoucherId = r.voucherId;
            receiptVoucherRef = r.voucherRef;
        }

        return NextResponse.json({ ...order, receiptVoucherId, receiptVoucherRef }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to save order");
    }
}
