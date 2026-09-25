import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";
import { applyPermissionOverrides } from "@/shared/lib/auth/crudLadder";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

// One person's extra permissions — Admin → Users' shield button, the emergency
// way to give or take a single action without touching their role or seat.
//
// What the screen shows must be what sign-in builds (authorizeStaff):
// grants from `User.role` AND every held Position's role templates, the CRUD
// ladder, then the overrides through the same `applyPermissionOverrides`.
// `admin:bypass` is systemOnly — never listed, never grantable here.

const OVERRIDE_TYPES = ["GRANT", "DENY"] as const;
type OverrideType = (typeof OVERRIDE_TYPES)[number];

// ── GET /api/users/[id]/permissions ─────────────────────────────────────────
// { bypass, permissions: [{ id, label, module, description, roleGranted,
//   userOverride: GRANT|DENY|null, effective }] }

export async function GET(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });

        const rolePermissions = { select: { permissions: { select: { permissionId: true } } } } as const;
        const [userRecord, allPermissions] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    email: true,
                    userRole: rolePermissions,
                    userPositions: {
                        select: { position: { select: { roleTemplates: { select: { role: rolePermissions } } } } },
                    },
                    userPermissions: {
                        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
                        select: { permissionId: true, type: true },
                    },
                },
            }),
            prisma.permission.findMany({
                where: { systemOnly: false },
                select: { id: true, label: true, module: true, description: true },
                orderBy: [{ module: "asc" }, { id: "asc" }],
            }),
        ]);

        if (!userRecord) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const roleGrants = new Set<string>();
        for (const rp of userRecord.userRole?.permissions ?? []) roleGrants.add(rp.permissionId);
        for (const up of userRecord.userPositions) {
            for (const t of up.position.roleTemplates) {
                for (const rp of t.role.permissions) roleGrants.add(rp.permissionId);
            }
        }
        const effective = applyPermissionOverrides(new Set(roleGrants), userRecord.userPermissions);

        // The env super admin signs in with admin:bypass whatever its row holds.
        const envEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
        const bypass = effective.has(PERMISSIONS.ADMIN_BYPASS)
            || (!!envEmail && userRecord.email.toLowerCase() === envEmail);

        const roleList = [...roleGrants];
        const effectiveList = [...effective];
        const overrideById = new Map(userRecord.userPermissions.map((o) => [o.permissionId, o.type]));

        return NextResponse.json({
            bypass,
            permissions: allPermissions.map((p) => ({
                ...p,
                roleGranted:  hasPermissionWithScope(roleList, p.id),
                userOverride: overrideById.get(p.id) ?? null,
                effective:    bypass || hasPermissionWithScope(effectiveList, p.id),
            })),
        });
    } catch (e) {
        return handleApiError(e, "Failed to fetch permissions");
    }
}

// ── PUT /api/users/[id]/permissions ─────────────────────────────────────────
// Saves every changed override in one go: GRANT / DENY upsert, null removes the
// override (back to what the role gives). The person is signed out once, so
// the change takes effect on their next click.

const putSchema = z.object({
    overrides: z.array(z.object({
        permissionId: z.string().trim().min(1),
        type:         z.enum(OVERRIDE_TYPES).nullable(),
    })).min(1).max(1000),
});

export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.USERS_EDIT);
    if (response) return response;
    try {
        const { id } = await params;
        const userId = Number(id);
        if (Number.isNaN(userId)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
        const { data, error } = await validateRequest(req, putSchema);
        if (error) return error;

        const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const ids = [...new Set(data.overrides.map((o) => o.permissionId))];
        const known = await prisma.permission.findMany({
            where: { id: { in: ids }, systemOnly: false },
            select: { id: true },
        });
        if (known.length !== ids.length) {
            return NextResponse.json({ error: "Unknown or system-only permission" }, { status: 400 });
        }

        // Nobody hands out what they do not hold themselves.
        const grants = data.overrides.filter((o) => o.type === "GRANT").map((o) => o.permissionId);
        const notHeld = grants.filter((p) => !hasPermissionWithScope(caller.permissions, p));
        if (notHeld.length > 0) {
            return NextResponse.json(
                { error: `You cannot grant what you do not hold yourself: ${notHeld.join(", ")}` },
                { status: 403 },
            );
        }

        await prisma.$transaction(data.overrides.map(({ permissionId, type }) =>
            type === null
                ? prisma.userPermission.deleteMany({ where: { userId, permissionId } })
                : prisma.userPermission.upsert({
                    where:  { userId_permissionId: { userId, permissionId } },
                    update: { type: type satisfies OverrideType, reason: null, expiresAt: null },
                    create: { userId, permissionId, type },
                }),
        ));
        await revokeUserSessions(userId);

        return NextResponse.json({ saved: data.overrides.length });
    } catch (e) {
        return handleApiError(e, "Failed to save permissions");
    }
}
