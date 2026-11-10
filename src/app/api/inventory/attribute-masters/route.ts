import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission, requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const createSchema = z.object({
    key:        z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase letters, digits, underscores, starting with a letter"),
    name:       z.string().min(1).max(100),
    groupId: z.number().int().positive().nullish(),
    sortOrder:  z.number().int().min(0).default(0),
    isActive:   z.boolean().default(true),
});

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const url = new URL(req.url);
        const groupIdParam = url.searchParams.get("groupId");
        const groupId = groupIdParam ? Number(groupIdParam) : undefined;

        const rows = await prisma.invAttributeMaster.findMany({
            where: groupId != null
                ? { OR: [{ groupId }, { groupId: null }] }
                : undefined,
            orderBy: [{ groupId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
            include: { group: { select: { id: true, name: true } } },
        });
        return NextResponse.json(rows);
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
                key:        data.key,
                name:       data.name,
                groupId: data.groupId ?? null,
                sortOrder:  data.sortOrder,
                isActive:   data.isActive,
            },
            include: { group: { select: { id: true, name: true } } },
        });
        return NextResponse.json(row, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof Error && e.message.includes("Unique constraint")) {
            return NextResponse.json({ error: "This key already exists — keys must be unique (labels may repeat)" }, { status: 409 });
        }
        return handleApiError(e, "Failed to create attribute master");
    }
}
