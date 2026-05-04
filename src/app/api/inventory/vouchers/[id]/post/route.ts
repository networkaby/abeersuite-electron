import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { toNumber } from "@/modules/tally/lib/balance";

// GL account codes used for auto-journal entries
const GL = {
    AR:        "1100",   // Accounts Receivable    (ASSET / DEBIT normal)
    INVENTORY: "1300",   // Inventory / Stock       (ASSET / DEBIT normal)
    AP:        "2000",   // Accounts Payable        (LIABILITY / CREDIT normal)
    SALES:     "4000",   // Sales Revenue           (REVENUE / CREDIT normal)
    PURCHASES: "5000",   // Purchases               (EXPENSE / DEBIT normal)
    COGS:      "5100",   // Cost of Goods Sold      (EXPENSE / DEBIT normal)
    CASH:      "1000",   // Cash / Bank             (ASSET / DEBIT normal)
} as const;

// POST /api/inventory/vouchers/[id]/post
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

    if (!voucher)                 return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") return NextResponse.json({ error: `Voucher is already ${voucher.status}` }, { status: 409 });

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "RECEIPT";
    const isSale     = voucher.type === "SALE"     || voucher.type === "ISSUE";

    try {
        const result = await prisma.$transaction(async (tx) => {
            // ── 1. Write stock ledger entries + update cached InvProduct.stock ──
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

                // Atomically update cached stock (mirrors Account.balance pattern)
                await tx.invProduct.update({
                    where: { id: line.productId },
                    data:  {
                        stock: isPurchase
                            ? { increment: Math.round(qty) }
                            : isSale
                            ? { decrement: Math.round(qty) }
                            : undefined,
                        // Update cost price on purchase
                        ...(isPurchase ? { costPaise: Math.round(toNumber(line.rate) * 100) } : {}),
                    },
                });
            }

            // ── 2. Auto-create GL Journal Entry ───────────────────────────────
            let journalEntryId: number | null = null;
            const totalAmt = toNumber(voucher.totalAmount);

            if (isPurchase || isSale) {
                // Resolve GL accounts by code (graceful — skip if not found)
                const glCodes: string[] = isPurchase
                    ? [GL.PURCHASES, voucher.paymentMode === "CASH" ? GL.CASH : GL.AP]
                    : [GL.AR, GL.SALES];

                const cogsNeeded = isSale && voucher.lines.every((l) => l.product.costPaise != null);
                if (cogsNeeded) glCodes.push(GL.COGS, GL.INVENTORY);

                const glAccounts = await tx.account.findMany({
                    where:  { code: { in: glCodes }, isActive: true },
                    select: { id: true, code: true, normalBalance: true },
                });
                const byCode = Object.fromEntries(glAccounts.map((a) => [a.code!, a]));

                // Only create JE if we have the essential GL accounts
                const hasEssential = isPurchase
                    ? !!byCode[GL.PURCHASES]
                    : !!byCode[GL.AR] && !!byCode[GL.SALES];

                if (hasEssential) {
                    // Build journal lines
                    const jeLines: { accountId: number; type: "DEBIT" | "CREDIT"; amount: number; description?: string }[] = [];

                    if (isPurchase) {
                        jeLines.push(
                            { accountId: byCode[GL.PURCHASES].id, type: "DEBIT",  amount: totalAmt, description: voucher.description },
                        );
                        const creditAcc = byCode[voucher.paymentMode === "CASH" ? GL.CASH : GL.AP];
                        if (creditAcc) {
                            jeLines.push({ accountId: creditAcc.id, type: "CREDIT", amount: totalAmt, description: voucher.partyName ?? undefined });
                        }
                    } else {
                        // Sale revenue side
                        jeLines.push(
                            { accountId: byCode[GL.AR].id,    type: "DEBIT",  amount: totalAmt, description: voucher.partyName ?? undefined },
                            { accountId: byCode[GL.SALES].id, type: "CREDIT", amount: totalAmt, description: voucher.description },
                        );
                        // COGS side (if cost price available for all lines)
                        if (cogsNeeded && byCode[GL.COGS] && byCode[GL.INVENTORY]) {
                            const cogsTotal = voucher.lines.reduce((s, l) => {
                                const cost = (l.product.costPaise ?? 0) / 100;
                                return s + cost * toNumber(l.quantity);
                            }, 0);
                            if (cogsTotal > 0) {
                                jeLines.push(
                                    { accountId: byCode[GL.COGS].id,      type: "DEBIT",  amount: cogsTotal, description: "COGS" },
                                    { accountId: byCode[GL.INVENTORY].id, type: "CREDIT", amount: cogsTotal, description: "Stock reduction" },
                                );
                            }
                        }
                    }

                    if (jeLines.length >= 2) {
                        // Sequential JE reference
                        const year  = new Date().getFullYear();
                        const start = `JE-${year}-`;
                        const cnt   = await tx.journalEntry.count({ where: { reference: { startsWith: start } } });
                        const ref   = `${start}${String(cnt + 1).padStart(4, "0")}`;

                        const je = await tx.journalEntry.create({
                            data: {
                                date:        voucher.date,
                                reference:   ref,
                                description: voucher.reference,
                                status:      "POSTED",
                                postedAt:    new Date(),
                                createdById: userId,
                                lines: { create: jeLines },
                            },
                        });

                        // Update Account.balance for each line (mirrors JournalEntry post logic)
                        for (const jl of jeLines) {
                            const acc = glAccounts.find((a) => a.id === jl.accountId)!;
                            const delta = acc.normalBalance === "DEBIT"
                                ? (jl.type === "DEBIT" ? jl.amount : -jl.amount)
                                : (jl.type === "CREDIT" ? jl.amount : -jl.amount);
                            await tx.account.update({
                                where: { id: jl.accountId },
                                data:  { balance: { increment: delta } },
                            });
                        }

                        journalEntryId = je.id;
                    }
                }
            }

            // ── 3. Mark voucher as POSTED ─────────────────────────────────────
            return tx.invVoucher.update({
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
        });

        return NextResponse.json(result);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to post voucher" }, { status: 500 });
    }
}
