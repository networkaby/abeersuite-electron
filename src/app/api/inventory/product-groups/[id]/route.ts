import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { invProductGroupUpdateSchema } from "@/lib/inventory/schemas";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const parsed = invProductGroupUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
        const row = await prisma.invProductGroup.update({
            where: { id },
            data: {
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
            },
        });
        return NextResponse.json(row);
    } catch (e: unknown) {
        const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
        if (code === "P2002") return NextResponse.json({ error: "Group name already exists" }, { status: 409 });
        return NextResponse.json({ error: "Failed to update product group" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const n = await prisma.invProduct.count({ where: { groupId: id } });
        if (n > 0) {
            return NextResponse.json({ error: "Cannot delete group while products reference it." }, { status: 400 });
        }
        await prisma.invProductGroup.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete product group" }, { status: 500 });
    }
}
