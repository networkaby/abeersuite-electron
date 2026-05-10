import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";
import { z } from "zod";

const updateSchema = z.object({
    name: z.string().trim().min(1).optional(),
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
    const person = await prisma.person.findUnique({
        where: { id: Number(id) },
        include: {
            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }] },
            account: {
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
                        select: {
                            id: true,
                            name: true,
                            phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                            account: { select: { id: true } },
                        },
                    },
                },
            },
        },
    });

    if (!person || !person.isActive) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
        ...person,
        // Backward-compat scalar accessors from the primary contact rows.
        phone: person.phones[0]?.phone ?? null,
        email: person.emails[0]?.email ?? null,
        devices: person.account?.devices ?? [],
        companies: person.companies.map(link => ({
            ...link,
            company: {
                ...link.company,
                phone: link.company.phones[0]?.phone ?? null,
            },
        })),
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
        const person = await prisma.person.update({
            where: { id: Number(id) },
            data: {
                ...(body.name !== undefined && { name: body.name }),
                ...(body.address !== undefined && { address: body.address }),
                ...(body.agreedToTerms !== undefined && {
                    agreedToTerms: body.agreedToTerms,
                    agreedAt: body.agreedToTerms ? new Date() : null,
                }),
            },
        });
        return NextResponse.json(person);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update person" }, { status: 500 });
    }
}

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const hasDevices = await prisma.device.count({ where: { account: { personId: Number(id) } } });
    if (hasDevices > 0) {
        return NextResponse.json({ error: "Cannot deactivate a person with devices" }, { status: 409 });
    }

    const person = await prisma.person.update({
        where: { id: Number(id) },
        data: { isActive: false },
    });
    return NextResponse.json(person);
}
