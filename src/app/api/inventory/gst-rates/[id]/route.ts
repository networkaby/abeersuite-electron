import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { revalidateTag } from "next/cache";
import { GST_RATES_TAG } from "../route";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";

const updateSchema = z.object({
    rate:        z.number().min(0).max(100).optional(),
    label:       z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().nullable().optional(),
    isActive:    z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const row = await prisma.gstRate.update({
            where: { id },
            data: {
                ...(data.rate        !== undefined ? { rate: data.rate }               : {}),
                ...(data.label       !== undefined ? { label: data.label }             : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.isActive    !== undefined ? { isActive: data.isActive }       : {}),
            },
        });
        revalidateTag(GST_RATES_TAG, { expire: 0 });
        return NextResponse.json(row);
    } catch (e) {
        const conflict = prismaUniqueError(e, "Label already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update GST rate");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MANAGE);
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        await prisma.gstRate.delete({ where: { id } });
        revalidateTag(GST_RATES_TAG, { expire: 0 });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete GST rate");
    }
}
