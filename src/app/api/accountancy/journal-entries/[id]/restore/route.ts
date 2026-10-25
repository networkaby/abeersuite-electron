import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { writeRestoreAudit } from "@/modules/accountancy/lib/restoreAudit";

const restoreSchema = z.object({
    reason: z.string().trim().min(1, "Restore reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/restore
// Un-cancel: re-applies the GL impact the cancel took out and puts the entry back
// to POSTED. Mirror of the cancel route, gated by the SAME permission — whoever
// may cancel a journal may restore one.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, restoreSchema);
    if (error) return error;

    const entry = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { type: true, status: true, lines: { select: { accountId: true, type: true, amount: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The saved voucher's own Cancel / edit tick — any voucher id reaches this route.
    if (!userCanVoucher(user, entry.type, "cancel")) {
        return NextResponse.json({ error: "You do not have permission to restore this voucher kind." }, { status: 403 });
    }
    if (entry.status !== "CANCELLED") {
        return NextResponse.json({ error: "Only cancelled entries can be restored" }, { status: 409 });
    }


    try {
        await prisma.$transaction(async (tx) => {
            await setSpineLifecycle(tx, Number(id), {
                status: "POSTED",
                cancelledAt: null,
                cancelReason: null,
                cancelledById: null,
            });
        // Per-line balance increment over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028) — same headroom as cancel.
        }, { timeout: 30_000, maxWait: 10_000 });

        await writeRestoreAudit({ entityType: "JOURNAL_ENTRY", originalId: Number(id), originalRef: String(id), reason: data.reason, actorId: user!.id });

        const restored = await prisma.universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(restored);
    } catch (e) {
        return handleApiError(e, "Failed to restore journal entry");
    }
}
