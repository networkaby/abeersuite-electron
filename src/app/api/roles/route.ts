import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const createRoleSchema = z.object({
    label:        z.string().trim().min(1, "Label is required"),
    color:        z.string().trim().min(1, "Color is required"),
    rank:         z.coerce.number().int().min(0).max(100).optional(),
    // Home department — required. Determines the role's authoring lens (which
    // permissions the Role Matrix offers). Not a data-scope.
    departmentId: z.string().trim().min(1, "Department is required"),
});

export async function GET() {
    // Viewing roles is allowed for anyone who can act on roles (manage or any action).
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const roles = await prisma.role.findMany({
            orderBy: { id: "asc" },
            include: {
                permissions: { include: { permission: true } },
                department:  { select: { id: true, name: true, isAllAccess: true } },
                _count:      { select: { users: true } },
            },
        });
        return NextResponse.json(roles);
    } catch (e) {
        return handleApiError(e, "Failed to fetch roles");
    }
}

export async function POST(req: Request) {
    const { response } = await requireAnyPermission(PERMISSIONS.ROLES_CREATE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createRoleSchema);
        if (error) return error;
        const body = data;
        // Auto-generate next role ID (R5, R6, ...)
        const existing = await prisma.role.findMany({ orderBy: { id: "asc" } });
        const maxNum = existing.reduce((max, r) => {
            const n = parseInt(r.id.replace("R", ""), 10);
            return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        const newId = `R${maxNum + 1}`;
        // Reject unknown department so we surface a clean 400 rather than a raw FK error.
        const dept = await prisma.department.findUnique({ where: { id: body.departmentId }, select: { id: true } });
        if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 400 });
        const role = await prisma.role.create({
            data: { id: newId, label: body.label, color: body.color, rank: body.rank ?? 0, isSystem: false, departmentId: body.departmentId },
            include: { department: { select: { id: true, name: true, isAllAccess: true } } },
        });
        return NextResponse.json(role);
    } catch (e) {
        return handleApiError(e, "Failed to create role");
    }
}
