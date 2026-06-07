import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";

const serviceCenterSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().min(1, "Phone is required"),
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
    address: z.string().trim().optional().or(z.literal("")),
});

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // TODO(rbac): was requirePermission(WARRANTY_CONVERT) — open to all staff for now.
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const { data, error } = await validateRequest(req, serviceCenterSchema);
        if (error) return error;
        const body = data;
        const serviceCenter = await prisma.serviceCenter.update({
            where: { id: Number(id) },
            data: {
                name: body.name,
                phone: body.phone,
                email: body.email || null,
                address: body.address || null,
            },
        });
        return NextResponse.json(serviceCenter);
    } catch (e) {
        return handleApiError(e, "Failed to update service center");
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // TODO(rbac): was requirePermission(WARRANTY_CONVERT) — open to all staff for now.
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const ticketCount = await prisma.ticket.count({ where: { serviceCenterId: Number(id) } });
        if (ticketCount > 0) {
            return NextResponse.json({ error: "Cannot delete a service center that is linked to tickets" }, { status: 409 });
        }
        await prisma.serviceCenter.delete({ where: { id: Number(id) } });
        return NextResponse.json({ success: true });
    } catch (e) {
        return handleApiError(e, "Failed to delete service center");
    }
}
