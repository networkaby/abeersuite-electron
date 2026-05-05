import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { toNumber } from "@/modules/tally/lib/balance";
import { postInvVoucherToGl } from "@/modules/tally/lib/postInvVoucher";

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
        },
    });

    if (!voucher)                  return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: `Voucher is already ${voucher.status}` }, { status: 409 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "RECEIPT";
    const isSale     = voucher.type === "SALE"     || voucher.type === "ISSUE";

    try {
        const { result, notes } = await prisma.$transaction(async (tx) => {
            // ── 1. Stock ledger + cached InvProduct.stock ─────────────────
            for (const line of voucher.lines) {
                const qty = toNumber(line.quantity);
                await tx.invStockLedger.create({
                    data: {
                        productId: line.productId,
                        voucherId: voucher.id,
                        date:      voucher.date,
                        inQty:     isPurchase ? qty : 0,
                        outQty:    isSale     ? qty : 0,
                        rate:      line.rate,
                        amount:    line.amount,
                    },
                });
                await tx.invProduct.update({
                    where: { id: line.productId },
                    data:  {
                        stock: isPurchase
                            ? { increment: Math.round(qty) }
                            : isSale
                            ? { decrement: Math.round(qty) }
                            : undefined,
                        ...(isPurchase ? { costPaise: Math.round(toNumber(line.rate) * 100) } : {}),
                    },
                });
            }

            // ── 2. Auto-post to GL (only for SALE / PURCHASE) ─────────────
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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to post voucher" }, { status: 500 });
    }
}
