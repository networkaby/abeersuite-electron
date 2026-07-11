import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { parseIdParam } from "@/shared/lib/api";

const updateSchema = z.object({
    key:        z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/).optional(),
    name:       z.string().min(1).max(100).optional(),
    categoryId: z.number().int().positive().nullish(),
    sortOrder:  z.number().int().min(0).optional(),
    isActive:   z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_EDIT);
    if (response) return response;
    try {
        const { id, error: idError } = await parseIdParam(params);
        if (idError) return idError;
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const row = await prisma.invAttributeMaster.update({
            where: { id },
            data: {
                ...(data.key        !== undefined ? { key:        data.key }        : {}),
                ...(data.name       !== undefined ? { name:       data.name }       : {}),
                ...(data.categoryId !== undefined ? { categoryId: data.categoryId ?? null } : {}),
                ...(data.sortOrder  !== undefined ? { sortOrder:  data.sortOrder }  : {}),
                ...(data.isActive   !== undefined ? { isActive:   data.isActive }   : {}),
            },
            include: { category: { select: { id: true, name: true } } },
        });
        return NextResponse.json(row);
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: "Key already exists for this category" }, { status: 409 });
        }
        return handleApiError(e, "Failed to update attribute master");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_DELETE);
    if (response) return response;
    try {
        const { id, error } = await parseIdParam(params);
        if (error) return error;
        await prisma.invAttributeMaster.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete attribute master");
    }
}
