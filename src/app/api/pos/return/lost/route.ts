// POST /api/pos/return/lost
//
// Manager-only "lost invoice" return. Customer lost the original bill but
// is in the system — the manager picks products + qty + unit price free-form,
// types a reason, and we post the same GL + stock reversal as a normal return,
// but with no link back to an original voucher (`refVoucherId: null`).
//
// Walk-ins are blocked: customerAccountId is required.
//
// GL (via postInvVoucherToGl on the SALE_RETURN):
//   CASH refund  → Dr Sales Returns / (Dr GST Output reversal) / Cr Counter Till
//   CREDIT note  → Dr Sales Returns / (Dr GST Output reversal) / Cr Customer AR
//
// Stock: SALE_RETURN InvVoucher (refVoucherId=null) + InvStockLedger IN
// + branch + global stock + 1.
//
// Replaces the legacy Invoice + manual JE flow — see Layer 2c of the plan.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPartyJson } from "@/shared/lib/accountancy/partySnapshot";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import { saleToSpec } from "@/modules/accountancy/lib/voucherMappers";
import { buildSettlementJson } from "@/shared/lib/accountancy/settlement";
import { enginePost, engineCreateSpine } from "@/modules/accountancy/lib/transactionEngine";
import * as Sentry from "@sentry/nextjs";

const lostLineSchema = z.object({
    productId: z.number().int().positive(),
    qty:       z.number().positive(),
    unitPrice: z.number().min(0),
    taxRate:   z.number().min(0).max(100).default(0),
});

const lostSchema = z.object({
    customerAccountId: z.number().int().positive(),
    lines:             z.array(lostLineSchema).min(1),
    refundMode:        z.enum(["CASH", "CREDIT"]),
    reason:            z.string().trim().min(5, "Reason must be at least 5 characters").max(500),
});

class GlPostFailedError extends Error {
    constructor(message: string, public notes: string[]) { super(message); }
}

