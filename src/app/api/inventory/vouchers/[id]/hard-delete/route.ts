import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanActOnVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { recomputeProductStock } from "@/modules/inventory/lib/stockMovement";
import { retreatReconciliation } from "@/modules/accountancy/lib/reconciliation";
import { removeLinksForVoucher } from "@/modules/accountancy/lib/billLink";
import { auditSnapshot, isPosted, isDeleted, isCancelled, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

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
    const { response, user } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    // Load the full graph up-front so the snapshot captures everything a faithful
    // restore needs (charges/tenders/stock-ledger included — they were missing before).
    const voucherRow = await prisma.voucherDetail.findUnique({
        where: { id: Number(id) },
        // settlementJson (tender/charge input) is a scalar — captured in the snapshot
        // automatically. 5D-2: creator lives on the spine (not needed for the snapshot).
        include: { universalVoucher: { select: { createdById: true, voucherNo: true, status: true, deletedAt: true, type: true } } },   // 5D-6/5D-8/5D-11
    });
    // Phase 5 5C: goods lines + stock ledger hang off the spine — load + attach.
    // 5D-8/5D-11: lifecycle status/deletedAt + type live on the spine — attach for the helpers + type guards.
    const voucher = voucherRow ? {
        ...voucherRow,
        type:      voucherRow.universalVoucher?.type ?? "",
        status:    voucherRow.universalVoucher?.status ?? "DRAFT",
        deletedAt: voucherRow.universalVoucher?.deletedAt ?? null,
        lines: await prisma.voucherInventoryLine.findMany({
            where:   { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
            include: { product: { select: { id: true, sku: true, name: true } } },
        }),
        stockEntries: await prisma.invStockLedger.findMany({
            where: { universalVoucherId: voucherRow.universalVoucherId ?? -1 },
        }),
    } : null;
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Per-kind delete gate — same key the UI uses to show the button
    // (`canHardDelete = canDelete = requiredVoucherPermission(type, "delete")`)
    // and the same gate the accountancy hard-delete route applies. Removal is
    // recoverable (the whole graph is snapshotted to AuditLog = the Recycle Bin),
    // so it rides the voucher matrix rather than a separate admin-only gate.
    // POS Sale / Order / Estimate have no office row — they need their POS-table
    // Delete tick; online orders and invoices pass through.
    if (!userCanActOnVoucher(user, voucher.type, "delete")) {
        return NextResponse.json({ error: "You do not have permission to delete this voucher kind." }, { status: 403 });
    }

    const needsReversal = isPosted(voucher) && !isDeleted(voucher) && !isCancelled(voucher);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            // Linked GL spine row (for the snapshot + the cached-balance reversal).
            // `journalEntryId` carries the spine id for POSTED (self-ref since G5);
            // a DRAFT voucher has only universalVoucherId (Phase 5 5.0d) — fall back
            // to it so the draft spine is physically removed too (no orphan).
            const spineId = voucher.universalVoucherId;
            const origJe = spineId
                ? await tx.universalVoucher.findUnique({
                    where: { id: spineId },
                    include: { lines: true },
                })
                : null;

            if (needsReversal) {
                // Stock needs no hand-rolled reversal here — the ledger rows themselves
                // are deleted below, and `recomputeProductStock` then rebuilds both
                // caches from what remains. That is correct for EVERY type (branch
                // transfer's two rows, physical stock, MJ, returns) and, unlike the
                // increment/decrement math it replaces, cannot drift.

                // Restore the cached Account.balance (denormalised column read by the
                // ledgers list / summary bar — NOT recomputed on row delete). Only when
                // the JE is currently live (a cancelled / soft-deleted JE was already
                // neutralised, so needsReversal is false and we never get here).
                if (origJe && origJe.status === "POSTED" && !origJe.deletedAt) {
                    // Spine lines are scalar — resolve nature in one lookup, the
                    // same way the engine did when it applied these deltas.
                    await applyLineBalances(tx, origJe.lines, "reverse");
                    // Removing a posted voucher dirties a reconciled window exactly
                    // as much as adding one — same retreat as the posting path.
                    await retreatReconciliation(tx, origJe.lines.map((l) => l.accountId), origJe.date);
                }
            }

            // Bill-wise links pointing at a voucher that is about to physically
            // vanish are debris — take them with it, and keep a copy in the snapshot
            // so the audit trail says what was unlinked. Correctness does not depend
            // on this: `sumLinked` ignores a link whose other end has gone, so the
            // counterpart reopens either way. A restore brings the voucher back with
            // a FRESH id, so links are deliberately not re-made — relink by hand.
            const removedLinks = voucher.universalVoucherId != null
                ? await removeLinksForVoucher(tx, voucher.universalVoucherId)
                : [];

            // ONE AuditLog row carrying the whole graph (voucher + children + its JE).
            // Restore reads this single row and rebuilds everything — no cross-row stitching.
            const created = await tx.auditLog.create({
                data: auditSnapshot({
                    entityType: "INV_VOUCHER",
                    subtype: voucher.type,
                    originalId: voucher.id,
                    originalRef: voucher.universalVoucher?.voucherNo ?? "",
                    reason: data.reason,
                    snapshot: { ...voucher, journalEntry: origJe, billLinks: removedLinks },
                    actorId: user!.id,
                }),
            });

            // Physically remove everything. The spine row goes in ALL cases (its snapshot
            // is safe in AuditLog) so nothing orphans. VoucherGlLine, AdditionalCostAllocation
            // and InvStockLedger (a cancel's reversal rows included) cascade off the spine;
            // the explicit stock wipe covers a detail whose spine is already gone.
            if (origJe) await tx.universalVoucher.delete({ where: { id: origJe.id } });
            await tx.invStockLedger.deleteMany({ where: { universalVoucherId: voucher.universalVoucherId ?? -1 } });
            await tx.voucherDetail.delete({ where: { id: voucher.id } });
            // Rows are gone — rebuild on-hand from what's left. Products that were on
            // the removed voucher and nowhere else drop to their opening stock instead
            // of keeping a phantom balance.
            await recomputeProductStock(tx, voucher.stockEntries.map((r) => r.productId));
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
