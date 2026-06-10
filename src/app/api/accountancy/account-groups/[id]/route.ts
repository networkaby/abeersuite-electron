import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    name:      z.string().trim().min(1).max(200).optional(),
    type:      z.enum(["ASSET", "LIABILITY", "INCOME", "EXPENSE"]).optional(),
    parentId:  z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive:  z.boolean().optional(),
});

async function isCircular(id: number, newParentId: number): Promise<boolean> {
    let cursor: number | null = newParentId;
    const visited = new Set<number>();
    while (cursor !== null) {
        if (cursor === id) return true;
        if (visited.has(cursor)) break;
        visited.add(cursor);
        const row: { parentId: number | null } | null = await prisma.accountGroup.findUnique({
            where: { id: cursor },
            select: { parentId: true },
        });
        cursor = row?.parentId ?? null;
    }
    return false;
}

// PATCH /api/accountancy/account-groups/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;
    const body = data;

    // Resolve type: sub-groups inherit from parent, primary groups may set directly
    let inheritedType: string | undefined;
    if (body.parentId !== undefined && body.parentId !== null) {
        if (body.parentId === id) return NextResponse.json({ error: "Group cannot be its own parent" }, { status: 400 });
        const parent = await prisma.accountGroup.findUnique({
            where: { id: body.parentId },
            select: { type: true },
        });
        if (!parent) return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
        if (await isCircular(id, body.parentId)) {
            return NextResponse.json({ error: "Circular parent reference" }, { status: 400 });
        }
        inheritedType = parent.type;
    } else if (body.parentId === null) {
        // Moving to primary — type from request body required if not already primary
        inheritedType = body.type;
    }

    try {
        const group = await prisma.accountGroup.update({
            where: { id },
            data: {
                ...(body.name      !== undefined ? { name:      body.name }                          : {}),
                ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder }                     : {}),
                ...(body.isActive  !== undefined ? { isActive:  body.isActive }                      : {}),
                ...(body.parentId  !== undefined ? { parentId:  body.parentId }                      : {}),
                // type: use inherited (from new parent) if parentId changed, else body.type for primaries
                ...(inheritedType  !== undefined ? { type: inheritedType as "ASSET"|"LIABILITY"|"INCOME"|"EXPENSE" }
                  : body.type     !== undefined ? { type: body.type }
                  : {}),
            },
        });
        return NextResponse.json(group);
    } catch (e) {
        return handleApiError(e, "Failed to update group");
    }
}

// DELETE /api/accountancy/account-groups/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id, error } = await parseIdParam(params);
    if (error) return error;

    const group = await prisma.accountGroup.findUnique({
        where: { id },
        include: { _count: { select: { children: true, accounts: true } } },
    });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    if (group._count.children > 0) {
        return NextResponse.json({ error: "Cannot delete group with sub-groups" }, { status: 409 });
    }
    if (group._count.accounts > 0) {
        return NextResponse.json({ error: "Cannot delete group that has accounts" }, { status: 409 });
    }

    await prisma.accountGroup.delete({ where: { id } });
    return NextResponse.json({ ok: true });
}
