import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, balanceDelta, toNumber } from "@/modules/accountancy/lib/balance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const entry = await prisma.journalEntry.findUnique({
        where: { id: Number(id) },
        include: {
            createdBy: { select: { id: true, name: true } },
            lines: {
                include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } },
                orderBy: [{ type: "asc" }, { id: "asc" }],
            },
        },
    });
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(entry);
}

// PATCH /api/accountancy/journal-entries/[id]
//
//   • DRAFT  → swap lines + update header. No GL impact.
//   • POSTED → atomic reversal of old line impact + re-apply of new impact,
//              mirroring the cancel route's reversal logic minus the
//              counter-entry/status-flip. Reference + POSTED status stay.
//   • CANCELLED / deleted → 409.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id } = await params;
    const entryId = Number(id);
    const existing = await prisma.journalEntry.findUnique({
        where:   { id: entryId },
        include: { lines: { include: { account: { select: { normalBalance: true } } } } },
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

    try {
        const updated = await prisma.$transaction(async (tx) => {
            // ── POSTED: reverse the old GL impact first ─────────────────
            if (existing.status === "POSTED" && body.lines) {
                for (const line of existing.lines) {
                    const delta = balanceDelta(
                        line.account.normalBalance!,
                        line.type,
                        toNumber(line.amount),
                    );
                    await tx.account.update({
                        where: { id: line.accountId },
                        data:  { balance: { decrement: delta } },
                    });
                }
            }

            // Swap lines if provided
            if (body.lines) {
                await tx.journalLine.deleteMany({ where: { journalEntryId: entryId } });
                await tx.journalLine.createMany({
                    data: body.lines.map((l) => ({
                        journalEntryId: entryId,
                        accountId:      l.accountId,
                        type:           l.type,
                        amount:         l.amount,
                        description:    l.description ?? null,
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

            return tx.journalEntry.update({
                where: { id: entryId },
                data: {
                    ...(body.date ? { date: new Date(body.date) } : {}),
                    ...(body.description ? { description: body.description } : {}),
                },
                include: {
                    lines: {
                        include: { account: { select: { id: true, code: true, name: true, normalBalance: true } } },
                    },
                },
            });
        });
        return NextResponse.json(updated);
    } catch (e) {
        return handleApiError(e, "Failed to update journal entry");
    }
}
