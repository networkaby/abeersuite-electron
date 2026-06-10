import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";
import { pickDefined } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const updateSchema = z.object({
    name:        z.string().trim().min(1).max(200).optional(),
    groupId:     z.number().int().positive().nullable().optional(),
    code:        z.string().trim().max(32).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isActive:    z.boolean().optional(),
});

// PATCH /api/accountancy/ledgers/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.ACCOUNTANCY_VIEW_ORG);
    if (response) return response;

    const { id, error: idError } = await parseIdParam(params);
    if (idError) return idError;

    const { data, error } = await validateRequest(req, updateSchema);

    if (error) return error;
    const body = data;

    if (body.groupId) {
        const group = await prisma.accountGroup.findUnique({ where: { id: body.groupId } });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
    }

    try {
        const account = await prisma.account.update({
            where: { id },
            data: pickDefined({
                name: body.name,
                groupId: body.groupId,
                code: body.code,
                description: body.description,
                isActive: body.isActive,
            }),
            include: { group: { select: { id: true, name: true } } },
        });
        return NextResponse.json(account);
    } catch (e) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: `Code "${body.code}" already exists` }, { status: 409 });
        }
        return handleApiError(e, "Failed to update ledger");
    }
}
