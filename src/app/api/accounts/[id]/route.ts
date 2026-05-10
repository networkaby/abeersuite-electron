import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/authGuard";

type Params = { params: Promise<{ id: string }> };

// GET /api/accounts/[id] — single ledger account
export async function GET(_: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
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
    });

    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
        ...account,
        person: account.person ? {
            id: account.person.id,
            name: account.person.name,
            phone: account.person.phones[0]?.phone ?? null,
        } : null,
        company: account.company ? {
            id: account.company.id,
            name: account.company.name,
            phone: account.company.phones[0]?.phone ?? null,
        } : null,
    });
}