export async function POST(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_MANAGE);
    if (response) return response;

    const { data, error } = await validateRequest(req, lostSchema);
    if (error) return error;

    try {
        // ── Customer account ─────────────────────────────────────────────────
        const customerAcct = await prisma.account.findUnique({
            where:  { id: data.customerAccountId },
            select: { id: true, name: true, personId: true, companyId: true },
        });
        if (!customerAcct) return NextResponse.json({ error: "Customer account not found" }, { status: 404 });

        // ── Products (resolve existence + names) ─────────────────────────────
        const productIds = data.lines.map((l) => l.productId);
        const products = await prisma.invProduct.findMany({
            where:  { id: { in: productIds } },
            select: { id: true, name: true, sku: true },
        });
        const productById = new Map(products.map((p) => [p.id, p]));
        for (const l of data.lines) {
            if (!productById.has(l.productId)) {
                return NextResponse.json({ error: `Product #${l.productId} not found` }, { status: 400 });
            }
        }

        // ── Active shift (required for CASH refund + supplies branch context) ─
        const shift = await prisma.posShift.findFirst({
            where:  { userId: user!.id, status: "OPEN" },
            select: { id: true, branchId: true, counter: { select: { tillAccountId: true } } },
        });
        let tillAccountId: number | null = null;
        if (data.refundMode === "CASH") {
            if (!shift) {
                return NextResponse.json(
                    { error: "Open a shift before processing a cash refund.", code: "NO_OPEN_SHIFT" },
                    { status: 400 },
                );
            }
            tillAccountId = shift.counter.tillAccountId;
        }
        const branchId = shift?.branchId ?? null;
        if (!branchId) {
            return NextResponse.json({ error: "Manager must have an open shift (provides the branch context for stock return)." }, { status: 400 });
        }

        // ── Compute totals ───────────────────────────────────────────────────
        const subtotal = data.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
        const taxAmt   = data.lines.reduce((s, l) => s + (l.qty * l.unitPrice * l.taxRate) / 100, 0);
        const total    = subtotal + taxAmt;
        if (total <= 0) return NextResponse.json({ error: "Return total must be > 0" }, { status: 400 });

        // ── Branch state for GST split ─────────────────────────────────
        const branch = await prisma.branch.findUnique({
            where:  { id: branchId },
            select: { gstStateCode: true },
        });
        const sellerStateCode = (branch?.gstStateCode || "").trim() || null;

        // Refund tender row — single Cr leg on the SALE_RETURN JE.
        // CASH refund → till (money leaves the drawer).
        // CREDIT note → customer AR (sits as credit on their ledger).
        const refundAccountId = data.refundMode === "CASH" ? tillAccountId! : customerAcct.id;

        const partyType = customerAcct.personId !== null ? "customer"
                        : customerAcct.companyId !== null ? "company"
                        : "account";
        const partyId = customerAcct.personId ?? customerAcct.companyId ?? customerAcct.id;

        // ── Transaction ──────────────────────────────────────────────────────
        const result = await prisma.$transaction(async (tx) => {
            const today = new Date();

            const vRef = await invNextRef(tx, "SALE_RETURN");
            // Phase 5 5.0/5C: spine FIRST; enginePost attaches GL via existingSpineId.
            const voucherDescription = `Lost-invoice return — ${data.reason.slice(0, 200)}`;
            const spineId = await engineCreateSpine(tx, {
                type:           "SALE_RETURN",
                date:           today,
                description:    voucherDescription,
                voucherNo:    vRef,
                partyAccountId: customerAcct.id,
                userId:         user!.id,
            });
            const voucher = await tx.invVoucher.create({
                data: {
                    type:           "SALE_RETURN",
                    branchId,
                    universalVoucherId: spineId,
                    date:           today,
                    // 5D-5: description + postedAt + 5D-4 party live on the spine.
                    status:         "POSTED",
                    partyJson:      buildPartyJson({ name: customerAcct.name }) ?? Prisma.DbNull,
                    partyType,
                    partyId,
                    refNumber:      null,
                    refVoucherId:   null,
                    deliveryMode:   "COUNTER",
                    placeOfSupply:  sellerStateCode,
                    subtotal:       subtotal + taxAmt,
                    taxAmount:      taxAmt,
                    totalAmount:    total,
                    // 5D-2: creator lives on the spine.
                    // G4b: refund tender → settlementJson.
                    settlementJson: buildSettlementJson(
                        [{ accountId: refundAccountId, amount: total, method: data.refundMode === "CASH" ? "CASH" : null, reference: null }],
                        [],
                    ),
                },
            });
            // Phase 5 5C: goods lines hang off the spine.
            await tx.voucherInventoryLine.createMany({
                data: data.lines.map((l) => {
                    const p       = productById.get(l.productId)!;
                    const goods   = l.qty * l.unitPrice;
                    const lineTax = (goods * l.taxRate) / 100;
                    return {
                        universalVoucherId: spineId,
                        productId:   l.productId,
                        description: `${p.sku} — ${p.name}`,
                        quantity:    l.qty,
                        rate:        l.unitPrice,
                        taxRate:     l.taxRate,
                        taxAmount:   lineTax,
                        amount:      goods + lineTax,
                    };
                }),
            });

            const spec = await saleToSpec(tx, {
                id:          voucher.id,
                type:        voucher.type,
                reference:   vRef,
                date:        voucher.date,
                description: voucherDescription,
                partyJson:   voucher.partyJson,
                subtotal:    voucher.subtotal,
                taxAmount:   voucher.taxAmount,
                shippingAmt: voucher.shippingAmt,
                roundOff:    voucher.roundOff,
                totalAmount: voucher.totalAmount,
                tenders:     [{ accountId: refundAccountId, amount: total }],
                sellerStateCode,
                buyerStateCode: sellerStateCode,
            });   // GL only — stock IN handled below
            const gl = await enginePost(tx, spec, user!.id, { existingSpineId: spineId });
            if (gl.journalEntryId === null) {
                throw new GlPostFailedError(
                    `Cannot post lost-invoice return ${vRef}: engine produced no journal entry.`,
                    [],
                );
            }
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { universalVoucherId: gl.universalVoucherId },
            });

            // Stock IN.
            for (const l of data.lines) {
                await recordStockMovement(tx, {
                    universalVoucherId: spineId,
                    productId: l.productId,
                    branchId,
                    date:   today,
                    inQty:  l.qty,
                    outQty: 0,
                    rate:   l.unitPrice,
                    amount: l.qty * l.unitPrice,
                });
            }

            return {
                returnVoucherId: voucher.id,
                returnVoucherRef: vRef,
                journalEntryId:  gl.journalEntryId,
                returnTotal:     total,
                // Back-compat aliases for the dialog
                returnInvoiceId: voucher.id,
                returnNumber:    vRef,
            };
        }, {
            // Voucher + GL post + per-line stock-IN in one interactive
            // transaction; each line is ~3 sequential round-trips. A large
            // multi-line return would expire Prisma's 5s default — match the
            // POS sale / office post window. See /api/pos/sale.
            timeout: 30_000,
            maxWait: 10_000,
        });

        const touchedProductIds = data.lines.map((l) => l.productId);
        await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
            Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(result.returnVoucherId) } });
            console.error("[price-recompute] failed for voucher", result.returnVoucherId, err);
        });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        if (e instanceof GlPostFailedError) {
            return NextResponse.json({ error: e.message, notes: e.notes }, { status: 500 });
        }
        return handleApiError(e, "Failed to process lost-invoice return");
    }
}
