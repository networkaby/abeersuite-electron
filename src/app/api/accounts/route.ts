import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";

// GET /api/accounts — internal ledger accounts list
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    // Accept either personId (preferred) or customerId (legacy alias) as filter
    const personId = searchParams.get("personId") ?? searchParams.get("customerId");
    const companyId = searchParams.get("companyId");
    const filtered = Boolean(personId || companyId);
    const take = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || (filtered ? 50 : 50)));
    const page = Math.max(1, Number(searchParams.get("page")) || 1);

    const accounts = await prisma.account.findMany({
        where: {
            ...(personId ? { personId: Number(personId) } : {}),
            ...(companyId ? { companyId: Number(companyId) } : {}),
        },
        include: {
            person: {
                select: {
                    id: true,
                    name: true,
                    phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                },
            },
            company: {
                select: {
                    id: true,
                    name: true,
                    phones: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
                },
            },
        },
        take,
        skip: (page - 1) * take,
    });

    // Backward-compat shape: surface `phone` scalar on the embedded person/company.
    return NextResponse.json(
        accounts.map(a => ({
            ...a,
            person: a.person ? {
                id: a.person.id,
                name: a.person.name,
                phone: a.person.phones[0]?.phone ?? null,
            } : null,
            company: a.company ? {
                id: a.company.id,
                name: a.company.name,
                phone: a.company.phones[0]?.phone ?? null,
            } : null,
        })),
    );
}
