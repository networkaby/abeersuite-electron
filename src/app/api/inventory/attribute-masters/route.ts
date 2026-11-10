import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { ATTR_MASTER_INCLUDE, toAttrMasterRow } from "@/modules/inventory/lib/attributeMasters";

const createSchema = z.object({
    key:       z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase letters, digits, underscores, starting with a letter"),
    name:      z.string().min(1).max(100),
    /** Groups it applies to — each covers its subgroups. Empty = global. */
    groupIds:  z.array(z.number().int().positive()).max(200).default([]),
    sortOrder: z.number().int().min(0).default(0),
    isActive:  z.boolean().default(true),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const rows = await prisma.invAttributeMaster.findMany({
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: ATTR_MASTER_INCLUDE,
        });
        return NextResponse.json(rows.map(toAttrMasterRow));
    } catch (e) {
        return handleApiError(e, "Failed to fetch attribute masters");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.INVENTORY_MASTERS_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const row = await prisma.invAttributeMaster.create({
            data: {
                key:       data.key,
                name:      data.name,
                sortOrder: data.sortOrder,
                isActive:  data.isActive,
                groups:    { create: [...new Set(data.groupIds)].map((groupId) => ({ groupId })) },
            },
            include: ATTR_MASTER_INCLUDE,
        });
        return NextResponse.json(toAttrMasterRow(row), { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: "This key already exists — keys must be unique (labels may repeat)" }, { status: 409 });
        }
        return handleApiError(e, "Failed to create attribute master");
    }
}
