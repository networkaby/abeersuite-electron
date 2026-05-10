import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";
import { z } from "zod";

// GET /api/companies/[id]/links — list linked persons
export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const links = await prisma.personCompany.findMany({
        where: { companyId: Number(id), unlinkedAt: null },
        include: {
            person: {
                select: {
                    id: true,
                    name: true,
                    phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                    emails: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                },
            },
        },
        orderBy: { linkedAt: "desc" },
    });
    // Backward-compat shape: expose phone/email scalars on the embedded person
    return NextResponse.json(
        links.map(l => ({
            ...l,
            person: {
                id: l.person.id,
                name: l.person.name,
                phone: l.person.phones[0]?.phone ?? null,
                email: l.person.emails[0]?.email ?? null,
            },
        }))
    );
}

const linkSchema = z.object({
    personId: z.coerce.number().int().positive(),
    role: z.string().trim().optional().or(z.literal("")),
});

// POST /api/companies/[id]/links — link a person
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
    const { personId, role } = parsed.data;
    const companyId = Number(id);

    const existing = await prisma.personCompany.findFirst({
        where: { personId, companyId },
    });

    if (existing) {
        if (existing.unlinkedAt === null) {
            return NextResponse.json({ error: "Already linked" }, { status: 409 });
        }
        const updated = await prisma.personCompany.update({
            where: { id: existing.id },
            data: { unlinkedAt: null, role: role || null, linkedAt: new Date() },
        });
        return NextResponse.json(updated);
    }

    const link = await prisma.personCompany.create({
        data: { personId, companyId, role: role || null },
    });
    return NextResponse.json(link, { status: 201 });
}

// DELETE /api/companies/[id]/links?personId=... — unlink
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const personId = Number(searchParams.get("personId"));
    if (!personId) {
        return NextResponse.json({ error: "personId is required" }, { status: 400 });
    }

    const link = await prisma.personCompany.findFirst({
        where: { companyId: Number(id), personId, unlinkedAt: null },
    });
    if (!link) {
        return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    const updated = await prisma.personCompany.update({
        where: { id: link.id },
        data: { unlinkedAt: new Date() },
    });
    return NextResponse.json(updated);
}
