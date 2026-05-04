import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { toNumber } from "@/modules/tally/lib/balance";

// POST /api/inventory/vouchers/[id]/void
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { reason } = (await req.json()) as { reason?: string };
    if (!reason?.trim()) return NextResponse.json({ error: "Void reason required" }, { status: 400 });

    const userId = user!.id;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { include: { product: { select: { id: true } } } } },
    });

    if (!voucher)                  return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.status !== "POSTED") return NextResponse.json({ error: "Only POSTED vouchers can be voided" }, { status: 409 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "RECEIPT";
    const isSale     = voucher.type === "SALE"     || voucher.type === "ISSUE";

    try {
        await prisma.$transaction(async (tx) => {
            // ── 1. Reverse stock ledger + cached InvProduct.stock ─────────────
            for (const line of voucher.lines) {
                const qty = toNumber(line.quantity);

                // Write reversal ledger entry (swap inQty/outQty)
                await tx.invStockLedger.create({
                    data: {
                        productId: line.productId,
                        voucherId: voucher.id,
                        date:      new Date(),
                        inQty:     isSale     ? qty : 0,  // reversal: sale → put back in
                        outQty:    isPurchase ? qty : 0,  // reversal: purchase → take out
                        rate:      line.rate,
                        amount:    -toNumber(line.amount),
                    },
                });

                // Reverse cached stock
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

                    // Reversal: swap DEBIT ↔ CREDIT
                    const reversalLines = origJe.lines.map((l) => ({
                        accountId:   l.accountId,
                        type:        (l.type === "DEBIT" ? "CREDIT" : "DEBIT") as "DEBIT" | "CREDIT",
                        amount:      toNumber(l.amount),
                        description: `VOID: ${l.description ?? ""}`,
                    }));

                    const revJe = await tx.journalEntry.create({
                        data: {
                            date:        new Date(),
                            reference:   ref,
                            description: `VOID: ${origJe.description}`,
                            status:      "POSTED",
                            postedAt:    new Date(),
                            createdById: userId,
                            lines:       { create: reversalLines },
                        },
                    });

                    // Reverse Account.balance for each reversal line
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

                    // Mark original JE as voided
                    await tx.journalEntry.update({
                        where: { id: origJe.id },
                        data:  { status: "VOIDED", voidedAt: new Date(), voidReason: `Voucher ${voucher.reference} voided. Reversal: ${revJe.reference}` },
                    });
                }
            }

            // ── 3. Mark voucher as VOIDED ─────────────────────────────────────
            await tx.invVoucher.update({
                where: { id: voucher.id },
                data:  { status: "VOIDED", voidedAt: new Date(), voidReason: reason.trim() },
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
        console.error(err);
        return NextResponse.json({ error: "Failed to void voucher" }, { status: 500 });
    }
}
