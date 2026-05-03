import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { invProductGroupCreateSchema } from "@/lib/inventory/schemas";

export async function GET() {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const rows = await prisma.invProductGroup.findMany({ orderBy: { name: "asc" } });
        return NextResponse.json(rows);
    } catch {
        return NextResponse.json({ error: "Failed to fetch product groups" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const parsed = invProductGroupCreateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
        const row = await prisma.invProductGroup.create({
            data: { name: b.name, isActive: b.isActive ?? true },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
        if (code === "P2002") return NextResponse.json({ error: "Group name already exists" }, { status: 409 });
        return NextResponse.json({ error: "Failed to create product group" }, { status: 500 });
    }
}
