import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { invProductGroupCreateSchema } from "@/shared/lib/schemas/inventorySchemas";
import { prismaUniqueError } from "@/shared/lib/api";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const groupInclude = {
    parent:  { select: { id: true, name: true } },
    gstRate: { select: { id: true, rate: true, label: true } },
} as const;

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.invProductGroup.findMany({
            orderBy: { name: "asc" },
            include: groupInclude,
        });
        return NextResponse.json(rows);
    } catch (e) {
        return handleApiError(e, "Failed to fetch product groups");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, invProductGroupCreateSchema);
        if (error) return error;
        const b = data;
        if (b.parentId != null) {
            const parent = await prisma.invProductGroup.findUnique({ where: { id: b.parentId } });
            if (!parent) return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
        }
        if (b.gstRateId != null) {
            const gr = await prisma.gstRate.findUnique({ where: { id: b.gstRateId } });
            if (!gr) return NextResponse.json({ error: "GST rate not found" }, { status: 400 });
        }
        if (b.slug) {
            const clash = await prisma.invProductGroup.findUnique({ where: { slug: b.slug } });
            if (clash) return NextResponse.json({ error: "Slug already in use" }, { status: 409 });
        }
        const row = await prisma.invProductGroup.create({
            data: {
                name: b.name,
                isActive: b.isActive ?? true,
                parentId:   b.parentId   ?? null,
                gstRateId:  b.gstRateId  ?? null,
                hsnCode:    b.hsnCode    ?? null,
                taxability: b.taxability ?? null,
                slug:        b.slug        ?? null,
                imageUrl:    b.imageUrl    ?? null,
                description: b.description ?? null,
                slowAfterDays:      b.slowAfterDays      ?? null,
                nonMovingAfterDays: b.nonMovingAfterDays ?? null,
                deadAfterDays:      b.deadAfterDays      ?? null,
            },
            include: groupInclude,
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        const conflict = prismaUniqueError(e, "Group name already exists");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to create product group");
    }
}
