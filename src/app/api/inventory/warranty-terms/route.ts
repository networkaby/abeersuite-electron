import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { invWarrantyTermCreateSchema } from "@/lib/inventory/schemas";

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await prisma.invWarrantyTerm.findMany({ orderBy: { name: "asc" } });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to fetch warranty terms" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const parsed = invWarrantyTermCreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
        const row = await prisma.invWarrantyTerm.create({
            data: {
                name: b.name,
                description: b.description ?? null,
                durationMonths: b.durationMonths ?? null,
                isActive: b.isActive ?? true,
            },
        });
        return NextResponse.json(row, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to create warranty term" }, { status: 500 });
    }
}
