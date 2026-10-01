import { prisma } from "@/shared/lib/prisma/prismaClient";
import { formatUvNo } from "@/shared/lib/accountancy/uvNo";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { auditSnapshot, isPosted, isCancelled, lifecycleErrorResponse } from "@/modules/accountancy/lib/voucherLifecycle";
import { retreatReconciliation } from "@/modules/accountancy/lib/reconciliation";
import { removeLinksForVoucher } from "@/modules/accountancy/lib/billLink";
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

    const needsReversal = isPosted(voucher) && !isCancelled(voucher);

    try {
        const audit = await prisma.$transaction(async (tx) => {
            if (needsReversal) {
                await applyLineBalances(tx, voucher.lines, "reverse");
                // Removing a posted voucher dirties a reconciled window exactly as
                // much as adding one — same retreat as the posting path.
                await retreatReconciliation(tx, voucher.lines.map((l) => l.accountId), voucher.date);
            }

            // Bill-wise links pointing at a voucher that is about to physically
            // vanish are debris — take them with it, and keep a copy in the snapshot
            // so the audit trail says what was unlinked. Correctness does not depend
            // on this: `sumLinked` ignores a link whose other end has gone, so the
            // counterpart reopens either way. A restore brings the voucher back with
            // a FRESH id, so links are deliberately not re-made — relink by hand.
            const removedLinks = await removeLinksForVoucher(tx, voucher.id);

            // ONE AuditLog row carrying the whole graph (spine + its GL lines) so
            // restore can rebuild everything from a single snapshot.
            const created = await tx.auditLog.create({
                data: auditSnapshot({
                    entityType:  "GL_VOUCHER",
                    subtype:     voucher.type,
                    originalId:  voucher.id,
                    originalRef: voucher.voucherNo ?? formatUvNo(voucher.id),
                    reason:      data.reason,
                    snapshot:    { ...voucher, journalEntry: voucher, billLinks: removedLinks },
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
