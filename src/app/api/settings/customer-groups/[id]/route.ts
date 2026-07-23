import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";

const updateSchema = z.object({
    name:     z.string().trim().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
});

// PATCH /api/settings/customer-groups/[id] — rename / (de)activate a group.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
        }
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;
        const row = await prisma.customerGroup.update({ where: { id }, data });
        return NextResponse.json(row);
    } catch (e) {
        const conflict = prismaUniqueError(e, "A group with that name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to update customer group");
    }
}

// DELETE /api/settings/customer-groups/[id] — remove a group. It is only a
// marketing label, so members are detached (customerGroupId → null) and the
// row deleted in one transaction; deactivating via PATCH is the soft option.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isInteger(id) || id <= 0) {
            return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
        }
        await prisma.$transaction([
            prisma.person.updateMany({ where: { customerGroupId: id }, data: { customerGroupId: null } }),
            prisma.company.updateMany({ where: { customerGroupId: id }, data: { customerGroupId: null } }),
            prisma.customerGroup.delete({ where: { id } }),
        ]);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete customer group");
    }
}
