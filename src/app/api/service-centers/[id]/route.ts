import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";

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
    const { response } = await requirePermission("warranty:convert");
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = serviceCenterSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid service center payload" }, { status: 400 });
        }
        const body = parsed.data;
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
    } catch {
        return NextResponse.json({ error: "Failed to update service center" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("warranty:convert");
    if (response) return response;
    try {
        const { id } = await params;
        const ticketCount = await prisma.ticket.count({ where: { serviceCenterId: Number(id) } });
        if (ticketCount > 0) {
            return NextResponse.json({ error: "Cannot delete a service center that is linked to tickets" }, { status: 409 });
        }
        await prisma.serviceCenter.delete({ where: { id: Number(id) } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete service center" }, { status: 500 });
    }
}
