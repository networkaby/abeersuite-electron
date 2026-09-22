import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { checkCommissionTerms, commissionHeadPatchSchema } from "@/shared/lib/schemas/hrSchema";
import { parseSlabs } from "@/shared/lib/hr/commissionScheme";
import { toHeadDto } from "@/modules/hr/lib/commissionServer";

// PATCH  /api/hr/commission/heads/[id] — edit a head (any subset of fields; the
//        merged terms are checked as a whole, so a kind change cannot leave a
//        rate-less share head behind).
// DELETE /api/hr/commission/heads/[id] — remove it; the overrides on it go too.
//        Months already paid keep what payroll froze.

const SELECT = { id: true, name: true, description: true, kind: true, targetPaise: true, rateBp: true, slabsJson: true, bonusPaise: true, active: true, appliesTo: true, sortOrder: true };

const idOf = async (params: Promise<{ id: string }>) => {
    const id = Number((await params).id);
    return Number.isInteger(id) && id > 0 ? id : null;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const id = await idOf(params);
    if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: body, error } = await validateRequest(req, commissionHeadPatchSchema);
    if (error) return error;
    try {
        const cur = await prisma.commissionHead.findUnique({ where: { id }, select: SELECT });
        if (!cur) return NextResponse.json({ error: "Head not found" }, { status: 404 });
        const kind = body.kind ?? (cur.kind as "PERCENT" | "ABOVE_TARGET" | "SLABS" | "BONUS");
        const merged = {
            kind,
            targetPaise: body.targetPaise ?? cur.targetPaise,
            rateBp: body.rateBp ?? cur.rateBp,
            slabs: body.slabs ?? parseSlabs(cur.slabsJson),
            bonusPaise: body.bonusPaise ?? cur.bonusPaise,
        };
        const bad = checkCommissionTerms(merged);
        if (bad) return NextResponse.json({ error: bad }, { status: 400 });
        const row = await prisma.commissionHead.update({
            where: { id },
            data: {
                ...(body.name !== undefined ? { name: body.name } : {}),
                ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
                kind,
                targetPaise: kind === "ABOVE_TARGET" || kind === "BONUS" ? merged.targetPaise : 0,
                rateBp: kind === "PERCENT" || kind === "ABOVE_TARGET" ? merged.rateBp : 0,
                slabsJson: kind === "SLABS" ? merged.slabs : Prisma.DbNull,
                bonusPaise: kind === "BONUS" ? merged.bonusPaise : 0,
                ...(body.active !== undefined ? { active: body.active } : {}),
                ...(body.appliesTo !== undefined ? { appliesTo: body.appliesTo } : {}),
                ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            },
            select: SELECT,
        });
        return NextResponse.json(toHeadDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to edit the head");
    }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const id = await idOf(params);
    if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    try {
        const { count } = await prisma.commissionHead.deleteMany({ where: { id } });
        if (!count) return NextResponse.json({ error: "Head not found" }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete the head");
    }
}
