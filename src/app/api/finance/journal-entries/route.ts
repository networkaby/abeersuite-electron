import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { isBalanced, nextRefFromSeries } from "@/modules/accountancy/lib/balance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const lineSchema = z.object({
    accountId: z.number().int().positive(),
    type: z.enum(["DEBIT", "CREDIT"]),
    amount: z.number().positive(),
    description: z.string().trim().optional(),
});

const createSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    description: z.string().trim().min(1),
    lines: z.array(lineSchema).min(2, "At least 2 lines required"),
});

// GET /api/finance/journal-entries
export async function GET(req: Request) {
    const { user, response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const includeDeletedParam = searchParams.get("includeDeleted") === "1";
    const canSeeDeleted = user!.permissions.includes("admin:bypass") || user!.permissions.includes("finance:journal:delete");
    const includeDeleted = includeDeletedParam && canSeeDeleted;

    try {
        const entries = await prisma.journalEntry.findMany({
            where: {
                ...(status ? { status: status as "DRAFT" | "POSTED" | "CANCELLED" } : {}),
                ...(includeDeleted ? {} : { deletedAt: null }),
                ...(from || to ? {
                    date: {
                        ...(from ? { gte: new Date(from) } : {}),
                        ...(to ? { lte: new Date(to) } : {}),
                    },
                } : {}),
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            include: {
                createdBy: { select: { id: true, name: true } },
                _count: { select: { lines: true } },
                lines: { select: { type: true, amount: true } },
            },
        });

        const result = entries.map((e) => {
            const totalDebit = e.lines
                .filter((l) => l.type === "DEBIT")
                .reduce((s, l) => s + Number(l.amount), 0);
            return { ...e, lines: undefined, totalDebit };
        });

        return NextResponse.json(result);
    } catch (e) {
        return handleApiError(e, "Failed to fetch journal entries");
    }
}

// POST /api/finance/journal-entries
export async function POST(req: Request) {
    const { user, response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Journal entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        const entry = await prisma.$transaction(async (tx) => {
            const reference = await nextRefFromSeries(tx, "JOURNAL", user!.id);
            return tx.journalEntry.create({
                data: {
                    date: new Date(body.date),
                    reference,
                    description: body.description,
                    createdById: user!.id,
                    lines: {
                        create: body.lines.map((l) => ({
                            accountId: l.accountId,
                            type: l.type,
                            amount: l.amount,
                            description: l.description ?? null,
                        })),
                    },
                },
                include: { lines: true },
            });
        });
        return NextResponse.json(entry, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create journal entry");
    }
}
