import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { applyLineBalances } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { writeRestoreAudit } from "@/modules/accountancy/lib/restoreAudit";

const restoreSchema = z.object({
    reason: z.string().trim().min(1, "Restore reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/restore
// Un-cancel: re-applies the GL impact the cancel took out and puts the entry back
// to POSTED. Mirror of the cancel route, gated by the SAME permission — whoever
// may cancel a journal may restore one.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_VOUCHER_CANCEL_JOURNAL);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, restoreSchema);
    if (error) return error;

    const entry = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { status: true, deletedAt: true, lines: { select: { accountId: true, type: true, amount: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Cannot restore a deleted entry — use the Recycle Bin" }, { status: 409 });
    }
    if (entry.status !== "CANCELLED") {
        return NextResponse.json({ error: "Only cancelled entries can be restored" }, { status: 409 });
    }


    try {
        await prisma.$transaction(async (tx) => {
            // Cancel decremented each line's delta and flipped the flag; restore does
            // exactly the opposite. No counter-entry on either side.
            // Nature resolves with the group fallback, exactly as the engine
            // resolved it when posting — a party ledger carries a null
            // normalBalance, and a bare read used to sign-flip its delta.
            await applyLineBalances(tx, entry.lines, "apply");

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
