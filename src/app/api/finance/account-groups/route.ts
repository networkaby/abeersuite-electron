import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { loadGroupRolledUpBalances } from "@/modules/accountancy/lib/effectiveBalance";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

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
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    try {
        const flat = await prisma.accountGroup.findMany({
            orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
            include: { _count: { select: { children: true, accounts: true } } },
        });

        // totalBalance per group is the rolled-up effective balance (running
        // + opening) of every account under it. The shared helper folds in
        // opening so this list reconciles with the Balance Sheet drilldowns.
        const balanceMap = await loadGroupRolledUpBalances(flat.map((g) => g.id));

        const flatWithBalance: FlatGroup[] = (flat as Omit<FlatGroup, "totalBalance">[]).map(
            (g) => ({ ...g, totalBalance: balanceMap.get(g.id) ?? 0 })
        );

        return NextResponse.json(buildTree(flatWithBalance));
    } catch (e) {
        return handleApiError(e, "Failed to fetch account groups");
    }
}

// POST /api/finance/account-groups — create a group
export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { data, error } = await validateRequest(req, createSchema);

    if (error) return error;
    const body = data;

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
    } catch (e) {
        return handleApiError(e, "Failed to create group");
    }
}
