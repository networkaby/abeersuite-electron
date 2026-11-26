import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { invWarrantyTermCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { checkWarrantyShape } from "@/shared/lib/warranty/warrantyTerms";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.invWarrantyTerm.findMany({
            orderBy: { name: "asc" },
            // How many sale lines froze this term — the master screen locks its
            // type / days / extra condition once it is on any bill.
            include: { _count: { select: { saleLines: true } } },
        });
        return NextResponse.json(rows.map(({ _count, ...r }) => ({ ...r, usedOnBills: _count.saleLines })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch warranty terms");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invWarrantyTermCreateSchema);
        if (error) return error;
        const b = data;
        const shape = checkWarrantyShape({
            warrantyType: b.warrantyType ?? "MANUFACTURER",
            durationDays: b.durationDays ?? null,
            sellerDays:   b.sellerDays ?? null,
        });
        if ("error" in shape) return NextResponse.json({ error: shape.error }, { status: 400 });
        const row = await prisma.invWarrantyTerm.create({
            data: {
                name: b.name,
                description: b.description ?? null,
                ...shape.value,
                extraCondition: b.extraCondition?.trim() || null,
                isActive: b.isActive ?? true,
            },
        });
        return NextResponse.json({ ...row, usedOnBills: 0 }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create warranty term");
    }
}
