import type { PrismaClient } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "crypto";
import { isStaffEmailDomainAllowed } from "@/shared/lib/auth/staffEmailAllowlist";
import { isLoginBlocked, recordLoginFailure, clearLoginFailures } from "@/shared/lib/auth/loginRateLimit";
import { applyPermissionOverrides, normalizeCrudGrants } from "@/shared/lib/auth/crudLadder";
import { positionScopeLabel } from "@/shared/lib/org/positionScope";
import { CredentialsSignin } from "next-auth";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { isThisPcACounter } from "@/shared/lib/counter/releaseGuard";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { OUTSIDE_COUNTER_SIGNIN_CODE } from "@/shared/lib/constants/session";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { stampAttendanceIn } from "@/shared/lib/hr/attendanceStamp";
import { idleLimitMinutesFor } from "@/shared/lib/hr/dutyTime";
import { DEFAULT_IDLE_LIMIT_MINUTES } from "@/shared/lib/constants/session";

/** One seat a person holds: what they are called, and where it sits. */
export type StaffSeat = { title: string; scope: string };

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
    /** Every Position they hold, senior first. The counter's sign-in card prints these
     *  under the name; `title` above still wins when somebody has typed one in. */
    seats: StaffSeat[];
    avatarUrl?: string;
    /** Minutes away before this person is signed out. Their own, or the default —
     *  a counter manager and a technician cannot share one number. */
    idleLimitMinutes: number;
    kind: "staff";
    /** Signed in off a counter on "Can use Mobile App" alone — the session opens the
     *  phone app and nothing else (auth/phoneOnly.ts, enforced in proxy.ts). */
    phoneOnly?: true;
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
        seats: [],
        idleLimitMinutes: DEFAULT_IDLE_LIMIT_MINUTES,   // until resolveSuperAdmin finds the row's own
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
async function resolveSuperAdmin(prisma: PrismaClient, u: StaffAuthUser): Promise<{ id: string; idleLimitMinutes: number }> {
    try {
        const row = await prisma.user.upsert({
            where:  { email: u.email },
            update: {},
            create: {
                name:     u.name,
                email:    u.email,
                password: bcrypt.hashSync(randomBytes(32).toString("hex"), 10),
            },
            // The row can be a real person's own (owner, 2026-10-14: the super-admin
            // password on his own email) — then his HR idle limit applies, or the
            // till's clock and his timeline judge the same gap by two limits.
            select: { id: true, staffProfile: { select: { idleLimitMinutes: true } } },
        });
        return { id: String(row.id), idleLimitMinutes: idleLimitMinutesFor(row.staffProfile?.idleLimitMinutes) };
    } catch {
        // DB empty / unreachable — keep the sentinel and let the login through.
        return { id: u.id, idleLimitMinutes: u.idleLimitMinutes };
    }
}

/**
 * The one staff-user read every sign-in path makes — password, and now PIN.
 *
 * Kept in one place because `buildStaffAuthUser` below reads every relation it
 * pulls: a second call site with a thinner `include` would type-check and then
 * hand out a session with no permissions in it.
 */
