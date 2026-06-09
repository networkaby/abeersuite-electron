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
// Physically removes the voucher, its lines, AND its mirror GL JournalEntry. The whole
// graph (voucher + lines + JE + JournalLines) is snapshotted into ONE AuditLog row
// (entityType GL_VOUCHER), so the deletion is traceable AND restorable from a single
// row (see /api/audit/[id]/restore).
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
            // Mirror GL entry (for the snapshot + physical removal). The cached balance is
            // reversed via voucher.lines below — the JE lines mirror them, so don't
            // double-apply from the JE.
            const origJe = voucher.journalEntryId
                ? await tx.journalEntry.findUnique({
                    where: { id: voucher.journalEntryId },
                    include: { lines: true },
                  })
                : null;

            if (needsReversal) {
                for (const line of voucher.lines) {
                    const delta = balanceDelta(line.account.normalBalance!, line.type, toNumber(line.amount));
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: delta } } });
                }
            }

            // ONE AuditLog row carrying the whole graph (voucher + lines + its JE) so
            // restore can rebuild everything from a single snapshot.
            const created = await tx.auditLog.create({
                data: auditSnapshot({
                    entityType:  "GL_VOUCHER",
                    subtype:     voucher.type,
                    originalId:  voucher.id,
                    originalRef: voucher.reference,
                    reason:      data.reason,
                    snapshot:    { ...voucher, journalEntry: origJe },
                    actorId:     user!.id,
                }),
            });

            // Physically remove the mirror JE (journalEntryId is a soft pointer — no
            // cascade — so the voucher delete alone would orphan it POSTED in the Balance
            // Sheet). JournalLines cascade off the JE; VoucherLine cascades off the voucher.
            if (origJe) await tx.journalEntry.delete({ where: { id: origJe.id } });
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
