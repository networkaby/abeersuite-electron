import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, balanceDelta, nextRef, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { isStockEligibleAccount } from "@/modules/accountancy/lib/stockEligibleAccount";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";

// POST /api/accountancy/journal-vouchers
//
// One-shot transactional Tally-style journal voucher with optional inventory.
// Inventory under a Dr line = stock IN, under a Cr line = stock OUT.
//
// Writes (when postImmediately=true):
//   Voucher + VoucherLine          (DRAFT or POSTED depending on flag)
//   JournalEntry + JournalLine     (mirror, audit)
//   Account.balance                (per-line delta)
// And, if any stockItems:
//   InvVoucher (type=MANUFACTURING_JOURNAL) + InvVoucherLine  ← carrier for FK on InvStockLedger
//   InvStockLedger                 (inQty for Dr-side items, outQty for Cr-side items)
//   InvProduct.stock               (cached running balance)
//
// All in a single prisma.$transaction so partial state can never leak.

const stockItemSchema = z.object({
    productId: z.number().int().positive(),
    qty:       z.number().positive(),
    rate:      z.number().nonnegative(),
});

const lineSchema = z.object({
    accountId:   z.number().int().positive(),
    type:        z.enum(["DEBIT", "CREDIT"]),
    amount:      z.number().positive(),
    description: z.string().trim().optional(),
    stockItems:  z.array(stockItemSchema).optional(),
});

const createSchema = z.object({
    type:            z.enum(["CONTRA", "PAYMENT", "RECEIPT", "CREDIT_NOTE", "DEBIT_NOTE", "JOURNAL"]),
    date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    narration:       z.string().trim().optional(),
    postImmediately: z.boolean().default(false),
    lines:           z.array(lineSchema).min(2),
});

