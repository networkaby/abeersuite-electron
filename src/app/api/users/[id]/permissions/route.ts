import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";

// UserPermission (per-user overrides) has been removed.
// Permissions are now role-based only (Role → RolePermission → Permission).

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);

        const [userRecord, allPermissions] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    role: true,
                    userRole: { include: { permissions: { include: { permission: true } } } },
                },
            }),
            prisma.permission.findMany({ orderBy: { module: "asc" } }),
        ]);

        if (!userRecord) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const roleGranted = new Set(
            userRecord.userRole.permissions.map((rp) => rp.permissionId)
        );

        const result = allPermissions.map((p) => ({
            ...p,
            roleGranted: roleGranted.has(p.id),
            userOverride: null,
            effective: roleGranted.has(p.id),
        }));

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 });
    }
}

// Per-user overrides are no longer supported — this endpoint is a no-op.
export async function PUT() {
    return NextResponse.json({ success: true, note: "Per-user overrides removed; manage via role permissions." });
}
