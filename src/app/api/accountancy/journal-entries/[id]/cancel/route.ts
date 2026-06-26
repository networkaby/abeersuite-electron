import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { syncSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const cancelSchema = z.object({
    reason: z.string().trim().min(1, "Cancel reason is required"),
});

// POST /api/accountancy/journal-entries/[id]/cancel
// Tally-style: reverses GL impact via a counter-entry. Original keeps its
// reference number and stays visible (struck through) for audit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requirePermission(PERMISSIONS.FINANCE_JOURNAL_CANCEL);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await validateRequest(req, cancelSchema);
    if (error) return error;

    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: {
            lines: { include: { account: { select: { normalBalance: true } } } },
        },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Cannot cancel a deleted entry — restore it first" }, { status: 409 });
    }
    if (entry.status !== "POSTED") {
        return NextResponse.json({ error: "Only POSTED entries can be cancelled" }, { status: 409 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            for (const line of entry.lines) {
                const delta = balanceDelta(
                    line.account.normalBalance!,
                    line.type,
                    toNumber(line.amount),
                );
                await tx.account.update({
                    where: { id: line.accountId },
                    data: { balance: { decrement: delta } },
                });
            }

            // Phase 4 (flag-only cancel): the POSTED-only gate already excludes a
            // CANCELLED entry from every count, so we do NOT post a reversal JE.
            // (The old reversal + CANCELLED flag double-removed — the account
            // landed at −original.) The decrement above removes the original; the
            // status flip hides it from reports; syncSpineLifecycle mirrors the flag.
            await tx.journalEntry.update({
                where: { id: Number(id) },
                data: {
                    status: "CANCELLED",
                    cancelledAt: new Date(),
                    cancelReason: data.reason,
                    cancelledById: user!.id,
                },
            });
            await syncSpineLifecycle(tx, Number(id));
        // Per-line balance decrement over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });

        const cancelled = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
        return NextResponse.json(cancelled);
    } catch (e) {
        return handleApiError(e, "Failed to cancel journal entry");
    }
}
