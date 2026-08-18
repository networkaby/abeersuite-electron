import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolvePositionDepartmentId } from "@/shared/lib/org/positionDepartment";
import {
    flattenPositionRoles,
    POSITION_INCLUDE,
    POSITION_PICKER_SELECT,
    toPositionPickerOption,
} from "@/shared/lib/org/positionIncludes";

const createSchema = z.object({
    id:               z.string().trim().min(1, "ID is required").toUpperCase(),
    title:            z.string().trim().min(1, "Title is required"),
    branchId:         z.string().trim().optional().nullable(),
    parentPositionId: z.string().trim().optional().nullable(),
    roleTemplateIds:  z.array(z.string().trim().min(1)).optional().default([]),
});

export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        // `?picker=1` — the light list behind every position filter dropdown,
        // bundled with the caller's own positions because the six screens that
        // use it always need both. The browser caches this (see
        // usePositionPicker), so a warm tab never asks again.
        if (new URL(req.url).searchParams.get("picker")) {
            const [rows, mine] = await Promise.all([
                prisma.position.findMany({
                    orderBy: { title: "asc" },
                    select:  POSITION_PICKER_SELECT,
                }),
                prisma.userPosition.findMany({
                    where:  { userId: user.id },
                    select: { positionId: true },
                }),
            ]);
            return NextResponse.json({
                positions:     rows.map(toPositionPickerOption),
                myPositionIds: mine.map((p) => p.positionId),
                computedAt:    new Date().toISOString(),
            });
        }

        const positions = await prisma.position.findMany({
            orderBy: [{ branchId: "asc" }, { departmentId: "asc" }, { title: "asc" }],
            include: POSITION_INCLUDE,
        });
        return NextResponse.json(positions.map(flattenPositionRoles));
    } catch (e) {
        return handleApiError(e, "Failed to fetch positions");
    }
}

export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.POSITIONS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, title, branchId, parentPositionId, roleTemplateIds } = data;
        const existing = await prisma.position.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Position ID already exists" }, { status: 409 });

        const resolvedDepartmentId = await resolvePositionDepartmentId(roleTemplateIds);
        const position = await prisma.$transaction(async (tx) => {
            const created = await tx.position.create({
                data: {
                    id,
                    title,
                    branchId: branchId ?? null,
                    departmentId: resolvedDepartmentId,
                    parentPositionId: parentPositionId ?? null,
                },
            });
            if (roleTemplateIds.length > 0) {
                await tx.positionRole.createMany({
                    data: roleTemplateIds.map((roleId) => ({ positionId: id, roleId })),
                    skipDuplicates: true,
                });
            }
            return tx.position.findUniqueOrThrow({
                where:   { id: created.id },
                include: POSITION_INCLUDE,
            });
        });

        return NextResponse.json(flattenPositionRoles(position), { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create position");
    }
}
