import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const createSchema = z.object({
    name:      z.string().trim().min(1).max(200),
    type:      z.enum(["ASSET", "LIABILITY", "INCOME", "EXPENSE"]).optional(), // ignored for sub-groups
    parentId:  z.number().int().positive().nullish(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
});

type FlatGroup = {
    id: number;
    name: string;
    type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
    parentId: number | null;
    sortOrder: number;
    isActive: boolean;
    totalBalance: number;
    _count: { children: number; accounts: number };
};

type GroupNode = FlatGroup & { children: GroupNode[] };

function buildTree(flat: FlatGroup[]): GroupNode[] {
    const map = new Map<number, GroupNode>();
    flat.forEach((g) => map.set(g.id, { ...g, children: [] }));
    const roots: GroupNode[] = [];
    flat.forEach((g) => {
        const node = map.get(g.id)!;
        if (g.parentId === null) {
            roots.push(node);
        } else {
            map.get(g.parentId)?.children.push(node);
        }
    });
    return roots;
}

// GET /api/finance/account-groups — returns full tree with totalBalance per group
export async function GET() {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    try {
        const [flat, sums] = await Promise.all([
            prisma.accountGroup.findMany({
                orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
                include: { _count: { select: { children: true, accounts: true } } },
            }),
            prisma.account.groupBy({
                by: ["groupId"],
                _sum: { balance: true },
                where: { groupId: { not: null } },
            }),
        ]);

        const balanceMap = new Map(
            sums.map((s) => [s.groupId!, Number(s._sum.balance ?? 0)])
        );

        const flatWithBalance: FlatGroup[] = (flat as Omit<FlatGroup, "totalBalance">[]).map(
            (g) => ({ ...g, totalBalance: balanceMap.get(g.id) ?? 0 })
        );

        return NextResponse.json(buildTree(flatWithBalance));
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to fetch account groups" }, { status: 500 });
    }
}

// POST /api/finance/account-groups — create a group
export async function POST(req: Request) {
    const { response } = await requirePermission("accountancy:view:org");
    if (response) return response;

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    // Sub-groups inherit type from parent; primary groups require an explicit type
    let resolvedType = body.type;
    if (body.parentId) {
        const parent = await prisma.accountGroup.findUnique({
            where: { id: body.parentId },
            select: { type: true },
        });
        if (!parent) return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
        resolvedType = parent.type as typeof resolvedType;
    } else if (!resolvedType) {
        return NextResponse.json({ error: "Type is required for primary groups" }, { status: 400 });
    }

    try {
        const group = await prisma.accountGroup.create({
            data: {
                name:      body.name,
                type:      resolvedType!,
                parentId:  body.parentId ?? null,
                sortOrder: body.sortOrder ?? 0,
            },
        });
        return NextResponse.json(group, { status: 201 });
    } catch (err) {
        console.error(err);
        return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
    }
}
