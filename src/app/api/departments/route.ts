import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const createSchema = z.object({
    id:          z.string().trim().min(1, "ID is required").toUpperCase(),
    name:        z.string().trim().min(1, "Name is required"),
    description: z.string().trim().optional().nullable(),
    branchId:    z.string().trim().optional().nullable(),
    // All-access flag — its pool is "every permission", managed automatically.
    // Admin-only; normally only the seed sets this true.
    isAllAccess: z.boolean().optional(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // Counts come from Positions (the org assignment model).
        const departments = await prisma.department.findMany({
            orderBy: { name: "asc" },
            include: {
                branch: { select: { id: true, name: true } },
                positions: {
                    select: {
                        branchId: true,
                        holders:  { select: { userId: true } },
                    },
                },
                _count: { select: { permissionPool: true, roles: true } },
            },
        });

        const shaped = departments.map(d => {
            const userIds   = new Set<number>();
            const branchIds = new Set<string>();
            for (const p of d.positions) {
                for (const h of p.holders) userIds.add(h.userId);
                if (p.branchId) branchIds.add(p.branchId);
            }

            const { positions, _count, ...rest } = d;
            return {
                ...rest,
                _count: {
                    users:          userIds.size,
                    positions:      positions.length,
                    branches:       branchIds.size,
                    permissionPool: _count.permissionPool,
                    roles:          _count.roles,
                },
            };
        });

        return NextResponse.json(shaped);
    } catch (e) {
        return handleApiError(e, "Failed to fetch departments");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.DEPARTMENTS_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, name, description, branchId, isAllAccess } = data;
        const existing = await prisma.department.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Department ID already exists" }, { status: 409 });
        const department = await prisma.department.create({
            data: { id, name, description: description ?? null, branchId: branchId ?? null, isAllAccess: isAllAccess ?? false },
            include: { branch: { select: { id: true, name: true } } },
        });
        return NextResponse.json(department, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create department");
    }
}
