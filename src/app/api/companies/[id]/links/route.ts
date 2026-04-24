import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { z } from "zod";

// GET /api/companies/[id]/links — list linked customers
export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const links = await prisma.customerCompany.findMany({
        where: { companyId: Number(id), unlinkedAt: null },
        include: { customer: { select: { id: true, name: true, phone: true, email: true } } },
        orderBy: { linkedAt: "desc" },
    });
    return NextResponse.json(links);
}

const linkSchema = z.object({
    customerId: z.coerce.number().int().positive(),
    role: z.string().trim().optional().or(z.literal("")),
});

// POST /api/companies/[id]/links — link a customer
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const parsed = linkSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const { customerId, role } = parsed.data;
    const companyId = Number(id);

    // Reactivate if previously unlinked
    const existing = await prisma.customerCompany.findFirst({
        where: { customerId, companyId },
    });

    if (existing) {
        if (existing.unlinkedAt === null) {
            return NextResponse.json({ error: "Already linked" }, { status: 409 });
        }
        const updated = await prisma.customerCompany.update({
            where: { id: existing.id },
            data: { unlinkedAt: null, role: role || null, linkedAt: new Date() },
        });
        return NextResponse.json(updated);
    }

    const link = await prisma.customerCompany.create({
        data: { customerId, companyId, role: role || null },
    });
    return NextResponse.json(link, { status: 201 });
}

// DELETE /api/companies/[id]/links?customerId=... — unlink
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const customerId = Number(searchParams.get("customerId"));
    if (!customerId) {
        return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }

    const link = await prisma.customerCompany.findFirst({
        where: { companyId: Number(id), customerId, unlinkedAt: null },
    });
    if (!link) {
        return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    const updated = await prisma.customerCompany.update({
        where: { id: link.id },
        data: { unlinkedAt: new Date() },
    });
    return NextResponse.json(updated);
}
