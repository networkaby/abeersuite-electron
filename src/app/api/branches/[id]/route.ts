import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";

const branchTextField = z.string().trim().optional().nullable();

const updateSchema = z.object({
    id:       z.string().trim().min(1).regex(/^[A-Z0-9-]+$/, "ID must be uppercase letters, numbers and hyphens only").optional(),
    name:     z.string().trim().min(1).optional(),
    address:  branchTextField,
    phone:    branchTextField,
    addressLine1: branchTextField,
    addressLine2: branchTextField,
    city:         branchTextField,
    state:        branchTextField,
    pinCode:      branchTextField,
    country:      branchTextField,
    email:        branchTextField,
    gstin:        z.string().trim().max(15).optional().nullable(),
    gstStateCode: z.string().trim().max(2).optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.BRANCHES_EDIT, PERMISSIONS.BRANCHES_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, updateSchema);
        if (error) return error;

        const payload = { ...data };

        // GSTIN ↔ state guard, but only when the PATCH touched any of those
        // three fields. Otherwise we'd reject "rename only" PATCHes whose
        // existing row already has slightly-off state-name text.
        if (data.gstin !== undefined || data.gstStateCode !== undefined || data.state !== undefined) {
            const current = await prisma.branch.findUnique({ where: { id } });
            const integrity = normaliseGstinState({
                gstin:        data.gstin        ?? current?.gstin        ?? "",
                gstStateCode: data.gstStateCode ?? current?.gstStateCode ?? "",
                state:        data.state        ?? current?.state        ?? "",
            });
            if (!integrity.ok) {
                return NextResponse.json({ error: integrity.error }, { status: 400 });
            }
            payload.gstin        = integrity.value.gstin        || null;
            payload.gstStateCode = integrity.value.gstStateCode || null;
            if (data.state !== undefined) {
                payload.state = integrity.value.state || null;
            }
        }

        const branch = await prisma.branch.update({ where: { id }, data: payload });
        return NextResponse.json(branch);
    } catch (e) {
        return handleApiError(e, "Failed to update branch");
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requireAnyPermission(PERMISSIONS.BRANCHES_DELETE, PERMISSIONS.BRANCHES_MANAGE);
    if (response) return response;
    try {
        const { id } = await params;
        const branch = await prisma.branch.findUnique({
            where: { id },
            include: { _count: { select: { positions: true, departments: true } } },
        });
        if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
        if (branch._count.positions > 0 || branch._count.departments > 0) {
            return NextResponse.json({ error: "Cannot delete branch with assigned positions or departments. Reassign first." }, { status: 400 });
        }
        await prisma.branch.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete branch");
    }
}
