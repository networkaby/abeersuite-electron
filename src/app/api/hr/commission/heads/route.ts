import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { commissionHeadCreateSchema } from "@/shared/lib/schemas/hrSchema";
import { COMMISSION_HEAD_SELECT, toHeadDto } from "@/modules/hr/lib/commissionServer";

// POST /api/hr/commission/heads — create a head of the catalogue.
// hr:staff:edit — a head is pay, the same key that writes a salary revision.
export async function POST(req: Request) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const { data: body, error } = await validateRequest(req, commissionHeadCreateSchema);
    if (error) return error;
    try {
        const last = await prisma.commissionHead.aggregate({ _max: { sortOrder: true } });
        const row = await prisma.commissionHead.create({
            data: {
                name: body.name,
                description: body.description?.trim() || null,
                kind: body.kind,
                targetPaise: body.kind === "ABOVE_TARGET" || body.kind === "BONUS" ? body.targetPaise : 0,
                rateBp: body.kind === "PERCENT" || body.kind === "ABOVE_TARGET" ? body.rateBp : 0,
                slabsJson: body.kind === "SLABS" ? body.slabs : Prisma.DbNull,
                bonusPaise: body.kind === "BONUS" || body.kind === "MANUAL" ? body.bonusPaise : 0,
                unit: body.kind === "MANUAL" ? body.unit?.trim() || null : null,
                targetCount: body.kind === "MANUAL" ? body.targetCount : 0,
                perUnitPaise: body.kind === "MANUAL" ? body.perUnitPaise : 0,
                active: body.active,
                appliesTo: body.appliesTo,
                sortOrder: body.sortOrder ?? (last._max.sortOrder ?? 0) + 1,
                createdById: caller.id,
            },
            select: COMMISSION_HEAD_SELECT,
        });
        return NextResponse.json(toHeadDto(row));
    } catch (e) {
        return handleApiError(e, "Failed to create the head");
    }
}
