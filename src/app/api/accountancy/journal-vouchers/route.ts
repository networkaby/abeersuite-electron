import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireVoucherPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { engineCreateVoucher } from "@/modules/accountancy/lib/transactionEngine";
import { invNextRef } from "@/modules/inventory/lib/stock";
import { recordStockMovement } from "@/modules/inventory/lib/stockMovement";
import { recomputePricesForProducts } from "@/modules/pricing-strategy/lib/recomputePrices";
import * as Sentry from "@sentry/nextjs";
import { isStockEligibleAccount } from "@/modules/accountancy/lib/stockEligibleAccount";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
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
    const session = await auth();
    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    // Per-kind create gate (+ per-kind post when the voucher is posted immediately).
    // Falls back to the generic finance:voucher:create / :post.
    const { user, response } = await requireVoucherPermission(body.type, "create");
    if (response) return response;
    if (body.postImmediately) {
        const postGate = await requireVoucherPermission(body.type, "post");
        if (postGate.response) return postGate.response;
    }

    let activeBranchId: string;
    try { activeBranchId = resolveActiveBranchId(req, session); }
    catch (e) {
        if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
        throw e;
    }

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Voucher is not balanced — debits must equal credits" }, { status: 422 });
    }

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
            // ── 1. Voucher + (when requested) GL posting via the Transaction Engine ──
            // referenceSeries "JOURNAL" preserves the JV-… numbering the dialog
            // previews via /api/accountancy/vouchers/next-ref?type=JOURNAL. The
            // mirror JE + balance deltas (incl. the null-normalBalance fallback)
            // now live in the engine. GL JE lines stay branch-less (org-level),
            // exactly as before — branch context rides only the stock carrier below.
            const voucher = await engineCreateVoucher(tx, {
                type:            body.type,
                date:            new Date(body.date),
                userId:          user!.id,
                lines:           body.lines,
                narration:       body.narration ?? null,
                referenceSeries: "JOURNAL",
                post:            body.postImmediately,
            });

            if (!body.postImmediately) {
                return { voucherId: voucher.id, reference: voucher.reference, posted: false };
            }

            // ── 2. Stock movement (only if any line carries inventory) ─────
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
                // Phase 5 5C: the JV's stock + goods lines hang off ITS spine
                // (voucher.universalVoucherId). The carrier InvVoucher is kept as a
                // thin sidecar pointing at the same spine.
                const jvSpineId = (voucher as { universalVoucherId: number | null }).universalVoucherId!;
                const carrier = await tx.invVoucher.create({
                    data: {
                        type:        "MANUFACTURING_JOURNAL",
                        reference:   sjRef,
                        branchId:    activeBranchId,
                        date:        new Date(body.date),
                        description: `Auto-created from journal voucher ${voucher.reference}`,
                        status:      "POSTED",
                        postedAt:    new Date(),
                        subtotal:    flatItems.reduce((s, i) => s + i.amount, 0),
                        totalAmount: flatItems.reduce((s, i) => s + i.amount, 0),
                        createdById: user!.id,
                    },
                });
                void carrier;
                await tx.voucherInventoryLine.createMany({
                    data: flatItems.map((i) => ({
                        universalVoucherId: jvSpineId,
                        productId: i.productId,
                        quantity:  i.qty,
                        rate:      i.rate,
                        amount:    i.side === "DEBIT" ? i.amount : -i.amount,
                    })),
                });

                // Write the stock ledger + update cached InvProduct.stock.
                for (let i = 0; i < flatItems.length; i++) {
                    const item        = flatItems[i];
                    const inQty       = item.side === "DEBIT" ? item.qty : 0;
                    const outQty      = item.side === "CREDIT" ? item.qty : 0;

                    // NULL + n = NULL in Postgres, so increment/decrement
                    // silently no-ops on untracked products. Pre-fetch the
                    // cache to switch to absolute set when uninitialized.
                    const current = await tx.invProduct.findUnique({
                        where:  { id: item.productId },
                        select: { stock: true },
                    });
                    await recordStockMovement(tx, {
                        universalVoucherId: jvSpineId,
                        productId: item.productId,
                        branchId:  activeBranchId,
                        date:      new Date(body.date),
                        inQty,
                        outQty,
                        rate:      item.rate,
                        amount:    item.amount,
                        productCurrentStock: current?.stock ?? null,
                        updateBranchBalance: false,
                    });
                }
                // Phase 5 5C: the carrier's stock rows + lines belong to the journal
                // voucher — link them onto its spine (the carrier has no spine of its own).
            }

            return { voucherId: voucher.id, reference: voucher.reference, posted: true };
        });

        const touchedProductIds = body.lines.flatMap((l) =>
            (l.stockItems ?? []).map((s) => s.productId),
        );
        if (touchedProductIds.length > 0) {
            await recomputePricesForProducts(touchedProductIds).catch((err: unknown) => {
                Sentry.captureException(err, { tags: { source: "price-recompute", voucherId: String(result.voucherId) } });
                console.error("[price-recompute] failed for voucher", result.voucherId, err);
            });
        }

        return NextResponse.json(result, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create journal voucher");
    }
}
