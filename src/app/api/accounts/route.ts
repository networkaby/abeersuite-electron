import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";

// GET /api/accounts — internal ledger accounts list
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const companyId = searchParams.get("companyId");
    const filtered = Boolean(customerId || companyId);
    const take = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || (filtered ? 50 : 50)));
    const page = Math.max(1, Number(searchParams.get("page")) || 1);

    const accounts = await prisma.account.findMany({
        where: {
            ...(customerId ? { customerId: Number(customerId) } : {}),
            ...(companyId ? { companyId: Number(companyId) } : {}),
        },
        include: {
            customer: { select: { id: true, name: true, phone: true } },
            company: { select: { id: true, name: true, phone: true } },
        },
        take,
        skip: (page - 1) * take,
    });

    return NextResponse.json(accounts);
}
