import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

type Params = { params: Promise<{ id: string }> };

// GET /api/accounts/[id] — single ledger account
export async function GET(_: Request, { params }: Params) {
    const { response } = await requireAuth();
    if (response) return response;

    const { id } = await params;
    const account = await prisma.account.findUnique({
        where: { id: Number(id) },
        include: {
            customer: { select: { id: true, name: true, phone: true } },
            company: { select: { id: true, name: true, phone: true } },
        },
    });

    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(account);
}
