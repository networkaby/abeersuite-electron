import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { parsePagination } from "@/shared/lib/api";
import { z } from "zod";

const createSchema = z.object({
    name:        z.string().trim().min(1).max(200),
    groupId:     z.number().int().positive().nullish(),
    code:        z.string().trim().max(32).nullish(),
    description: z.string().trim().max(1000).nullish(),
    normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
    sortOrder:   z.number().int().min(0).max(9999).optional(),
});

// GET /api/finance/ledgers
// Without groupId → pure GL accounts (no person/company), flat array (existing behaviour)
// With groupId    → ALL account types in that group, paginated: { items, total }
export async function GET(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const groupId    = searchParams.get("groupId");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const search     = searchParams.get("search")?.trim() ?? "";
    const { take: limit, page } = parsePagination(searchParams, { defaultLimit: 20, maxLimit: 100 });

    try {
        // ── Mode B: paginated drill-down for a specific group ──────────────────
        if (groupId) {
            const where = {
                groupId: Number(groupId),
                ...(activeOnly ? { isActive: true } : {}),
                ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
            };
            const [items, total] = await prisma.$transaction([
                prisma.account.findMany({
                    where,
                    orderBy: { name: "asc" },
                    skip: (page - 1) * limit,
                    take: limit,
                    include: {
                        group: { select: { id: true, name: true, type: true } },
                        _count: { select: { lines: true } },
                    },
                }),
                prisma.account.count({ where }),
            ]);
            return NextResponse.json({ items, total });
        }

        // ── Mode A: pure GL accounts, flat array (original behaviour) ──────────
        const ledgers = await prisma.account.findMany({
            where: {
                personId: null,
                companyId:  null,
                ...(activeOnly ? { isActive: true } : {}),
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
    const { response } = await requirePermission("accountancy:view:org");
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
