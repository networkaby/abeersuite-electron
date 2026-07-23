import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/shared/lib/auth/permissions";
import { invProductGroupUpdateSchema, TAX_CLASSIFICATION_FIELDS } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { regenerateProductNamesSafe } from "@/modules/inventory/lib/regenerateNames";

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
    // A body touching ONLY GST fields (the Tax Classification page's inline
    // edits) is allowed by the narrower compliance:tax:edit; anything that also
    // touches other group fields (name, parent, active) needs inventory:masters:edit
    // — which also covers tax-only bodies (full edit implies tax edit).
    let peekedBody: Record<string, unknown> = {};
    try { peekedBody = await req.clone().json(); } catch { /* invalid JSON — validateRequest reports it below */ }
    const bodyKeys = Object.keys(peekedBody);
    const taxFieldSet: readonly string[] = TAX_CLASSIFICATION_FIELDS;
    const isTaxOnly = bodyKeys.length > 0 && bodyKeys.every((k) => taxFieldSet.includes(k));

    const { response } = isTaxOnly
        ? await requireAnyPermission(PERMISSIONS.COMPLIANCE_TAX_EDIT, PERMISSIONS.INVENTORY_MASTERS_EDIT)
        : await requirePermission(PERMISSIONS.INVENTORY_MASTERS_EDIT);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
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
            data: pickDefined({
                name: b.name,
                isActive: b.isActive,
                parentId: b.parentId,
                gstRateId: b.gstRateId,
                hsnCode: b.hsnCode,
                taxability: b.taxability,
                // Movement-band overrides (null = inherit up the chain).
                slowAfterDays: b.slowAfterDays,
                nonMovingAfterDays: b.nonMovingAfterDays,
                deadAfterDays: b.deadAfterDays,
            }),
            include: groupInclude,
        });
        // A renamed group changes the generated name of every product using it.
        if (b.name !== undefined) await regenerateProductNamesSafe({ groupId: id });
        return NextResponse.json(row);
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Group name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update product group");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_DELETE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
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
