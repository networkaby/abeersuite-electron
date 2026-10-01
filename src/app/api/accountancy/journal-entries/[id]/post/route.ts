import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, userCanVoucher } from "@/shared/lib/auth/permissions";
import { isBalanced, applyLineBalances } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/journal-entries/[id]/post
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const { id } = await params;

    const entry = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { type: true, status: true, lines: { select: { accountId: true, type: true, amount: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The kind's Post tick (Journal → finance:voucher:post:journal), same as the
    // GL voucher post route.
    if (!userCanVoucher(user, entry.type, "post")) {
        return NextResponse.json({ error: "You do not have permission to post this voucher kind." }, { status: 403 });
    }
    if (entry.status !== "DRAFT") {
        return NextResponse.json({ error: `Entry is already ${entry.status}` }, { status: 409 });
    }

    if (!isBalanced(entry.lines)) {
        return NextResponse.json({ error: "Entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Update each account balance atomically
            // Nature resolves with the group fallback, exactly as the engine
            // resolved it when posting — a party ledger carries a null
            // normalBalance, and a bare read used to sign-flip its delta.
            await applyLineBalances(tx, entry.lines, "apply");
            await setSpineLifecycle(tx, Number(id), { status: "POSTED", postedAt: new Date() });
        // Per-line account.update over the Supabase pooler can exceed the
        // default 5s interactive-tx ceiling (P2028) on multi-line entries.
        }, { timeout: 30_000, maxWait: 10_000 });

        const posted = await prisma.universalVoucher.findUnique({
            where:   { id: Number(id) },
            include: { lines: { select: { accountId: true, type: true, amount: true, description: true } } },
        });
        return NextResponse.json(posted);
    } catch (e) {
        return handleApiError(e, "Failed to post journal entry");
    }
}
