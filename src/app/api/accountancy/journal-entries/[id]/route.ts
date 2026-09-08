import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireModuleAccess } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { assertLinksSurviveEdit, BillLinkError } from "@/modules/accountancy/lib/billLink";

const lineSchema = z.object({
    accountId: z.number().int().positive(),
    type: z.enum(["DEBIT", "CREDIT"]),
    amount: z.number().positive(),
    description: z.string().trim().optional(),
});

const updateSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().trim().min(1).optional(),
    lines: z.array(lineSchema).min(2).optional(),
});

// GET /api/accountancy/journal-entries/[id]
// `id` is the UniversalVoucher (spine) id — the single GL row since the
// JournalEntry drop (G5). Lines are scalar/id-only on the spine, so the
// account + creator are enriched from separate lookups to preserve the shape.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const entry = await prisma.universalVoucher.findUnique({
        where: { id: Number(id) },
        include: { lines: { orderBy: [{ type: "asc" }, { id: "asc" }] } },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const acctIds = [...new Set(entry.lines.map((l) => l.accountId))];
    const [accounts, createdBy] = await Promise.all([
        prisma.account.findMany({
            where:  { id: { in: acctIds } },
            select: { id: true, code: true, name: true, normalBalance: true },
        }),
        prisma.user.findUnique({ where: { id: entry.createdById }, select: { id: true, name: true } }),
    ]);
    const acctById = new Map(accounts.map((a) => [a.id, a]));

    return NextResponse.json({
        ...entry,
        createdBy,
        lines: entry.lines.map((l) => ({ ...l, account: acctById.get(l.accountId) ?? null })),
    });
}

// PATCH /api/accountancy/journal-entries/[id]
//
//   • DRAFT  → swap lines + update header. No GL impact.
//   • POSTED → atomic reversal of old line impact + re-apply of new impact,
//              mirroring the cancel route's reversal logic minus the
//              counter-entry/status-flip. Reference + POSTED status stay.
//   • CANCELLED / deleted → 409.
//
// Operates directly on the spine (UniversalVoucher + VoucherGlLine) — the lone
// GL representation since G5. `id` is the spine id.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireModuleAccess("accountancy");
    if (response) return response;

    const { id } = await params;
    const entryId = Number(id);
    const existing = await prisma.universalVoucher.findUnique({
        where:   { id: entryId },
        include: { lines: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.deletedAt) {
        return NextResponse.json({ error: "Entry is deleted — restore it first" }, { status: 409 });
    }
    if (existing.status === "CANCELLED") {
        return NextResponse.json({ error: "Cancelled entries cannot be edited" }, { status: 409 });
    }

    const { data, error } = await validateRequest(req, updateSchema);
    if (error) return error;
    const body = data;

    if (body.lines && !isBalanced(body.lines)) {
        return NextResponse.json({ error: "Journal entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    // Spine lines are scalar — resolve normalBalance for the old lines up front.
    const oldAcctIds = [...new Set(existing.lines.map((l) => l.accountId))];
    const nbRows = await prisma.account.findMany({
        where:  { id: { in: oldAcctIds } },
        select: { id: true, normalBalance: true },
    });
    const nbById = new Map(nbRows.map((a) => [a.id, a.normalBalance]));

    try {
        const updated = await prisma.$transaction(async (tx) => {
            // ── POSTED: reverse the old GL impact first ─────────────────
            if (existing.status === "POSTED" && body.lines) {
                for (const line of existing.lines) {
                    const nb = nbById.get(line.accountId);
                    if (!nb) continue;
                    const delta = balanceDelta(nb, line.type, toNumber(line.amount));
                    await tx.account.update({
                        where: { id: line.accountId },
                        data:  { balance: { decrement: delta } },
                    });
                }
            }

            // Swap lines if provided
            if (body.lines) {
                await tx.voucherGlLine.deleteMany({ where: { universalVoucherId: entryId } });
                await tx.voucherGlLine.createMany({
                    data: body.lines.map((l, idx) => ({
                        universalVoucherId: entryId,
                        accountId:          l.accountId,
                        type:               l.type,
                        amount:             l.amount,
                        description:        l.description ?? null,
                        seq:                idx,
                    })),
                });
            }

            // ── POSTED: apply the new GL impact ─────────────────────────
            if (existing.status === "POSTED" && body.lines) {
                for (const line of body.lines) {
                    const acct = await tx.account.findUnique({
                        where:  { id: line.accountId },
                        select: { normalBalance: true },
                    });
                    if (!acct?.normalBalance) continue;
                    const delta = balanceDelta(acct.normalBalance, line.type, line.amount);
                    await tx.account.update({
                        where: { id: line.accountId },
                        data:  { balance: { increment: delta } },
                    });
                }
            }

            const updatedJe = await tx.universalVoucher.update({
                where: { id: entryId },
                data: {
                    ...(body.date ? { date: new Date(body.date) } : {}),
                    ...(body.description ? { description: body.description } : {}),
                },
                include: { lines: true },
            });

            // A journal with a party leg can be settling a bill like anything
            // else, and the line swap above knows nothing about that. Checked on
            // the entry as it now stands, so a refusal rolls the edit back.
            await assertLinksSurviveEdit(tx, {
                spineId:     entryId,
                partyBefore: existing.partyAccountId,
                partyAfter:  existing.partyAccountId,
            });
            return updatedJe;
        // Posted edit = reverse + per-new-line findUnique + re-apply; over the
        // Supabase pooler this can exceed the default 5s interactive-tx
        // ceiling (P2028).
        }, { timeout: 30_000, maxWait: 10_000 });
        return NextResponse.json(updated);
    } catch (e) {
        // A refusal the user can act on ("unlink it first"), not a server fault.
        if (e instanceof BillLinkError) return NextResponse.json({ error: e.message }, { status: 422 });
        return handleApiError(e, "Failed to update journal entry");
    }
}
