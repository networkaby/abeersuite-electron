import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced } from "@/modules/accountancy/lib/balance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

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

// GET /api/finance/journal-entries/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
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

// PATCH /api/finance/journal-entries/[id] — update DRAFT only
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { id } = await params;
    const existing = await prisma.journalEntry.findUnique({ where: { id: Number(id) } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.status !== "DRAFT") {
        return NextResponse.json({ error: "Only DRAFT entries can be edited" }, { status: 409 });
    }

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;
    const body = data;

    if (body.lines && !isBalanced(body.lines)) {
        return NextResponse.json({ error: "Journal entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        const updated = await prisma.$transaction(async (tx) => {
            if (body.lines) {
                await tx.journalLine.deleteMany({ where: { journalEntryId: Number(id) } });
                await tx.journalLine.createMany({
                    data: body.lines.map((l) => ({
                        journalEntryId: Number(id),
                        accountId: l.accountId,
                        type: l.type,
                        amount: l.amount,
                        description: l.description ?? null,
                    })),
                });
            }
            return tx.journalEntry.update({
                where: { id: Number(id) },
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
