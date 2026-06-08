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
// Physically removes the voucher AND its GL journal entry from the database — nothing
// live survives. Both removals are snapshotted first (InvVoucherAudit for the voucher,
// JournalEntryAudit for the GL entry) in the same transaction, so the deletion stays
// fully traceable (who / when / why + a frozen copy of the data). When the voucher is
// currently posted (not already cancelled / soft-deleted) the cached stock +
// Account.balance are restored first.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response, user } = await requirePermission(PERMISSIONS.INVENTORY_VOUCHER_HARD_DELETE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.invVoucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
            createdBy: { select: { id: true, name: true } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const needsReversal = isPosted(voucher) && !isDeleted(voucher) && !isCancelled(voucher);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsReversal) {
                // Type-agnostic stock-cache restore. Drive the reversal off the
                // ACTUAL InvStockLedger rows this voucher wrote, not the voucher
                // type: undo each row's net effect (round(inQty) - round(outQty))
                // on BOTH the org-wide (InvProduct.stock) and per-branch
                // (InvProductBranch.stock) caches, then the rows are physically
                // deleted below. The old sale/purchase-only guess silently skipped
                // returns / branch transfers / physical-stock / manufacturing
                // journals; this covers every type — a branch transfer's two rows
                // naturally net to zero on the org cache but split per branch.
                const stockRows = await tx.invStockLedger.findMany({
                    where:  { voucherId: voucher.id },
                    select: { productId: true, branchId: true, inQty: true, outQty: true },
                });
                for (const row of stockRows) {
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

                if (voucher.journalEntryId) {
                    const origJe = await tx.journalEntry.findUnique({
                        where: { id: voucher.journalEntryId },
                        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                    });
                    if (origJe) {
                        // Restore the cached Account.balance (denormalised column read by
                        // the ledgers list / summary bar — NOT recomputed on row delete).
                        // Skip if the JE was already neutralised (soft-deleted upstream).
                        if (origJe.status === "POSTED" && !origJe.deletedAt) {
                            for (const line of origJe.lines) {
                                const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                                await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                            }
                        }
                        // Snapshot the GL entry, then physically delete it (its JournalLines
                        // + AdditionalCostAllocation consumers cascade). Keeps the GL removal
                        // traceable while leaving nothing in the truth-path reports
                        // (Balance Sheet / ledgers sum POSTED JournalLines).
                        await tx.journalEntryAudit.create({
                            data: {
                                originalId:  origJe.id,
                                originalRef: origJe.reference,
                                action:      "HARD_DELETED",
                                reason:      `Voucher ${voucher.reference} hard-deleted: ${data.reason}`,
                                snapshot:    origJe as unknown as object,
                                actorId:     user!.id,
                            },
                        });
                        await tx.journalEntry.delete({ where: { id: origJe.id } });
                    }
                }
            }

            // Snapshot the voucher before physical deletion so the hard-delete stays
            // traceable (who / when / why + a full frozen copy of the voucher + lines).
            const created = await tx.invVoucherAudit.create({
                data: auditSnapshot({
                    originalId: voucher.id,
                    originalRef: voucher.reference,
                    reason: data.reason,
                    snapshot: voucher,
                    actorId: user!.id,
                }),
            });

            // InvStockLedger.voucher is a required relation without onDelete: Cascade
            // (deliberate — the ledger is an immutable audit trail at the schema level).
            // Hard-delete is the one place we wipe those rows so the voucher row can be
            // removed. (InvVoucherLine + InvVoucherCharge + InvVoucherTender cascade.)
            await tx.invStockLedger.deleteMany({ where: { voucherId: voucher.id } });

            await tx.invVoucher.delete({ where: { id: voucher.id } });
            return created;
        // Reverse stock + GL over the Supabase pooler can exceed the default
        // 5s interactive-tx ceiling (P2028) — match the 30s headroom used by
        // the post/PATCH routes.
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsReversal });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to hard-delete voucher");
    }
}
