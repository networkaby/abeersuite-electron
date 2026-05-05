import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const createSchema = z.object({
    name:        z.string().trim().min(1).max(200),
    groupId:     z.number().int().positive().nullish(),
    code:        z.string().trim().max(32).nullish(),
    description: z.string().trim().max(1000).nullish(),
    type:        z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]).optional(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
    sortOrder:   z.number().int().min(0).max(9999).optional(),
});

// GET /api/finance/ledgers — pure GL ledger accounts (no customer/company identity)
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const groupId    = searchParams.get("groupId");
    const activeOnly = searchParams.get("activeOnly") !== "false";

    try {
        const ledgers = await prisma.account.findMany({
            where: {
                customerId: null,
                companyId:  null,
                ...(activeOnly ? { isActive: true } : {}),
                ...(groupId ? { groupId: Number(groupId) } : {}),
            },
            orderBy: [{ groupId: "asc" }, { name: "asc" }],
            include: {
                group: { select: { id: true, name: true, type: true } },
                _count: { select: { lines: true } },
            },
        });
        return NextResponse.json(ledgers);
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to fetch ledgers" }, { status: 500 });
    }
}

// POST /api/finance/ledgers — create a new ledger account
export async function POST(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    try {
        const account = await prisma.account.create({
            data: {
                name:          body.name,
                groupId:       body.groupId ?? null,
                code:          body.code ?? null,
                description:   body.description ?? null,
                type:          body.type ?? null,
                normalBalance: body.normalBalance ?? null,
            },
        });
        return NextResponse.json(account, { status: 201 });
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
            return NextResponse.json({ error: `Code "${body.code}" already exists` }, { status: 409 });
        }
        console.error(err);
        return NextResponse.json({ error: "Failed to create ledger" }, { status: 500 });
    }
}
