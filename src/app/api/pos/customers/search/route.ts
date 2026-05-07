import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";

// GET /api/pos/customers/search?q=ramesh
// Quick lookup for the POS top-bar — matches name / phone / email.
// Returns up to 12 lightweight rows.
export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;

    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json([]);

    try {
        const rows = await prisma.customer.findMany({
            where: {
                isActive: true,
                OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { phone: { contains: q } },
                    { email: { contains: q, mode: "insensitive" } },
                ],
            },
            select: { id: true, name: true, phone: true, email: true },
            take: 12,
            orderBy: { name: "asc" },
        });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
}
