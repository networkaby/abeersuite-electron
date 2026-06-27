import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { toNumber, balanceDelta } from "@/modules/accountancy/lib/balance";
import { auditSnapshot, isPosted, isDeleted, isCancelled, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const schema = z.object({ reason: z.string().trim().min(1, "Delete reason is required") });

// POST /api/inventory/vouchers/[id]/hard-delete
// Physically removes the voucher AND its GL journal entry — nothing live survives.
// The ENTIRE graph (voucher + lines/charges/tenders + stock-ledger rows + its GL
// JournalEntry + JournalLines) is snapshotted first into ONE AuditLog row
// (entityType INV_VOUCHER), so the deletion is both traceable AND fully restorable
// from a single row (see /api/audit/[id]/restore). When the voucher is currently
// posted (not already cancelled / soft-deleted) the cached stock + Account.balance
// are restored first.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_HARD_DELETE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    // Load the full graph up-front so the snapshot captures everything a faithful
    // restore needs (charges/tenders/stock-ledger included — they were missing before).
    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
            // settlementJson (tender/charge input) is a scalar — captured in the snapshot automatically.
            stockEntries: true,
            createdBy: { select: { id: true, name: true } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const needsReversal = isPosted(voucher) && !isDeleted(voucher) && !isCancelled(voucher);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            // Linked GL entry (for the snapshot + the cached-balance reversal).
            const origJe = voucher.journalEntryId
                ? await tx.journalEntry.findUnique({
                    where: { id: voucher.journalEntryId },
                    include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                })
                : null;

            if (needsReversal) {
                // Type-agnostic stock-cache restore — undo each recorded InvStockLedger
                // row's net effect (round(inQty) - round(outQty)) on BOTH the org-wide
                // (InvProduct.stock) and per-branch (InvProductBranch.stock) caches. A
                // branch transfer's two rows net to zero on the org cache but split per
                // branch; returns / physical-stock / MJ all reverse correctly.
                for (const row of voucher.stockEntries) {
                    const reverseDelta = -(Math.round(toNumber(row.inQty)) - Math.round(toNumber(row.outQty)));
                    if (reverseDelta === 0) continue;
                    const cacheUpdate = reverseDelta > 0
                        ? { increment: reverseDelta }
                        : { decrement: -reverseDelta };
                    await tx.invProductBranch.upsert({
                        where:  { productId_branchId: { productId: row.productId, branchId: row.branchId } },
                        create: { productId: row.productId, branchId: row.branchId, stock: reverseDelta },
                        update: { stock: cacheUpdate },
                    });
                    await tx.invProduct.update({
                        where: { id: row.productId },
                        data:  { stock: cacheUpdate },
                    });
                }

                // Restore the cached Account.balance (denormalised column read by the
                // ledgers list / summary bar — NOT recomputed on row delete). Only when
                // the JE is currently live (a cancelled / soft-deleted JE was already
                // neutralised, so needsReversal is false and we never get here).
                if (origJe && origJe.status === "POSTED" && !origJe.deletedAt) {
                    for (const line of origJe.lines) {
                        const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                        await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                    }
                }
            }

            // ONE AuditLog row carrying the whole graph (voucher + children + its JE).
            // Restore reads this single row and rebuilds everything — no cross-row stitching.
            const created = await tx.auditLog.create({
                data: auditSnapshot({
                    entityType: "INV_VOUCHER",
                    subtype: voucher.type,
                    originalId: voucher.id,
                    originalRef: voucher.reference,
                    reason: data.reason,
                    snapshot: { ...voucher, journalEntry: origJe },
                    actorId: user!.id,
                }),
            });

            // Physically remove everything. The JE goes in ALL cases (its snapshot is
            // safe in AuditLog) so nothing orphans — cancel no longer writes counter-JEs,
            // so deleting a cancelled JE leaves no dangling reversal. JournalLines +
            // AdditionalCostAllocation cascade off the JE; InvVoucherLine/Charge/Tender
            // cascade off the voucher; InvStockLedger has no cascade so wipe it explicitly.
            if (origJe) await tx.journalEntry.delete({ where: { id: origJe.id } });
            await tx.invStockLedger.deleteMany({ where: { voucherId: voucher.id } });
            await tx.invVoucher.delete({ where: { id: voucher.id } });
            return created;
        // Reverse stock + GL over the Supabase pooler can exceed the default 5s
        // interactive-tx ceiling (P2028) — match the 30s headroom used by post/PATCH.
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsReversal });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to hard-delete voucher");
    }
}
