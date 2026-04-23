import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const customerSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    phone: z.string().trim().min(1, "Phone is required"),
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const customer = await prisma.customer.findUnique({
            where: { id: Number(id) },
            include: { devices: { include: { tickets: true } } },
        });
        if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(customer);
    } catch {
        return NextResponse.json({ error: "Failed to fetch customer" }, { status: 500 });
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = customerSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid customer payload" }, { status: 400 });
        }
        const body = parsed.data;
        const customer = await prisma.customer.update({
            where: { id: Number(id) },
            data: {
                name: body.name,
                phone: body.phone,
                email: body.email || null,
            },
        });
        return NextResponse.json(customer);
    } catch {
        return NextResponse.json({ error: "Failed to update customer" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const deviceCount = await prisma.device.count({ where: { customerId: Number(id) } });
        if (deviceCount > 0) {
            return NextResponse.json(
                { error: "Cannot delete a customer with linked devices or tickets" },
                { status: 409 }
            );
        }
        await prisma.customer.delete({
            where: { id: Number(id) },
        });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete customer" }, { status: 500 });
    }
}
