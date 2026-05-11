import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { postInvVoucherToGl } from "@/modules/accountancy/lib/postInvVoucher";
import { handleApiError } from "@/shared/lib/api";

// POST /api/inventory/vouchers/[id]/post
//   1. Write InvStockLedger entries + update cached InvProduct.stock
//   2. Auto-create GL JournalEntry via postInvVoucherToGl (SALE / PURCHASE only)
//   3. Mark voucher as POSTED
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const userId = user!.id;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: {
                include: {
                    product: { select: { id: true, costPaise: true, stock: true } },
                },
            },
            // Resolved cash/bank Account picked at save time — postInvVoucher
            // uses this in preference to the legacy name-based lookup so the
            // GL JE lands on the ledger the cashier actually chose.
            paymentAccount: {
                select: {
                    id: true,
                    name: true,
                    normalBalance: true,
                    group: { select: { type: true } },
                },
            },
        },
    });

    if (!voucher)                  return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: `Voucher is already ${voucher.status}` }, { status: 409 });

    // Stock-direction classification per voucher type:
    //   incoming stock: PURCHASE, RECEIPT, GRN, REJECTION_IN
    //   outgoing stock: SALE, ISSUE, CHALLAN, REJECTION_OUT
    //   no stock:      ESTIMATE, ADJUSTMENT, STOCK_JOURNAL, PHYSICAL_STOCK, SALES_ORDER, PURCHASE_ORDER
    //                  (Stock Journal and Physical Stock have explicit per-line in/out quantities;
    //                   handled separately below)
    //   commitments:   SALES_ORDER, PURCHASE_ORDER — no stock movement at all on POST.
    const isPurchase = ["PURCHASE", "RECEIPT", "GRN", "REJECTION_IN"].includes(voucher.type);
    const isSale     = ["SALE", "ISSUE", "CHALLAN", "REJECTION_OUT"].includes(voucher.type);
    const isCommitment = voucher.type === "SALES_ORDER" || voucher.type === "PURCHASE_ORDER";
    const isPhysicalStock = voucher.type === "PHYSICAL_STOCK";
    const isStockJournal = voucher.type === "STOCK_JOURNAL";

    try {
        const { result, notes } = await prisma.$transaction(async (tx) => {
            // ── 1. Stock ledger + cached InvProduct.stock ─────────────────
            // Commitments (SO / PO) skip stock entirely. Physical Stock writes the
            // delta needed to reach the recorded count. Stock Journal currently
            // treats positive amount as IN and negative as OUT; richer per-line
            // direction can be added when the form supports it.
            if (!isCommitment) {
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
                    // Free / complimentary qty moves out of stock the same way
                    // as the billed qty — it just doesn't show up in revenue.
                    const freeQty = line.freeQty != null ? toNumber(line.freeQty) : 0;
                    const totalQty = qty + freeQty;
                    let inQty = 0, outQty = 0;
                    if (isPurchase)         inQty = totalQty;
                    else if (isSale)        outQty = totalQty;
                    else if (isPhysicalStock) {
                        // Quantity here is interpreted as the new on-hand value.
                        // The delta (qty - product.stock) is what we ledger.
                        const current = line.product.stock ?? 0;
                        const delta = qty - current;
                        if (delta >= 0) inQty = delta;
                        else            outQty = -delta;
                    }
                    else if (isStockJournal) {
                        // Sign of line.amount drives direction (positive = IN, negative = OUT).
                        if (toNumber(line.amount) >= 0) inQty = qty;
                        else                            outQty = qty;
                    }

                    if (inQty > 0 || outQty > 0) {
                        await tx.invStockLedger.create({
                            data: {
                                productId: line.productId,
                                voucherId: voucher.id,
                                date:      voucher.date,
                                inQty,
                                outQty,
                                rate:      line.rate,
                                amount:    line.amount,
                            },
                        });
                        // Postgres `NULL + n = NULL` — Prisma's increment/
                        // decrement silently no-ops on a null cache. If stock
                        // is null, set the absolute value; otherwise apply the
                        // delta. Keeps the closing-stock valuation accurate.
                        const startsAtNull = line.product.stock === null;
                        const delta = inQty > 0 ? Math.round(inQty) : -Math.round(outQty);
                        await tx.invProduct.update({
                            where: { id: line.productId },
                            data:  {
                                stock: startsAtNull
                                    ? delta
                                    : delta > 0
                                        ? { increment: delta }
                                        : { decrement: -delta },
                                ...(isPurchase ? { costPaise: Math.round(toNumber(line.rate) * 100) } : {}),
                            },
                        });
                    }
                }
            }

            // ── 2. Auto-post to GL (only the two accounting voucher types) ────
            // Other types (GRN, Challan, Rejections, Stock Journal, Physical
            // Stock, Sales Order, Purchase Order) intentionally don't touch GL
            // on POST — they get linked to a separate Sales/Purchase invoice
            // (or stay non-accounting per Tally convention).
            let journalEntryId: number | null = null;
            const postNotes: string[] = [];
            if (voucher.type === "SALE" || voucher.type === "PURCHASE") {
                const out = await postInvVoucherToGl(tx, {
                    voucherId: voucher.id,
                    voucher,
                    userId,
                });
                journalEntryId = out.journalEntryId;
                postNotes.push(...out.notes);
            }

            // ── 3. Mark voucher as POSTED ─────────────────────────────────
            const updated = await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  {
                    status:        "POSTED",
                    postedAt:      new Date(),
                    journalEntryId,
                },
                include: {
                    lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                    createdBy: { select: { name: true } },
                },
            });
            return { result: updated, notes: postNotes };
        });

        return NextResponse.json({ ...result, _postNotes: notes });
    } catch (e) {
        return handleApiError(e, "Failed to post voucher");
    }
}
