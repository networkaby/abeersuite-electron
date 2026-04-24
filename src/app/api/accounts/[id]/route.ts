import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

const accountUpdateSchema = z.object({
    name: z.string().trim().min(1, "Name is required").optional(),
    phone: z.string().trim().optional().or(z.literal("")),
    email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
    address: z.string().trim().optional().or(z.literal("")),
    companyReg: z.string().trim().optional().or(z.literal("")),
    taxId: z.string().trim().optional().or(z.literal("")),
    isActive: z.boolean().optional(),
    agreedToTerms: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const account = await prisma.account.findUnique({
            where: { id: Number(id) },
            include: {
                devices: {
                    include: {
                        tickets: {
                            include: {
                                ticketStatus: { select: { label: true, color: true } },
                                ticketPriority: { select: { label: true, color: true } },
                                pipeline: { select: { label: true, color: true } },
                            },
                            orderBy: { createdAt: "desc" },
                        },
                    },
                },
                asIndividual: {
                    where: { unlinkedAt: null },
                    include: { company: { select: { id: true, name: true, type: true, phone: true, companyReg: true } } },
                },
                asCompany: {
                    where: { unlinkedAt: null },
                    include: { individual: { select: { id: true, name: true, type: true, phone: true } } },
                },
            },
        });
        if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(account);
    } catch {
        return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 });
    }
}

export async function PUT(req: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const parsed = accountUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const body = parsed.data;
        const account = await prisma.account.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.phone !== undefined && { phone: body.phone || null }),
                ...(body.email !== undefined && { email: body.email || null }),
                ...(body.address !== undefined && { address: body.address || null }),
                ...(body.companyReg !== undefined && { companyReg: body.companyReg || null }),
                ...(body.taxId !== undefined && { taxId: body.taxId || null }),
                ...(body.isActive !== undefined && { isActive: body.isActive }),
                ...(body.agreedToTerms !== undefined && { agreedToTerms: body.agreedToTerms }),
            },
        });
        return NextResponse.json(account);
    } catch {
        return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const deviceCount = await prisma.device.count({ where: { accountId: Number(id) } });
        if (deviceCount > 0) {
            return NextResponse.json(
                { error: "Cannot delete an account with linked devices. Deactivate it instead." },
                { status: 409 }
            );
        }
        // Soft-delete: deactivate rather than hard delete to preserve history
        await prisma.account.update({ where: { id: Number(id) }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to deactivate account" }, { status: 500 });
    }
}