async function findStaffUser(prisma: PrismaClient, email: string | { id: number }) {
    return prisma.user.findUnique({
        where: typeof email === "string" ? { email } : email,
        include: {
            userRole: {
                include: {
                    permissions: { include: { permission: true } },
                },
            },
            // HR & People — a person marked as left is refused below, on both
            // sign-in paths, from the date on their record.
            // `idleLimitMinutes` rides the sign-in so the client's idle timer knows
            // this person's own limit without a request of its own — see dutyTime.ts.
            staffProfile: { select: { leftOn: true, idleLimitMinutes: true } },
            userPositions: {
                include: {
                    position: {
                        include: {
                            // For the sign-in card's scope line — see positionScope.ts.
                            branch: { select: { name: true } },
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
}

type StaffUserRow = NonNullable<Awaited<ReturnType<typeof findStaffUser>>>;

/**
 * Everything that turns a verified staff row into a session — roles, permissions,
 * rank, branch and department reach.
 *
 * Shared by BOTH authorizers on purpose. Whatever proved who this is (a password or
 * a counter PIN), the authority they end up holding must be identical; two copies of
 * this would drift, and the drift would be silent.
 */
async function buildStaffAuthUser(prisma: PrismaClient, user: StaffUserRow): Promise<StaffAuthUser> {
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
    // GRANT adds, DENY wins last (and takes the higher rungs with it).
    applyPermissionOverrides(effective, overrides);

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

    // ── Every seat, senior first ────────────────────────────────────────────
    // A person can hold more than one Position — a Branch Manager who also sits on the
    // Executive Council — and the counter's card shows them all, because "which one is
    // he here?" is exactly what a face on a till has to answer. Ordered by the rank of
    // the roles the seat carries, so the senior one reads first.
    const seats = [...user.userPositions]
        .map((up) => ({
            title: up.position.title,
            scope: positionScopeLabel(up.position),
            rank: up.position.roleTemplates.reduce((top, row) => Math.max(top, row.role.rank), 0),
        }))
        .sort((a, b) => b.rank - a.rank)
        .map(({ title, scope }) => ({ title, scope }));

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
        seats,
        avatarUrl: user.avatarUrl ?? undefined,
        idleLimitMinutes: idleLimitMinutesFor(user.staffProfile?.idleLimitMinutes),
        kind: "staff",
    };
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
        return { ...superAdmin, ...(await resolveSuperAdmin(prisma, superAdmin)) };
    }

    if (!isStaffEmailDomainAllowed(email)) return null;

    const user = await findStaffUser(prisma, email);

    if (!user) {
        recordLoginFailure(email);
        return null;
    }

    // Marked as left by HR — the same "Invalid email or password" as a wrong
    // password, so the screen says nothing about whether the account exists.
    if (staffHasLeft(user.staffProfile)) {
        recordLoginFailure(email);
        return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        recordLoginFailure(email);
        return null;
    }
    clearLoginFailures(email);

    const staff = await buildStaffAuthUser(prisma, user);
    // Off a counter — the office website, or a desktop PC with no counter — only
    // "Can login outside counter" may sign in. Checked here, where the session is
    // minted: the login page's own check runs after the session already exists, so a
    // request that skips the page would skip it too.
    //
    // On the website, "Can use Mobile App" alone also gets in, as a phone-only session
    // (auth/phoneOnly.ts). Never on the desktop app: a PC with no counter is there to
    // be set up, which is an office action.
    if (!isThisPcACounter() && !hasPermissionWithScope(staff.permissions, PERMISSIONS.AUTH_LOGIN_OUTSIDE_COUNTER)) {
        if (IS_COUNTER_PC || !hasPermissionWithScope(staff.permissions, PERMISSIONS.MOBILE_APP_ACCESS)) {
            throw new OutsideCounterSignin();
        }
        staff.phoneOnly = true;
    }

    // The first sign-in on a till marks the business day PRESENT (HR & People).
    { const counterId = thisCounterId(); if (counterId) await stampAttendanceIn(prisma, user.id, counterId); }

    return staff;
}

/**
 * The password was right, but this is not a counter and the person lacks "Can login
 * outside counter". Its own code (reaches `signIn()`'s result as `code`) so the login
 * page can say so instead of "Invalid email or password".
 */
export class OutsideCounterSignin extends CredentialsSignin {
    code = OUTSIDE_COUNTER_SIGNIN_CODE;
}


/**
 * The staff session of a person a till's counter key speaks for (`counterRelayAuth.ts`).
 *
 * No password and no PIN: the till already proved who this is to itself, and the
 * counter key proves the till. The authority is rebuilt from the database here, by
 * the same `buildStaffAuthUser`, so a role change counts at the office on the very
 * next save. Null for an unknown id or someone HR has marked as left.
 */
export async function staffAuthUserById(prisma: PrismaClient, id: number): Promise<StaffAuthUser | null> {
    const user = await findStaffUser(prisma, { id });
    if (!user || staffHasLeft(user.staffProfile)) return null;
    return buildStaffAuthUser(prisma, user);
}
