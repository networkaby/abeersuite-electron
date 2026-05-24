import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { postInvVoucherToGl } from "@/modules/accountancy/lib/postInvVoucher";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { checkCreditLimit, CreditLimitError } from "@/shared/lib/accountancy/checkCreditLimit";
// Note: branch context comes from the cashier's active shift, NOT from the
// session cookie. This allows multiple browsers / users to bill in parallel
// from different counters without their active-branch cookie interfering.

// POST /api/pos/sale
//
// Atomic POS sale — single InvVoucher (type=POS) carrying items, multi-
// tender settlement rows (Cash / UPI / Card / etc.), stock movement, and
// GST routing. One balanced JE per voucher; no separate Receipt voucher
// or VoucherAllocation. Same shape as office SALE post-Layer 7.
//
// Posting flow (one $transaction):
//   1. Resolve customer Account, branch state, validate tender total.
//   2. Create InvVoucher + lines + tender rows in a single nested write.
//   3. postInvVoucherToGl → one JE: Dr per tender (Till / Bank / AR) /
//      Cr Sales / Cr CGST+SGST or IGST. Wire JE id back onto voucher.
//   4. InvStockLedger + per-branch + org-wide stock decrement per line.
//
// Replaces the prior three-step write (Invoice + InvoiceLine + Payment),
// later the receipt-voucher detour, with the unified tender shape.
//
// As of 2026-05-14 the route requires the cashier to have an OPEN PosShift
// in the active branch. The CASH portion of any payment auto-debits the
// shift's tillAccountId; non-CASH portions debit the user-picked bank account.
// See docs/modules/pos.md.

const lineSchema = z.object({
    productId:   z.number().int().positive(),
    description: z.string().trim().min(1),
    quantity:    z.number().positive(),
    unitPrice:   z.number().min(0),
    taxRate:     z.number().min(0).max(100).default(0),
});

const paymentSchema = z.object({
    method:    z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "MOBILE_PAYMENT", "OTHER"]),
    amount:    z.number().positive(),
    accountId: z.number().int().positive().optional(),   // required for non-CASH; CASH auto-routes to till
    reference: z.string().trim().max(120).optional(),
});

