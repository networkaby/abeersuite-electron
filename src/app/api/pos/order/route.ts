import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { createPosQuoteVoucher, type PosQuoteBody } from "@/modules/pos/lib/posQuoteVoucher";
import { postReceiptVoucher } from "@/modules/accountancy/lib/postReceiptVoucher";
import { holdRedemptions, type RedemptionIntent } from "@/modules/order/lib/redemptionHold";

// An advance payment line — null paymentAccountId = CASH (the till); else one of
// the counter's payment accounts (resolved to its ledger below).
type PayLine = { paymentAccountId: number | null; amount: number; reference?: string };

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
        const body = (await req.json()) as PosQuoteBody & { payments?: PayLine[]; redemptions?: RedemptionIntent[] };

        // O2C: every order needs an identified customer — there is NO anonymous/
        // walk-in order (anonymous = instant counter Sale only). The Order screen
        // already blocks save without a customer; this is the API backstop.
        if (!body.accountId) {
            return NextResponse.json({ error: "An order needs a customer. Pick or create one first.", code: "CUSTOMER_REQUIRED" }, { status: 400 });
        }

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
                            name: true, tillAccountId: true,
                            paymentAccounts: {
                                where:  { isActive: true },
                                select: { id: true, accountId: true, label: true },
                            },
                        },
                    },
                },
            });
            if (!shift) {
                return NextResponse.json({ error: "Open a shift to collect an advance (or save the order with no payment).", code: "NO_OPEN_SHIFT" }, { status: 400 });
            }
            const payAcctById = new Map(shift.counter.paymentAccounts.map((a) => [a.id, a]));
            for (const p of payments) {
                if (p.paymentAccountId == null) {
                    tenders.push({ accountId: shift.counter.tillAccountId, amount: Number(p.amount), description: p.reference || `Cash at ${shift.counter.name}` });
                    continue;
                }
                const acct = payAcctById.get(p.paymentAccountId);
                if (!acct) {
                    return NextResponse.json({ error: `Counter "${shift.counter.name}" doesn't have that payment account. Reconfigure under /office/admin/counters.`, code: "PAYMENT_METHOD_NOT_MAPPED" }, { status: 400 });
                }
                tenders.push({ accountId: acct.accountId, amount: Number(p.amount), description: p.reference || `${acct.label} at ${shift.counter.name}` });
            }
            shiftId = shift.id;
            shiftBranchId = shift.branchId;
        }

        // ── Create the order voucher (always) ───────────────────────────────────
        const order = await createPosQuoteVoucher({ type: "POS_ORDER", branchId, userId: user!.id, body });

        // ── Hold any reward redemptions applied to the order (2b) ────────────────
        // GL-silent: loyalty / coupon / gift-card value is recorded as HELD against the
        // order, burned on the Sale at Fulfil, released on cancel. No capture UI sends
        // these yet — this is the API backstop, ready for it.
        const redemptions = Array.isArray(body.redemptions) ? body.redemptions : [];
        if (redemptions.length > 0) {
            await holdRedemptions({ source: "inv", id: order.voucherId }, redemptions);
        }

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
