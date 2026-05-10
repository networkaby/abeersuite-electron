import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/authGuard";
import { z } from "zod";

const overrideSchema = z.object({
    permissionId: z.string().trim().min(1),
    type:         z.enum(["GRANT", "DENY"]),
    reason:       z.string().trim().max(255).optional(),
    expiresAt:    z.string().datetime().optional().nullable(),
});

// ── GET /api/users/[id]/permissions ─────────────────────────────────────────
// Returns all permissions with roleGranted, userOverride (GRANT|DENY|null),
// and computed effective flag.

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
                    userRole: { include: { permissions: { select: { permissionId: true } } } },
                    userPermissions: {
                        where: {
                            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                        },
                        select: { permissionId: true, type: true, reason: true, expiresAt: true, createdAt: true },
                    },
                },
            }),
            prisma.permission.findMany({ orderBy: [{ module: "asc" }, { id: "asc" }] }),
        ]);

        if (!userRecord) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const roleGranted = new Set(userRecord.userRole.permissions.map(p => p.permissionId));
        const overrideMap = new Map(userRecord.userPermissions.map(o => [o.permissionId, o]));

        const result = allPermissions.map(p => {
            const override = overrideMap.get(p.id) ?? null;
            const base     = roleGranted.has(p.id);
            let effective  = base;
            if (override?.type === "GRANT") effective = true;
            if (override?.type === "DENY")  effective = false;
            return { ...p, roleGranted: base, userOverride: override, effective };
        });

        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 });
    }
}

// ── POST /api/users/[id]/permissions ────────────────────────────────────────
// Upserts a single user-level override (GRANT or DENY).

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requirePermission("users:manage");
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        const parsed = overrideSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const { permissionId, type, reason, expiresAt } = parsed.data;

        const override = await prisma.userPermission.upsert({
            where:  { userId_permissionId: { userId, permissionId } },
            update: { type, reason: reason ?? null, expiresAt: expiresAt ? new Date(expiresAt) : null },
            create: { userId, permissionId, type, reason: reason ?? null, expiresAt: expiresAt ? new Date(expiresAt) : null },
        });

        return NextResponse.json(override, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to save override" }, { status: 500 });
    }
}
