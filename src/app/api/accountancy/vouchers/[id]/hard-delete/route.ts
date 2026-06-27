import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { auditSnapshot, isPosted, isDeleted, isCancelled, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const schema = z.object({ reason: z.string().trim().min(1, "Delete reason required") });

// POST /api/accountancy/vouchers/[id]/hard-delete
// Physically removes the financial voucher (the spine + its VoucherGlLine, which
// cascades). The whole graph is snapshotted into ONE AuditLog row (GL_VOUCHER) so
// the deletion is traceable + restorable. Phase 5 5E: the spine IS the voucher.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const voucher = await prisma.universalVoucher.findUnique({
        where:   { id: Number(id) },
        include: { lines: true },
    });
    if (!voucher) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!userCanVoucher(user, voucher.type, "delete")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const needsReversal = isPosted(voucher) && !isDeleted(voucher) && !isCancelled(voucher);
    const nbRows = await prisma.account.findMany({
        where:  { id: { in: [...new Set(voucher.lines.map((l) => l.accountId))] } },
        select: { id: true, normalBalance: true },
    });
    const nbById = new Map(nbRows.map((a) => [a.id, a.normalBalance]));

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsReversal) {
                for (const line of voucher.lines) {
                    const nb = nbById.get(line.accountId);
                    if (!nb) continue;
                    await tx.account.update({ where: { id: line.accountId }, data: { balance: { decrement: balanceDelta(nb, line.type, toNumber(line.amount)) } } });
                }
            }

            // ONE AuditLog row carrying the whole graph (spine + its GL lines) so
            // restore can rebuild everything from a single snapshot.
            const created = await tx.auditLog.create({
                data: auditSnapshot({
                    entityType:  "GL_VOUCHER",
                    subtype:     voucher.type,
                    originalId:  voucher.id,
                    originalRef: voucher.reference,
                    reason:      data.reason,
                    snapshot:    { ...voucher, journalEntry: voucher },
                    actorId:     user!.id,
                }),
            });

            // Physically remove the spine (VoucherGlLine cascades off it).
            await tx.universalVoucher.delete({ where: { id: voucher.id } });
            return created;
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({ ok: true, auditId: audit.id, reversedLedger: needsReversal });
    } catch (e) {
        const lifecycle = lifecycleErrorResponse(e);
        if (lifecycle) return lifecycle;
        return handleApiError(e, "Failed to hard-delete voucher");
    }
}
