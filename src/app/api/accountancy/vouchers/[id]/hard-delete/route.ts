import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { auditSnapshot, isPosted, isDeleted, isCancelled, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const schema = z.object({ reason: z.string().trim().min(1, "Delete reason required") });

// POST /api/accountancy/vouchers/[id]/hard-delete
// Physically removes the voucher and its lines. Snapshot to AuditLog (GL_VOUCHER +
// JOURNAL_ENTRY for the mirror GL entry).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_VOUCHER_HARD_DELETE);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.voucher.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } } },
            createdBy: { select: { id: true, name: true } },
        },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const needsReversal = isPosted(voucher) && !isDeleted(voucher) && !isCancelled(voucher);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsReversal) {
                for (const line of voucher.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                }

                // The cached Account.balance is reversed above via voucher.lines, but
                // the mirror GL JournalEntry (created on post) must also be removed —
                // otherwise it lingers POSTED in the truth path (Balance Sheet / ledgers
                // sum POSTED JournalLines). Snapshot it, then physically delete it (its
                // JournalLines cascade). journalEntryId is a soft pointer (no cascade),
                // so the voucher delete alone would never touch it.
                if (voucher.journalEntryId) {
                    const origJe = await tx.journalEntry.findUnique({
                        where: { id: voucher.journalEntryId },
                        include: { lines: true },
                    });
                    if (origJe) {
                        await tx.auditLog.create({
                            data: {
                                entityType:  "JOURNAL_ENTRY",
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

            const created = await tx.auditLog.create({
                data: auditSnapshot({
                    entityType:  "GL_VOUCHER",
                    originalId:  voucher.id,
                    originalRef: voucher.reference,
                    reason:      data.reason,
                    snapshot:    voucher,
                    actorId:     user!.id,
                }),
            });

            await tx.voucher.delete({ where: { id: voucher.id } });
            return created;
        // Per-line balance reversal over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028) — match 30s.
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsReversal });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to hard-delete voucher");
    }
}
