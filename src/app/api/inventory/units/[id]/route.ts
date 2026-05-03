import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { invUnitUpdateSchema } from "@/lib/inventory/schemas";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const parsed = invUnitUpdateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const b = parsed.data;
        if (b.code !== undefined) {
            const code = b.code.toUpperCase();
            const clash = await prisma.invUnit.findFirst({ where: { code, NOT: { id } } });
            if (clash) return NextResponse.json({ error: "Unit code already exists" }, { status: 409 });
        }
        const row = await prisma.invUnit.update({
            where: { id },
            data: {
                ...(b.code !== undefined ? { code: b.code.toUpperCase() } : {}),
                ...(b.label !== undefined ? { label: b.label } : {}),
                ...(b.decimals !== undefined ? { decimals: b.decimals } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
            },
        });
        return NextResponse.json(row);
    } catch {
        return NextResponse.json({ error: "Failed to update unit" }, { status: 500 });
    }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const n = await prisma.invProduct.count({ where: { unitId: id } });
        if (n > 0) {
            return NextResponse.json({ error: "Cannot delete unit while products reference it." }, { status: 400 });
        }
        await prisma.invUnit.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete unit" }, { status: 500 });
    }
}
