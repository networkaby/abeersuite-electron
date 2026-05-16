import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invProductGroupUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const groupInclude = {
    parent:  { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
} as const;

/** Walk parent chain from candidateParentId looking for id. Returns true if a cycle would form. */
async function wouldFormCycle(id: number, candidateParentId: number): Promise<boolean> {
    if (id === candidateParentId) return true;
    let next: number | null = candidateParentId;
    const seen = new Set<number>();
    for (let i = 0; i < 16 && next != null; i++) {
        if (seen.has(next)) return false; // pre-existing cycle, but not caused by us
        seen.add(next);
        if (next === id) return true;
        const row: { parentId: number | null } | null = await prisma.invProductGroup.findUnique({
            where: { id: next },
            select: { parentId: true },
        });
        next = row?.parentId ?? null;
    }
    return false;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const { data, error } = await validateRequest(req, invProductGroupUpdateSchema);
        if (error) return error;
        const b = data;
        if (b.parentId != null) {
            if (b.parentId === id) return NextResponse.json({ error: "A group cannot be its own parent" }, { status: 400 });
            const parent = await prisma.invProductGroup.findUnique({ where: { id: b.parentId } });
            if (!parent) return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
            if (await wouldFormCycle(id, b.parentId)) {
                return NextResponse.json({ error: "Parent change would form a cycle" }, { status: 400 });
            }
        }
        if (b.gstRateId != null) {
            const gr = await prisma.gstRate.findUnique({ where: { id: b.gstRateId } });
            if (!gr) return NextResponse.json({ error: "GST rate not found" }, { status: 400 });
        }
        const row = await prisma.invProductGroup.update({
            where: { id },
            data: {
                ...(b.name       !== undefined ? { name: b.name } : {}),
                ...(b.isActive   !== undefined ? { isActive: b.isActive } : {}),
                ...(b.parentId   !== undefined ? { parentId:   b.parentId   } : {}),
                ...(b.gstRateId  !== undefined ? { gstRateId:  b.gstRateId  } : {}),
                ...(b.hsnCode    !== undefined ? { hsnCode:    b.hsnCode    } : {}),
                ...(b.taxability !== undefined ? { taxability: b.taxability } : {}),
            },
            include: groupInclude,
        });
        return NextResponse.json(row);
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Group name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update product group");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const n = await prisma.invProduct.count({ where: { groupId: id } });
        if (n > 0) {
            return NextResponse.json({ error: "Cannot delete group while products reference it." }, { status: 400 });
        }
        const childCount = await prisma.invProductGroup.count({ where: { parentId: id } });
        if (childCount > 0) {
            return NextResponse.json({ error: "Cannot delete group while child groups reference it as parent." }, { status: 400 });
        }
        await prisma.invProductGroup.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete product group");
    }
}
