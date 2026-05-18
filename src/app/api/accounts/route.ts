import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { parsePagination } from "@/shared/lib/api";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

// GET /api/accounts — internal ledger accounts list
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    // Accept either personId (preferred) or customerId (legacy alias) as filter
    const personId = searchParams.get("personId") ?? searchParams.get("customerId");
    const companyId = searchParams.get("companyId");
    const { take, page } = parsePagination(searchParams, { defaultLimit: 50, maxLimit: 500 });

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
                    phones: selectPrimaryPhone,
                },
            },
            company: {
                select: {
                    id: true,
                    name: true,
                    phones: selectPrimaryPhone,
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
