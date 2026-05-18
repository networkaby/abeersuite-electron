import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

const createSchema = z.object({
    id:       z.string().trim().min(1, "ID is required").toUpperCase(),
    name:     z.string().trim().min(1, "Name is required"),
    address:  z.string().trim().optional().nullable(),
    phone:    z.string().trim().optional().nullable(),
    isActive: z.boolean().optional(),
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // We compute counts from Posts (the new model) rather than the legacy
        // User.branches[] / Department.branchId direct relations. Reasoning:
        //   • Users now belong to branches via Post appointments (UserPost →
        //     Post.branchId). User.branches[] is only populated for legacy
        //     accounts and would show 0 for new staff.
        //   • Departments are typically seeded org-wide (branchId = null) and
        //     are referenced by branch-scoped Posts. Counting by
        //     Department.branchId would always return 0 for org-wide depts
        //     even when positions at this branch use them.
        // So we union both sources for backward-compat and accuracy.
        const branches = await prisma.branch.findMany({
            orderBy: { name: "asc" },
            include: {
                _count: { select: { users: true, departments: true } },
                posts:  {
                    select: {
                        departmentId: true,
                        holders:      { select: { userId: true } },
                    },
                },
            },
        });

        const shaped = branches.map(b => {
            // Union legacy User.branches + Post-derived users
            const userIds = new Set<number>();
            const deptIds = new Set<string>();
            for (const p of b.posts) {
                for (const h of p.holders) userIds.add(h.userId);
                if (p.departmentId) deptIds.add(p.departmentId);
            }
            // Posts-based counts take precedence; fall back to legacy _count if zero.
            const userCount = userIds.size > 0 ? userIds.size : b._count.users;
            const deptCount = deptIds.size > 0 ? deptIds.size : b._count.departments;

            const { posts: _posts, _count: _legacy, ...rest } = b;
            void _posts; void _legacy;
            return { ...rest, _count: { users: userCount, departments: deptCount } };
        });

        return NextResponse.json(shaped);
    } catch (e) {
        return handleApiError(e, "Failed to fetch branches");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, name, address, phone, isActive } = data;
        const existing = await prisma.branch.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Branch ID already exists" }, { status: 409 });
        const branch = await prisma.branch.create({ data: { id, name, address: address ?? null, phone: phone ?? null, isActive: isActive ?? true } });
        return NextResponse.json(branch, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create branch");
    }
}
