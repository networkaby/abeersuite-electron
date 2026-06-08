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
// Physically removes the voucher. Snapshot to InvVoucherAudit; reverses live stock + GL
// only when the voucher is currently posted and not already cancelled or soft-deleted.
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

    const isPurchase = voucher.type === "PURCHASE" || voucher.type === "GRN";
    // POS = counter sale: moves stock OUT like SALE, so reversing must restore it.
    // Omitting POS left the GL reversed but stock un-restored → inventory (a
    // Balance-Sheet asset) came out wrong.
    const isSale     = voucher.type === "SALE"     || voucher.type === "POS" || voucher.type === "CHALLAN";

    const needsReversal = isPosted(voucher) && !isDeleted(voucher) && !isCancelled(voucher);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsReversal) {
                for (const line of voucher.lines) {
                    const qty = toNumber(line.quantity);
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

                if (voucher.journalEntryId) {
                    const origJe = await tx.journalEntry.findUnique({
                        where: { id: voucher.journalEntryId },
                        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
                    });
                    if (origJe && origJe.status === "POSTED" && !origJe.deletedAt) {
                        for (const line of origJe.lines) {
                            const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                            await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                        }
                    }
                }
            }

            const created = await tx.invVoucherAudit.create({
                data: auditSnapshot({
                    originalId: voucher.id,
                    originalRef: voucher.reference,
                    reason: data.reason,
                    snapshot: voucher,
                    actorId: user!.id,
                }),
            });

            // InvStockLedger.voucher is a required relation without
            // onDelete: Cascade (deliberate — the ledger is an immutable
            // audit trail at the schema level). Hard-delete is the one
            // place we DO want to wipe those rows, so the voucher row can
            // actually be removed. The audit snapshot above already
            // captured the voucher state.
            // (InvVoucherLine + InvVoucherCharge cascade automatically.)
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
