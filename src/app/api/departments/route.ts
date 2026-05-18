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
});

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        // Counts come from Posts (the new model) rather than the legacy
        // User.departments[] direct relation. Reasoning:
        //   • Users now belong to departments via Post appointments
        //     (UserPost → Post.departmentId). User.departments[] is only
        //     populated for legacy accounts and would show 0 for new staff.
        //   • Departments are typically org-wide (branchId = null) and
        //     referenced by Posts at any branch — counting "how many
        //     branches use this dept" is more useful than counting
        //     legacy direct assignments.
        const departments = await prisma.department.findMany({
            orderBy: { name: "asc" },
            include: {
                branch: { select: { id: true, name: true } },
                _count: { select: { users: true } },          // legacy fallback
                posts:  {
                    select: {
                        branchId: true,
                        holders:  { select: { userId: true } },
                    },
                },
            },
        });

        const shaped = departments.map(d => {
            const userIds  = new Set<number>();
            const branchIds = new Set<string>();
            for (const p of d.posts) {
                for (const h of p.holders) userIds.add(h.userId);
                if (p.branchId) branchIds.add(p.branchId);
            }
            // Post-based count takes precedence; falls back to legacy if zero.
            const userCount = userIds.size > 0 ? userIds.size : d._count.users;

            const { posts, _count, ...rest } = d;
            void _count;
            return {
                ...rest,
                _count: {
                    users:    userCount,
                    posts:    posts.length,
                    branches: branchIds.size,
                },
            };
        });

        return NextResponse.json(shaped);
    } catch (e) {
        return handleApiError(e, "Failed to fetch departments");
    }
}

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { id, name, description, branchId } = data;
        const existing = await prisma.department.findUnique({ where: { id } });
        if (existing) return NextResponse.json({ error: "Department ID already exists" }, { status: 409 });
        const department = await prisma.department.create({
            data: { id, name, description: description ?? null, branchId: branchId ?? null },
            include: { branch: { select: { id: true, name: true } } },
        });
        return NextResponse.json(department, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create department");
    }
}
