import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";
import { isBalanced, nextRef } from "@/modules/tally/lib/balance";

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
    const { user, response } = await requireAuth();
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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to fetch journal entries" }, { status: 500 });
    }
}

// POST /api/finance/journal-entries
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    if (!isBalanced(body.lines)) {
        return NextResponse.json({ error: "Journal entry is not balanced — debits must equal credits" }, { status: 422 });
    }

    try {
        const entry = await prisma.$transaction(async (tx) => {
            const reference = await nextRef(tx, "journalEntry", "JE");
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
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to create journal entry" }, { status: 500 });
    }
}
