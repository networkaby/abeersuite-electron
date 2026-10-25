import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const cancelSchema = z.object({
    reason: z.string().trim().min(1, "Cancel reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/cancel
// Tally-style: reverses GL impact via a counter-entry. Original keeps its
// reference number and stays visible (struck through) for audit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, cancelSchema);
    if (error) return error;

    const entry = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { type: true, status: true, lines: { select: { accountId: true, type: true, amount: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The saved voucher's own Cancel / edit tick, same as the post and hard-delete
    // routes beside this one — any voucher id reaches this route, not only journals.
    if (!userCanVoucher(user, entry.type, "cancel")) {
        return NextResponse.json({ error: "You do not have permission to cancel this voucher kind." }, { status: 403 });
    }
    if (entry.status !== "POSTED") {
        return NextResponse.json({ error: "Only POSTED entries can be cancelled" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {

            // Phase 4 (flag-only cancel): the POSTED-only gate already excludes a
            // CANCELLED entry from every count, so we do NOT post a reversal JE.
            // (The old reversal + CANCELLED flag double-removed — the account
            // landed at −original.) The decrement above removes the original; the
            // status flip hides it from reports; syncSpineLifecycle mirrors the flag.
            await setSpineLifecycle(tx, Number(id), {
                status: "CANCELLED",
                cancelledAt: new Date(),
                cancelReason: data.reason,
                cancelledById: user!.id,
            });
        // Per-line balance decrement over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });

        const cancelled = await prisma.universalVoucher.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        return handleApiError(e, "Failed to cancel journal entry");
    }
}