export async function POST(req: NextRequest) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_VOUCHER_CREATE);
    if (response) return response;

    const session = await auth();
    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    let activeBranchId: string;
    try { activeBranchId = resolveActiveBranchId(req, session); }
    catch (e) {
        if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
    }

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

    const totalAmount = body.lines
        .filter((l) => l.type === "DEBIT")
        .reduce((s, l) => s + l.amount, 0);

    const hasStock = body.lines.some((l) => (l.stockItems?.length ?? 0) > 0);

    // Defense in depth — even if a future client bypasses the dialog, only
    // ledgers under the Sales Accounts or Purchase Accounts groups may carry
    // inventory. Every other voucher posts pure money / liability movements.
    // See modules/accountancy/lib/stockEligibleAccount.ts for the rule + the
    // Stock Journal / Physical Stock exceptions.
    if (hasStock) {
        const stockLineAccountIds = body.lines
            .filter((l) => (l.stockItems?.length ?? 0) > 0)
            .map((l) => l.accountId);
        const accs = await prisma.account.findMany({
            where:  { id: { in: stockLineAccountIds } },
            select: { id: true, name: true, group: { select: { name: true, type: true } } },
        });
        const bad = accs.find((a) => !isStockEligibleAccount(a));
        if (bad) {
            return NextResponse.json(
                { error: `${bad.name} is not a Sales / Purchase ledger — inventory items only attach to Sales Accounts or Purchase Accounts (use Stock Journal or Physical Stock for other stock moves)` },
                { status: 422 },
            );
        }
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // ── 1. Voucher header + lines ──────────────────────────────────
            // Reference assembly is delegated to the JOURNAL VoucherSeries
            // configured in Settings → Year Ending. This is the same series
            // the dialog previews via /api/accountancy/vouchers/next-ref?type=JOURNAL.
            const reference = await nextRefFromSeries(tx, "JOURNAL", user!.id);

            const voucher = await tx.voucher.create({
                data: {
                    type:        body.type,
                    reference,
                    date:        new Date(body.date),
                    narration:   body.narration ?? null,
                    totalAmount,
                    createdById: user!.id,
                    status:      "DRAFT",
                    lines: {
                        create: body.lines.map((l) => ({
                            accountId:   l.accountId,
                            type:        l.type,
                            amount:      l.amount,
                            description: l.description ?? null,
                        })),
                    },
                },
            });

            if (!body.postImmediately) {
                return { voucherId: voucher.id, reference, posted: false };
            }

            // ── 2. Mirror JournalEntry (GL) ────────────────────────────────
            const accountsLite = await tx.account.findMany({
                where:  { id: { in: body.lines.map((l) => l.accountId) } },
                select: { id: true, normalBalance: true },
            });
            const normalBalanceById = new Map(accountsLite.map((a) => [a.id, a.normalBalance]));

            const jeRef = await nextRef(tx, "journalEntry", "JE");
            const je = await tx.journalEntry.create({
                data: {
                    date:        new Date(body.date),
                    reference:   jeRef,
                    description: `${body.type} ${reference}: ${body.narration ?? ""}`.trim(),
                    status:      "POSTED",
                    postedAt:    new Date(),
                    createdById: user!.id,
                    lines: {
                        create: body.lines.map((l) => ({
                            accountId:   l.accountId,
                            type:        l.type,
                            amount:      l.amount,
                            description: l.description ?? null,
                        })),
                    },
                },
            });

            for (const l of body.lines) {
                const nb = normalBalanceById.get(l.accountId);
                if (!nb) continue;
                const delta = balanceDelta(nb, l.type, l.amount);
                await tx.account.update({
                    where: { id: l.accountId },
                    data:  { balance: { increment: delta } },
                });
            }

            await tx.voucher.update({
                where: { id: voucher.id },
                data:  { status: "POSTED", postedAt: new Date(), journalEntryId: je.id },
            });

            // ── 3. Stock movement (only if any line carries inventory) ─────
            if (hasStock) {
                const flatItems = body.lines.flatMap((l) =>
                    (l.stockItems ?? []).map((s) => ({
                        side:      l.type,                 // DEBIT → IN, CREDIT → OUT
                        productId: s.productId,
                        qty:       s.qty,
                        rate:      s.rate,
                        amount:    s.qty * s.rate,
                    })),
                );

                // Carrier InvVoucher so InvStockLedger.voucherId FK is satisfied.
                const sjRef = await invNextRef(tx, "MANUFACTURING_JOURNAL");
                const carrier = await tx.invVoucher.create({
                    data: {
                        type:        "MANUFACTURING_JOURNAL",
                        reference:   sjRef,
                        branchId:    activeBranchId,
                        date:        new Date(body.date),
                        description: `Auto-created from journal voucher ${reference}`,
                        status:      "POSTED",
                        postedAt:    new Date(),
                        subtotal:    flatItems.reduce((s, i) => s + i.amount, 0),
                        totalAmount: flatItems.reduce((s, i) => s + i.amount, 0),
                        createdById: user!.id,
                        lines: {
                            create: flatItems.map((i) => ({
                                productId: i.productId,
                                quantity:  i.qty,
                                rate:      i.rate,
                                // Sign of amount drives IN/OUT in postInvVoucher.ts conventions —
                                // we apply the stock delta directly below, but mirror the
                                // convention here so anyone reading the voucher sees direction.
                                amount:    i.side === "DEBIT" ? i.amount : -i.amount,
                            })),
                        },
                    },
                    include: { lines: true },
                });

                // Pair carrier lines back to their direction by index, then write
                // the stock ledger + update cached InvProduct.stock.
                for (let i = 0; i < flatItems.length; i++) {
                    const item        = flatItems[i];
                    const carrierLine = carrier.lines[i];
                    const inQty       = item.side === "DEBIT" ? item.qty : 0;
                    const outQty      = item.side === "CREDIT" ? item.qty : 0;

                    await tx.invStockLedger.create({
                        data: {
                            productId: item.productId,
                            voucherId: carrier.id,
                            branchId:  activeBranchId,
                            date:      new Date(body.date),
                            inQty,
                            outQty,
                            rate:      item.rate,
                            amount:    item.amount,
                        },
                    });

                    // Coalesce null → numeric. NULL + n = NULL in Postgres,
                    // so increment/decrement silently no-op on untracked
                    // products. Read current stock first; if null, set the
                    // absolute delta; otherwise apply the delta.
                    const current = await tx.invProduct.findUnique({
                        where:  { id: item.productId },
                        select: { stock: true },
                    });
                    const delta = inQty > 0 ? Math.round(inQty) : -Math.round(outQty);
                    await tx.invProduct.update({
                        where: { id: item.productId },
                        data:  {
                            stock: current?.stock === null
                                ? delta
                                : delta > 0
                                    ? { increment: delta }
                                    : { decrement: -delta },
                        },
                    });

                    // Suppress unused-var lint for carrierLine — kept for readability.
                    void carrierLine;
                }
            }

            return { voucherId: voucher.id, reference, posted: true };
        });

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create journal voucher");
    }
}
