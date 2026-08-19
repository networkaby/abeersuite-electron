import type { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "crypto";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { isLoginBlocked, recordLoginFailure, clearLoginFailures } from "@/shared/lib/auth/loginRateLimit";
import { crudDependentsOnRevoke, normalizeCrudGrants } from "@/shared/lib/auth/crudLadder";

export type StaffAuthUser = {
    id: string;
    name: string;
    email: string;
    /** Primary role, derived from the highest-rank Position the user holds.
     * Null when the user has no Position appointments (no operational authority). */
    role: string | null;
    roles: string[];
    permissions: string[];
    rank: number;
    scope: string;
    roleLabel?: string;
    roleColor?: string;
    departmentIds: string[];
    branchIds: string[];
    title?: string;
    avatarUrl?: string;
    kind: "staff";
};

// ── Super-admin env bypass ────────────────────────────────────────────────────
// Checked BEFORE the domain allowlist and DB lookup so it works even when the
// database is empty / wiped. Set SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD in
// .env. Leave either blank to disable entirely.
function checkSuperAdminEnv(email: string, password: string): StaffAuthUser | null {
    const envEmail    = process.env.SUPER_ADMIN_EMAIL?.trim();
    const envPassword = process.env.SUPER_ADMIN_PASSWORD?.trim();
    if (!envEmail || !envPassword) return null;

    // Timing-safe comparisons — timingSafeEqual requires equal-length buffers,
    // so we pad/compare against a fixed-length HMAC to avoid the length leak.
    const emailBuf  = Buffer.from(email.toLowerCase().padEnd(256));
    const envEmailBuf = Buffer.from(envEmail.toLowerCase().padEnd(256));
    const passBuf   = Buffer.from(password.padEnd(256));
    const envPassBuf  = Buffer.from(envPassword.padEnd(256));
    const emailMatch = timingSafeEqual(emailBuf.subarray(0, 256), envEmailBuf.subarray(0, 256));
    const passMatch  = timingSafeEqual(passBuf.subarray(0, 256), envPassBuf.subarray(0, 256));
    if (!emailMatch || !passMatch) return null;

    return {
        id: "0",
        name: "Super Admin",
        email: envEmail,
        role: "R1",
        roles: ["R1"],
        permissions: ["admin:bypass"],
        rank: 9999,
        scope: "ORG",
        roleLabel: "Super Admin",
        roleColor: "#7c3aed",
        departmentIds: [],
        branchIds: [],
        kind: "staff",
    };
}

/**
 * Anchor the env super admin to a REAL `User` row and return its id.
 *
 * `checkSuperAdminEnv` mints the sentinel id "0", which has no `User` row. That
 * is harmless for relation-free scalars (`UniversalVoucher.createdById` is
 * explicitly one) but every FK into `User` rejects it — `AuditLog.actorId` and
 * `.restoredById`, `Account.reconciledById`, `PosShift.closedById`,
 * `ChatRoom.ownerUserId`, `ChatMessage.senderUserId`. The failure is a P2003
 * raised mid-transaction, so the whole operation rolls back: voucher
 * hard-delete and recycle-bin restore both die for the one identity that
 * `admin:bypass` exists to authorise. Nothing is lost, but nothing lands, and
 * the error surfaces far from its cause.
 *
 * Deliberately BEST-EFFORT. The env check is run before the domain allowlist
 * and any DB lookup precisely so the super admin can still sign into an empty
 * or unreachable database; falling back to "0" keeps that escape hatch intact
 * (degraded exactly as today) instead of turning a dead DB into a locked door.
 * The upsert also means a wiped DB self-heals on the next super-admin login,
 * with no seed step to remember.
 *
 * Borrowing another user's id was the alternative and is worse: `AuditLog`
 * exists to record who destroyed a voucher — the one action with no undo — so
 * attributing it to a real person who did not do it corrupts the trail exactly
 * where it matters most.
 *
 * The stored password is a bcrypt hash of throwaway randomness, so the normal
 * credential path can never authenticate as this row; the env vars remain the
 * only way in. It is a valid hash (not a sentinel string) so `bcrypt.compare`
 * fails cleanly rather than choking on a malformed digest.
 */
async function resolveSuperAdminId(prisma: PrismaClient, u: StaffAuthUser): Promise<string> {
    try {
        const row = await prisma.user.upsert({
            where:  { email: u.email },
            update: {},
            create: {
                name:     u.name,
                email:    u.email,
                password: bcrypt.hashSync(randomBytes(32).toString("hex"), 10),
            },
            select: { id: true },
        });
        return String(row.id);
    } catch {
        // DB empty / unreachable — keep the sentinel and let the login through.
        return u.id;
    }
}

export async function authorizeStaffCredentials(
    prisma: PrismaClient,
    email: string,
    password: string
): Promise<StaffAuthUser | null> {
    // Brute-force throttle — checked before any credential work so a blocked
    // identifier costs nothing (no bcrypt, no DB).
    if (isLoginBlocked(email)) return null;

    // Env super-admin takes priority — credentials are verified with no DB.
    // The DB is touched only afterwards, to swap the sentinel id for a real
    // User row's id so FK-bearing writes (audit log, reconciliation, POS shift
    // close) work; it degrades to "0" if that is not possible.
    const superAdmin = checkSuperAdminEnv(email, password);
    if (superAdmin) {
        clearLoginFailures(email);
        return { ...superAdmin, id: await resolveSuperAdminId(prisma, superAdmin) };
    }

    if (!isStaffEmailDomainAllowed(email)) return null;

    const user = await prisma.user.findUnique({
        where: { email },
        include: {
            userRole: {
                include: {
                    permissions: { include: { permission: true } },
                },
            },
            userPositions: {
                include: {
                    position: {
                        include: {
                            roleTemplates: {
                                include: {
                                    role: {
                                        include: {
                                            permissions: { include: { permission: true } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!user) {
        recordLoginFailure(email);
        return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        recordLoginFailure(email);
        return null;
    }
    clearLoginFailures(email);

    // Roles flow from Position appointments. `User.role` is a manual override /
    // cache (e.g. promoted admins); it's included in the union when present.
    const positionRoleIds = user.userPositions.flatMap((up) =>
        up.position.roleTemplates.map((row) => row.role.id),
    );
    const allRoles = new Set<string>(positionRoleIds);
    if (user.role) allRoles.add(user.role);
    const roles = [...allRoles];

    // Effective permissions = union of grants from User.role (if any) + every
    // held Position's roleTemplate, then ±UserPermission overrides.
    const effective = new Set<string>();
    if (user.userRole) {
        for (const rp of user.userRole.permissions) {
            const permId = rp.permission?.id;
            if (permId) effective.add(permId);
        }
    }
    for (const userPosition of user.userPositions) {
        for (const row of userPosition.position.roleTemplates) {
            for (const rp of row.role.permissions) {
                const permId = rp.permission?.id;
                if (permId) effective.add(permId);
            }
        }
    }

    const now = new Date();
    const overrides = await prisma.userPermission.findMany({
        where: {
            userId: user.id,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { permissionId: true, type: true },
    });
    for (const o of overrides) {
        if (o.type === "GRANT") effective.add(o.permissionId);
    }

    // Explicit DENY wins last. Denying a rung also drops the highers that imply
    // it — otherwise check-time implication (hasPermissionWithScope) would
    // resurrect the denied action through the surviving higher grant.
    for (const o of overrides) {
        if (o.type === "GRANT") continue;
        effective.delete(o.permissionId);
        for (const higher of crudDependentsOnRevoke(o.permissionId)) effective.delete(higher);
    }

    // CRUD ladder: carry only the HIGHEST rung per resource — lowers are implied
    // at check time — so the session/JWT stays small even where legacy role
    // grants still store full create/edit/delete triads.
    const normalized = normalizeCrudGrants(effective);

    // Rank = max rank across user's role + every held Position's roleTemplate.
    let rank = user.userRole?.rank ?? 0;
    for (const up of user.userPositions) {
        for (const row of up.position.roleTemplates) {
            if (row.role.rank > rank) rank = row.role.rank;
        }
    }

    // Surface metadata for the highest-rank source for UI badges.
    let roleLabel: string | undefined = user.userRole?.label;
    let roleColor: string | undefined = user.userRole?.color;
    if (!roleLabel) {
        // No direct user role — pick the highest-rank Position role template.
        let best: { rank: number; label?: string; color?: string } | null = null;
        for (const up of user.userPositions) {
            for (const row of up.position.roleTemplates) {
                const rt = row.role;
                if (!best || rt.rank > best.rank) {
                    best = { rank: rt.rank, label: rt.label, color: rt.color };
                }
            }
        }
        roleLabel = best?.label;
        roleColor = best?.color;
    }

    // ── Derive branch access from Position appointments ──────────────────────
    // Org-wide positions (branchId = null, e.g. CEO, CFO) grant access to every
    // active branch. Branch-specific positions contribute their branchId to the
    // union.
    const positionBranchIds: string[] = [];
    let hasOrgWidePosition = false;
    for (const up of user.userPositions) {
        if (up.position.branchId === null) {
            hasOrgWidePosition = true;
        } else {
            positionBranchIds.push(up.position.branchId);
        }
    }

    let branchIds: string[];
    if (hasOrgWidePosition) {
        const allBranches = await prisma.branch.findMany({
            where: { isActive: true },
            select: { id: true },
        });
        branchIds = allBranches.map((b) => b.id);
    } else {
        branchIds = [...new Set(positionBranchIds)];
    }

    // ── Derive department access from Position appointments ──────────────────
    // Dept-agnostic positions (departmentId = null) grant access to all
    // departments. Otherwise union Position-derived dept IDs.
    const positionDeptIds: string[] = [];
    let hasAllDeptPosition = false;
    for (const up of user.userPositions) {
        if (up.position.departmentId === null) {
            hasAllDeptPosition = true;
        } else {
            positionDeptIds.push(up.position.departmentId);
        }
    }

    let departmentIds: string[];
    if (hasAllDeptPosition) {
        const allDepts = await prisma.department.findMany({ select: { id: true } });
        departmentIds = allDepts.map((d) => d.id);
    } else {
        departmentIds = [...new Set(positionDeptIds)];
    }

    return {
        id: String(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        roles,
        permissions: [...normalized],
        rank,
        scope: user.scope,
        roleLabel,
        roleColor,
        departmentIds,
        branchIds,
        title: user.title ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
        kind: "staff",
    };
}
