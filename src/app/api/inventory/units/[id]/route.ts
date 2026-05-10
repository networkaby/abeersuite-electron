import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { invUnitUpdateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { revalidateTag } from "next/cache";
import { INV_UNITS_TAG } from "../route";
import { validateRequest } from "@/shared/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("inventory:manage");
    if (response) return response;
    try {
        const id = Number((await params).id);
        if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        const { data, error } = await validateRequest(req, invUnitUpdateSchema);
        if (error) return error;
        const b = data;
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
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
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
        revalidateTag(INV_UNITS_TAG, { expire: 0 });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to delete unit" }, { status: 500 });
    }
}
