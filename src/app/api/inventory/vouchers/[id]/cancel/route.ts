import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { toNumber } from "@/modules/accountancy/lib/balance";
import { ensureCancelable, cancelFields, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";

// POST /api/inventory/vouchers/[id]/cancel
// Reverses stock + GL impact via counter-entry; preserves voucher reference number.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission("inventory:voucher:cancel");
    if (response) return response;

    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) return NextResponse.json({ error: "Cancel reason required" }, { status: 400 });

    const userId = user!.id;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { product: { select: { id: true } } } } },
    });

    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "RECEIPT" || voucher.type === "GRN";
    const isSale     = voucher.type === "SALE"     || voucher.type === "ISSUE"   || voucher.type === "CHALLAN";

    try {
        ensureCancelable(voucher);

        await prisma.$transaction(async (tx) => {
            // ── 1. Reverse stock ledger + cached InvProduct.stock ─────────────
            for (const line of voucher.lines) {
                const qty = toNumber(line.quantity);

                await tx.invStockLedger.create({
                    data: {
                        productId: line.productId,
                        voucherId: voucher.id,
                        date:      new Date(),
                        inQty:     isSale     ? qty : 0,
                        outQty:    isPurchase ? qty : 0,
                        rate:      line.rate,
                        amount:    -toNumber(line.amount),
                    },
                });

                await tx.invProduct.update({
                    where: { id: line.productId },
                    data:  {
                        stock: isPurchase
                            ? { decrement: Math.round(qty) }
                            : isSale
                            ? { increment: Math.round(qty) }
                            : undefined,
                    },
                });
            }

            // ── 2. Reverse GL Journal Entry if one was created ────────────────
            if (voucher.journalEntryId) {
                const origJe = await tx.journalEntry.findUnique({
                    where: { id: voucher.journalEntryId },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                });

                if (origJe && origJe.status === "POSTED") {
                    const year  = new Date().getFullYear();
                    const start = `JE-${year}-`;
                    const cnt   = await tx.journalEntry.count({ where: { reference: { startsWith: start } } });
                    const ref   = `${start}${String(cnt + 1).padStart(4, "0")}`;

                    const reversalLines = origJe.lines.map((l) => ({
                        accountId:   l.accountId,
                        type:        (l.type === "DEBIT" ? "CREDIT" : "DEBIT") as "DEBIT" | "CREDIT",
                        amount:      toNumber(l.amount),
                        description: `CANCEL: ${l.description ?? ""}`,
                    }));

                    const revJe = await tx.journalEntry.create({
                        data: {
                            date:        new Date(),
                            reference:   ref,
                            description: `CANCEL: ${origJe.description}`,
                            status:      "POSTED",
                            postedAt:    new Date(),
                            createdById: userId,
                            lines:       { create: reversalLines },
                        },
                    });

                    for (const rl of reversalLines) {
                        const origLine = origJe.lines.find((l) => l.accountId === rl.accountId)!;
                        const delta = origLine.account.normalBalance === "DEBIT"
                            ? (rl.type === "DEBIT" ? rl.amount : -rl.amount)
                            : (rl.type === "CREDIT" ? rl.amount : -rl.amount);
                        await tx.account.update({
                            where: { id: rl.accountId },
                            data:  { balance: { increment: delta } },
                        });
                    }

                    await tx.journalEntry.update({
                        where: { id: origJe.id },
                        data:  {
                            status: "CANCELLED",
                            cancelledAt: new Date(),
                            cancelledById: userId,
                            cancelReason: `Voucher ${voucher.reference} cancelled. Reversal: ${revJe.reference}`,
                        },
                    });
                }
            }

            // ── 3. Mark voucher as CANCELLED ──────────────────────────────────
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  cancelFields(userId, reason.trim()),
            });
        });

        const updated = await prisma.invVoucher.findUnique({
            where: { id: Number(id) },
            include: {
                lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
                createdBy: { select: { name: true } },
            },
        });
        return NextResponse.json(updated);
    } catch (err) {
        const lifecycle = lifecycleErrorResponse(err);
        if (lifecycle) return lifecycle;
        console.error(err);
        return NextResponse.json({ error: "Failed to cancel voucher" }, { status: 500 });
    }
}
