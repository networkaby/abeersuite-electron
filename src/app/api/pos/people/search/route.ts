import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { selectPrimaryPhone, selectPrimaryEmail } from "@/shared/lib/prisma/fragments";

// GET /api/pos/people/search?q=ramesh
// Quick lookup for the POS top-bar — matches name / phone / email.
// Returns up to 12 lightweight rows.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json([]);

    try {
        const rows = await prisma.person.findMany({
            where: {
                isActive: true,
                OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { phones: { some: { phone: { contains: q } } } },
                    { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
                ],
            },
            select: {
                id: true,
                name: true,
                phones: selectPrimaryPhone,
                emails: selectPrimaryEmail,
            },
            take: 12,
            orderBy: { name: "asc" },
        });
        return NextResponse.json(
            rows.map(r => ({
                id: r.id,
                name: r.name,
                phone: r.phones[0]?.phone ?? null,
                email: r.emails[0]?.email ?? null,
            })),
        );
    } catch (e) {
        return handleApiError(e, "Lookup failed");
    }
}
