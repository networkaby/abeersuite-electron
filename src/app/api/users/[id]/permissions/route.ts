import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const userOverridesSchema = z.object({
    overrides: z.array(z.object({
        permissionId: z.string().trim().min(1),
        granted: z.boolean().nullable(),
    })),
});

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);

        const [userRoles, userOverrides, allPermissions] = await Promise.all([
            prisma.userRole.findMany({
                where: { userId },
                include: { role: { include: { permissions: true } } },
            }),
            prisma.userPermission.findMany({ where: { userId } }),
            prisma.permission.findMany({ orderBy: { module: "asc" } }),
        ]);

        // Compute effective permissions
        const roleGranted = new Set<string>();
        for (const ur of userRoles) {
            for (const rp of ur.role.permissions) {
                roleGranted.add(rp.permissionId);
            }
        }
        const overrideMap = new Map(userOverrides.map((o) => [o.permissionId, o.granted]));

        const result = allPermissions.map((p) => ({
            ...p,
            roleGranted: roleGranted.has(p.id),
            userOverride: overrideMap.get(p.id) ?? null,
            effective: overrideMap.has(p.id) ? overrideMap.get(p.id)! : roleGranted.has(p.id),
        }));

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 });
    }
}

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response, user } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        const grantedById = user.id;

        // overrides: array of { permissionId, granted: boolean | null }
        // null = remove override (revert to role default)
        const parsed = userOverridesSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid user permissions payload" }, { status: 400 });
        }
        const { overrides } = parsed.data;

        for (const { permissionId, granted } of overrides) {
            if (granted === null) {
                await prisma.userPermission.deleteMany({ where: { userId, permissionId } });
            } else {
                await prisma.userPermission.upsert({
                    where: { userId_permissionId: { userId, permissionId } },
                    create: { userId, permissionId, granted, grantedBy: grantedById },
                    update: { granted, grantedBy: grantedById },
                });
            }
        }

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Failed to update user permissions" }, { status: 500 });
    }
}