const createSchema = z.object({
    accountId: z.number().int().positive(),                                       // customer AR account
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes:     z.string().trim().optional(),
    lines:     z.array(lineSchema).min(1, "At least one line item required"),
    payments:  z.array(paymentSchema).min(1, "At least one payment line required"),
});

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);
    if (error) return error;
    const body = data;

    // ── Active shift requirement ──────────────────────────────────────────
    // Branch context comes from the shift, not the session cookie.
    // This lets multiple users bill in parallel from different browsers
    // without their active-branch cookie interfering.
    const shift = await prisma.posShift.findFirst({
        where:  { userId: user!.id, status: "OPEN" },
        select: {
            id: true, branchId: true,
            counter: {
                select: {
                    name: true,
                    tillAccountId:         true,
                    upiAccountId:          true,
                    cardAccountId:         true,
                    walletAccountId:       true,
                    chequeAccountId:       true,
                    bankTransferAccountId: true,
                },
            },
        },
    });
    if (!shift) {
        return NextResponse.json(
            { error: "Open a shift before billing.", code: "NO_OPEN_SHIFT" },
            { status: 400 },
        );
    }
    const tillAccountId  = shift.counter.tillAccountId;
    const activeBranchId = shift.branchId;
    // Per-method ledger map: server is the source of truth for which Account
    // each non-CASH method settles into. Null = method not accepted at this
    // counter. Operator configures these under /office/admin/counters.
    const counterMethodMap: Record<typeof body.payments[number]["method"], number | null> = {
        CASH:           tillAccountId,   // always — auto-routed
        MOBILE_PAYMENT: shift.counter.upiAccountId,
        CARD:           shift.counter.cardAccountId,
        OTHER:          shift.counter.walletAccountId,    // "Wallet" surface label
        CHEQUE:         shift.counter.chequeAccountId,
        BANK_TRANSFER:  shift.counter.bankTransferAccountId,
    };
    const counterName = shift.counter.name;

    // ── Resolve customer account (party ledger) ───────────────────────────
    // The new schema stores `accountId` directly on InvVoucher. We also
    // capture the display name + identity ids for the partyName/partyType/
    // partyId triple so postInvVoucherToGl can build the JE description and
    // any legacy reader (until Layer 5) still sees the old fields populated.
    const customerAccount = await prisma.account.findUnique({
        where:  { id: body.accountId },
        select: {
            id: true, name: true, personId: true, companyId: true,
            person:  { select: { name: true } },
            company: { select: { name: true } },
        },
    });
    if (!customerAccount) {
        return NextResponse.json({ error: "Customer account not found." }, { status: 422 });
    }
    const partyName = customerAccount.person?.name
                   ?? customerAccount.company?.name
                   ?? customerAccount.name;
    const partyType = customerAccount.personId !== null ? "customer"
                     : customerAccount.companyId !== null ? "company"
                     : "account";
    const partyId   = customerAccount.personId
                   ?? customerAccount.companyId
                   ?? customerAccount.id;

    // ── Validate line items + payment totals ──────────────────────────────
    const computedLines = body.lines.map((l) => {
        const lineSubtotal = l.quantity * l.unitPrice;
        const lineTax = (lineSubtotal * l.taxRate) / 100;
        return {
            productId:   l.productId,
            description: l.description,
            quantity:    l.quantity,
            unitPrice:   l.unitPrice,
            taxRate:     l.taxRate,
            taxAmount:   lineTax,
            amount:      lineSubtotal + lineTax,
        };
    });
    const subtotal    = computedLines.reduce((s, l) => s + l.amount, 0);   // tax-inclusive (matches postInvVoucherToGl contract)
    const taxAmount   = computedLines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = subtotal; // no shipping / round-off on POS today

    const paymentTotal = body.payments.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(paymentTotal - totalAmount) > 0.01) {
        return NextResponse.json(
            { error: `Payment total (₹${paymentTotal.toFixed(2)}) does not match invoice total (₹${totalAmount.toFixed(2)}).` },
            { status: 422 },
        );
    }

    // Resolve each payment line's settlement ledger via the counter's mapping.
    // The client-supplied `accountId` (if any) is ignored — the counter owns
    // routing so the same UPI transaction always lands on the same ledger no
    // matter which cashier is at the counter. Unmapped methods are rejected
    // here (the PosScreen also hides them, so this is a guardrail).
    const METHOD_LABEL: Record<typeof body.payments[number]["method"], string> = {
        CASH: "Cash", MOBILE_PAYMENT: "UPI", CARD: "Card", CHEQUE: "Cheque", BANK_TRANSFER: "Bank Transfer", OTHER: "Wallet",
    };
    const resolvedPayments: { method: typeof body.payments[number]["method"]; accountId: number; amount: number; reference?: string }[] = [];
    for (const p of body.payments) {
        const mappedAccountId = counterMethodMap[p.method];
        if (mappedAccountId == null) {
            return NextResponse.json(
                { error: `Counter "${counterName}" does not accept ${METHOD_LABEL[p.method]}. Map it under /office/admin/counters first.`, code: "PAYMENT_METHOD_NOT_MAPPED" },
                { status: 422 },
            );
        }
        resolvedPayments.push({ method: p.method, accountId: mappedAccountId, amount: p.amount, reference: p.reference });
    }

    // Amount that will increase the customer's AR balance (onCredit portion).
    // Currently the route enforces paymentTotal === totalAmount so this is
    // always 0 — the check is a forward-compatibility guard for partial payments.
    const onCredit = Math.max(0, totalAmount - paymentTotal);

    // POS is always counter-pickup → place of supply = branch state regardless
    // of customer's address (CGST Act §10(1)(c)). Resolve once, outside tx.
    const posBranch = await prisma.branch.findUnique({
        where: { id: activeBranchId },
        select: { gstStateCode: true },
    });
    const sellerStateCode = (posBranch?.gstStateCode || "").trim() || null;

    try {
        const result = await prisma.$transaction(async (tx) => {
            // ── Credit limit check (inside tx so balance read is fresh) ────
            await checkCreditLimit(tx, body.accountId, onCredit);

            // ── 1. InvVoucher (type=POS) + lines + tender rows ───────────
            // Single voucher carries the entire sale: items, tender rows
            // (Cash / UPI / Card — one per resolved payment, plus an AR
            // tender for any unsettled balance). postInvVoucherToGl posts
            // a single balanced JE per voucher; no separate Receipt
            // voucher / VoucherAllocation needed.
            const voucherRef = await invNextRef(tx, "POS");
            // POS today enforces paymentTotal == totalAmount, so onCredit
            // is always 0 and no AR tender is needed. Kept as a future-
            // facing branch in case partial POS sales get enabled.
            const arRemainder = totalAmount - paymentTotal;
            const tenderPayload = [
                ...resolvedPayments.map((p) => ({
                    accountId: p.accountId,
                    amount:    p.amount,
                    method:    p.method,
                    reference: p.reference ?? null,
                })),
                ...(arRemainder > 0.005
                    ? [{ accountId: customerAccount.id, amount: arRemainder, method: null as null, reference: null as null }]
                    : []),
            ];
            const voucher = await tx.invVoucher.create({
                data: {
                    type:           "POS",
                    reference:      voucherRef,
                    branchId:       activeBranchId,
                    date:           new Date(body.issueDate),
                    description:    body.notes?.trim() || `POS sale — ${partyName}`,
                    status:         "POSTED",
                    postedAt:       new Date(),
                    accountId:      customerAccount.id,
                    partyName,
                    partyType,
                    partyId,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    subtotal,
                    taxAmount,
                    totalAmount,
                    createdById:    user!.id,
                    lines: {
                        create: computedLines.map((l) => ({
                            productId:   l.productId,
                            description: l.description,
                            quantity:    l.quantity,
                            rate:        l.unitPrice,
                            taxRate:     l.taxRate,
                            taxAmount:   l.taxAmount,
                            amount:      l.amount,
                        })),
                    },
                    tenders: {
                        create: tenderPayload.map((t) => ({
                            accountId: t.accountId,
                            amount:    t.amount,
                            method:    t.method,
                            reference: t.reference,
                        })),
                    },
                },
                include: { lines: true, tenders: { include: { account: { select: { id: true, name: true, normalBalance: true, group: { select: { type: true } } } } } } },
            });

            // ── 2. GL post (Dr Till/Bank + (optional) Dr Customer AR / Cr Sales / Cr GST) ─
            // postInvVoucherToGl reads the tender rows directly — one Dr
            // leg per tender. No back-compat single-paymentAccount path.
            const gl = await postInvVoucherToGl(tx, {
                voucherId: voucher.id,
                voucher: {
                    id:          voucher.id,
                    type:        voucher.type,
                    reference:   voucher.reference,
                    date:        voucher.date,
                    description: voucher.description,
                    partyName:   voucher.partyName,
                    partyType:   voucher.partyType,
                    partyId:     voucher.partyId,
                    subtotal:    voucher.subtotal,
                    taxAmount:   voucher.taxAmount,
                    shippingAmt: voucher.shippingAmt,
                    roundOff:    voucher.roundOff,
                    totalAmount: voucher.totalAmount,
                    tenders:     voucher.tenders.map((t) => ({
                        accountId: t.accountId,
                        amount:    Number(t.amount),
                        account:   t.account,
                    })),
                    sellerStateCode,
                    buyerStateCode: sellerStateCode, // counter pickup → intra-state
                },
                userId: user!.id,
            });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post POS sale ${voucherRef}: GL bridge could not build a journal entry.`,
                    gl.notes,
                );
            }
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { journalEntryId: gl.journalEntryId },
            });

            // ── 4. Stock ledger + per-branch + org-wide stock decrement ───
            const date = new Date(body.issueDate);
            for (const line of voucher.lines) {
                const qty = Number(line.quantity);
                if (qty <= 0) continue;
                await tx.invStockLedger.create({
                    data: {
                        productId: line.productId,
                        voucherId: voucher.id,
                        branchId:  activeBranchId,
                        date,
                        inQty:  0,
                        outQty: qty,
                        rate:   line.rate,
                        amount: line.amount,
                    },
                });
                await tx.invProductBranch.upsert({
                    where:  { productId_branchId: { productId: line.productId, branchId: activeBranchId } },
                    create: { productId: line.productId, branchId: activeBranchId, stock: -Math.round(qty) },
                    update: { stock: { decrement: Math.round(qty) } },
                });
                await tx.invProduct.update({
                    where: { id: line.productId },
                    data:  { stock: { decrement: Math.round(qty) } },
                });
            }

            return {
                voucherId:      voucher.id,
                voucherRef:     voucher.reference,
                journalEntryId: gl.journalEntryId,
                shiftId:        shift.id,
                // Back-compat aliases — PosScreen still reads these names.
                invoiceId:      voucher.id,
                invoiceNumber:  voucher.reference,
            };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (err) {
        if (err instanceof CreditLimitError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
        }
        if (err instanceof GlPostFailedError) {
            return NextResponse.json({ error: err.message, notes: err.notes }, { status: 500 });
        }
        console.error("[pos sale]", err);
        const msg = err instanceof Error ? err.message : "Failed to create POS sale";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
