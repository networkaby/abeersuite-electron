import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireModuleAccess } from "@/shared/lib/auth/permissions";
import { isBalanced, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { setSpineLifecycle } from "@/modules/accountancy/lib/transactionEngine";
import { handleApiError } from "@/shared/lib/api";

// POST /api/accountancy/journal-entries/[id]/post
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { id } = await params;

    const entry = await prisma.universalVoucher.findUnique({
        where:  { id: Number(id) },
        select: { status: true, deletedAt: true, lines: { select: { accountId: true, type: true, amount: true } } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const nbById = new Map(
        (await prisma.account.findMany({ where: { id: { in: [...new Set(entry.lines.map((l) => l.accountId))] } }, select: { id: true, normalBalance: true } }))
            .map((a) => [a.id, a.normalBalance]),
    );
    if (entry.deletedAt) {
        return NextResponse.json({ error: "Cannot post a deleted entry — restore it first" }, { status: 409 });
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
            for (const line of entry.lines) {
                const delta = balanceDelta(nbById.get(line.accountId)!, line.type, toNumber(line.amount));
                await tx.account.update({
                    where: { id: line.accountId },
                    data: { balance: { increment: delta } },
                });
            }
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
