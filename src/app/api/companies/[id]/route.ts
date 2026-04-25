import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    address: z.string().trim().optional().nullable(),
    companyReg: z.string().trim().optional().nullable(),
    taxId: z.string().trim().optional().nullable(),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const company = await prisma.company.findUnique({
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
            customers: {
                where: { unlinkedAt: null },
                include: {
                    customer: {
                        select: { id: true, name: true, phone: true },
                    },
                },
            },
        },
    });

    if (!company || !company.isActive) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Normalise: expose devices at the top level for client compatibility
    return NextResponse.json({
        ...company,
        devices: company.account?.devices ?? [],
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
        const company = await prisma.company.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.phone !== undefined && { phone: body.phone }),
                ...(body.email !== undefined && { email: body.email || null }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.companyReg !== undefined && { companyReg: body.companyReg }),
                ...(body.taxId !== undefined && { taxId: body.taxId }),
            },
        });
        return NextResponse.json(company);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const hasDevices = await prisma.device.count({ where: { account: { companyId: Number(id) } } });
    if (hasDevices > 0) {
        return NextResponse.json({ error: "Cannot deactivate a company with devices" }, { status: 409 });
    }

    const company = await prisma.company.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(company);
}
