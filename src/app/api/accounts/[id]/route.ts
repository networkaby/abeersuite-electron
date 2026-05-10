import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { selectPrimaryPhone } from "@/shared/lib/prisma/fragments";

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
