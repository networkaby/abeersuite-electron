import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    address: z.string().trim().optional().nullable(),
    agreedToTerms: z.boolean().optional(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const customer = await prisma.customer.findUnique({
        where: { id: Number(id) },
        include: {
            account: {
                select: { id: true },
                include: {
                    devices: {
                        include: {
                            tickets: {
                                orderBy: { createdAt: "desc" },
                                include: {
                                    ticketStatus: { select: { label: true, color: true } },
                                },
                            },
                        },
                    },
                },
            },
            companies: {
                where: { unlinkedAt: null },
                include: {
                    company: {
                        select: { id: true, name: true, phone: true, account: { select: { id: true } } },
                    },
                },
            },
        },
    });

    if (!customer || !customer.isActive) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Normalise: expose devices at the top level for client compatibility
    return NextResponse.json({
        ...customer,
        devices: customer.account?.devices ?? [],
    });
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const body = parsed.data;

    try {
        const customer = await prisma.customer.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.phone !== undefined && { phone: body.phone }),
                ...(body.email !== undefined && { email: body.email || null }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.agreedToTerms !== undefined && {
                    agreedToTerms: body.agreedToTerms,
                    agreedAt: body.agreedToTerms ? new Date() : null,
                }),
            },
        });
        return NextResponse.json(customer);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update customer" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const hasDevices = await prisma.device.count({ where: { account: { customerId: Number(id) } } });
    if (hasDevices > 0) {
        return NextResponse.json({ error: "Cannot deactivate a customer with devices" }, { status: 409 });
    }

    const customer = await prisma.customer.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(customer);
}
