import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { hasPermissionWithScope, hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { requiredVoucherPermission, type VoucherAction } from "@/shared/lib/auth/voucherMatrix";
import { canDoPosVoucher, type PosAction } from "@/shared/lib/auth/posVoucherMatrix";
import { IS_COUNTER_PC } from "@/shared/lib/prisma/counterMode";
import { isThisPcReleased, isThisPcWithoutCounter } from "@/shared/lib/counter/releaseGuard";
import type { VoucherType } from "@/generated/prisma/client";

/**
 * Canonical staff-side resolved-user shape.
 * `rank` (0–100) and `scope` (`"OWN" | "TEAM" | "DEPARTMENT" | "BRANCH" | "REGION" | "ORG"`)
 * carry the role's relative authority and the user's data-visibility radius.
 */
export interface ResolvedUser {
    id:            number;
    primaryRole:   string;
    roles:         string[];
    permissions:   string[];
    rank:          number;
    scope:         string;
    departmentIds: string[];
    branchIds:     string[];
}

type SessionUserShape = {
    id?:            string;
    role?:          string;
    roles?:         string[];
    permissions?:   string[];
    rank?:          number;
    scope?:         string;
    departmentIds?: string[];
    branchIds?:     string[];
};

function resolveFromSession(sessionUser: SessionUserShape): ResolvedUser {
    return {
        id:            Number(sessionUser.id ?? 0),
        primaryRole:   sessionUser.role ?? "",
        roles:         sessionUser.roles ?? [sessionUser.role ?? ""],
        permissions:   sessionUser.permissions ?? [],
        rank:          sessionUser.rank ?? 0,
        scope:         sessionUser.scope ?? "OWN",
        departmentIds: sessionUser.departmentIds ?? [],
        branchIds:     sessionUser.branchIds ?? [],
    };
}

export function hasPermission(user: ResolvedUser, permissionId: string): boolean {
    return hasPermissionWithScope(user.permissions, permissionId);
}

export function isAdmin(user: ResolvedUser): boolean {
    return hasPermission(user, PERMISSIONS.ADMIN_BYPASS);
}

/**
 * Sync check for a GL voucher action — per-kind key OR the generic fallback.
 * Use in `[id]` routes that must load the voucher (for its `type`) before they
 * can know which permission applies. `action: "cancel"` also covers editing.
 */
// Phase 5 5E: `type` widened to string — the spine's `type` is a plain string
// (spans every voucher kind). Unknown kinds fall back to the generic permission.
export function userCanVoucher(user: ResolvedUser, type: VoucherType | string, action: VoucherAction): boolean {
    const perKind = requiredVoucherPermission(type as VoucherType, action);
    return perKind != null && hasPermission(user, perKind);
}

/**
 * Like `userCanVoucher`, but a PASS-THROUGH (returns true) for voucher kinds that
 * have NO per-kind permission in the matrix — the POS / online channel variants
 * (POS, POS_ORDER, POS_ESTIMATE, ONLINE_ORDER, ONLINE_INVOICE). Use only in the
 * create / post routes, which had no prior permission gate: this newly enforces
 * the per-kind key (or its generic `inventory:edit` fallback) on the matrix kinds
 * while leaving the channel vouchers gated exactly as before (by their own flow).
 */
export function userCanVoucherKind(user: ResolvedUser, type: VoucherType | string, action: VoucherAction): boolean {
    const perKind = requiredVoucherPermission(type as VoucherType, action);
    if (perKind == null) return true;
    return hasPermission(user, perKind);
}

/**
 * Recycle-bin gate: **whoever may delete a voucher kind may restore it.** Restore
 * is the exact inverse of the delete that created the snapshot, so it rides the
 * same per-kind `delete` key the hard-delete routes check — no separate grant.
 *
 * Previously both `/api/audit` and `/api/audit/[id]/restore` demanded
 * `admin:bypass`, which is not granted to the Admin role — the recycle bin
 * listed nothing and Restore 403'd for everyone (verified 2026-08-01).
 *
 * `subtype` is the removed voucher's concrete kind (SALE / PAYMENT / …). It is
 * null for journal entries, whose kind is JOURNAL.
 */
export function userCanRestoreAudit(user: ResolvedUser, entityType: string, subtype: string | null): boolean {
    const kind = subtype ?? (entityType === "JOURNAL_ENTRY" ? "JOURNAL" : null);
    if (kind == null) return false;
    return userCanVoucherKind(user, kind, "delete");
}

/**
 * True if the user may author (create) at least one voucher kind. Used to grant
 * read access to the supporting data every voucher form needs — the GL account
 * list and the next-reference preview — without demanding the broad
 * `accountancy:view`. Otherwise a position granted only a per-kind create key
 * could open the form but never load its accounts. admin:bypass passes.
 */
export function userCanAuthorVoucher(user: ResolvedUser): boolean {
    if (isAdmin(user)) return true;
    return user.permissions.some((p) =>
        p.startsWith("finance:voucher:create:")
        || p.startsWith("inventory:voucher:create:"),
    );
}

type GuardResult =
    | { user: ResolvedUser; response: null }
    | { user: null; response: NextResponse };

/**
 * Staff API gate — 401 if no session, 403 if the session belongs to a portal customer.
 */
export async function requireAuth(opts: { allowReleased?: boolean } = {}): Promise<GuardResult> {
    const session = await auth();
    if (!session || !session.user) {
        // A REVOKED token is not the same as no session, and the difference is worth
        // one field: the user was signed in a moment ago and their token was pulled
        // out from under them — a sign-out elsewhere on the same login, or an admin
        // editing their role or position (see auth/revokeSessions.ts). The browser
        // turns this code into a sentence before it redirects (SessionWrapper), so the
        // cashier is told why instead of the screen silently jumping to the login page.
        if ((session as { revoked?: boolean } | null)?.revoked) {
            return {
                user: null,
                response: NextResponse.json(
                    { error: "Your access was updated. Please sign in again.", code: "SESSION_REVOKED" },
                    { status: 401 },
                ),
            };
        }
        return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    if ((session.user as { kind?: string }).kind === "customer") {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    // A counter PC whose counter the office has released does no work at all until it
    // is onboarded again — not a task, not a voucher — however long the cashier stays
    // signed in. The reconciler signs them out within seconds of the pull landing; this
    // is the hard stop underneath it. Inert off a counter PC and on a fresh one; the
    // handful of routes the login/setup flow needs pass `allowReleased`. Answered from
    // the replica, cached — no egress (see releaseGuard.ts).
    //
    // The same stop applies to a counter PC with NO setup file at all — fresh, or just
    // wiped after a release. The login page sends such a PC to /setup/counter, but that
    // is client-side only; a signed-in admin could reach any route by URL. Its replica
    // was truncated with RESTART IDENTITY, so anything saved there would take ids in the
    // cloud's range with no worker to carry it up. Without a counter there is no id
    // block, and nothing can beat that conflict — so the only allowed work is onboarding.
    if (!opts.allowReleased && IS_COUNTER_PC && (isThisPcWithoutCounter() || (await isThisPcReleased()))) {
        return {
            user: null,
            response: NextResponse.json(
                { error: "This PC holds no counter. Counter setup is required.", code: "COUNTER_RELEASED" },
                { status: 403 },
            ),
        };
    }
    return { user: resolveFromSession(session.user as SessionUserShape), response: null };
}

/**
 * Staff page gate — redirects to staff login if signed out, or `/office` if
 * the session belongs to a portal customer. For Server Components, which
 * can't return the NextResponse `requireAuth` uses for API routes.
 */
export async function requireStaffPage(): Promise<void> {
    const session = await auth();
    if (!session?.user) redirect("/staff/login");
    if ((session.user as { kind?: string }).kind === "customer") redirect("/office");
    redirectIfPcWithoutCounter();
}

/**
 * A counter PC without a counter has one page: the setup wizard. The login page
 * already routes there, but only client-side; the (protected) layouts and
 * `requireStaffPage` call this so a typed URL cannot reach a page either. Inert off a
 * counter PC. Same rule as the API stop in `requireAuth`.
 */
export function redirectIfPcWithoutCounter(): void {
    if (IS_COUNTER_PC && isThisPcWithoutCounter()) redirect("/setup/counter");
}

/** Restrict by primary role label (e.g. `"R1"`, `"R2"`). */
export async function requireRole(...roles: string[]): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!roles.includes(result.user.primaryRole)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

/**
 * Gate by permission id (e.g. `"settings:manage"`). Chains through `requireAuth`,
 * so portal customers and unauthenticated requests are rejected before the permission check.
 */
export async function requirePermission(permissionId: string): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!hasPermission(result.user, permissionId)) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

/**
 * Gate by ANY of the given permission ids (OR). Used where an action key and its
 * umbrella both grant access — e.g. `branches:create` OR `branches:manage`. Passes
 * if the user holds at least one (admin:bypass passes via hasPermission).
 */
export async function requireAnyPermission(...permissionIds: string[]): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (permissionIds.some((id) => hasPermission(result.user, id))) return result;
    return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
}

/**
 * Gate a GL voucher action by the per-kind permission, falling back to the
 * generic key (additive — legacy roles holding `finance:voucher:*` keep working).
 * The voucher kind usually comes from the request body (create) or the loaded
 * voucher row (post/cancel/delete), so call this after you know the `type`.
 *
 * `action: "cancel"` also gates editing a voucher ("who can cancel can edit").
 */
export async function requireVoucherPermission(
    type: VoucherType,
    action: VoucherAction,
): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    const perKind = requiredVoucherPermission(type, action);
    const ok = perKind != null && hasPermission(result.user, perKind);
    if (!ok) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

/**
 * New-model read gate for a module's data APIs: allow if the user was given the
 * module's UI (any `ui:sidebar:<moduleKey>:*` grant) OR holds the capability
 * permission (kept as fallback). Admin bypass passes via either check. Mirrors the
 * module layout guard so "has the nav → may load its data". Finer per-kind limits
 * (view/open) are applied inside the handler, later.
 */
export async function requireModuleAccess(moduleKey: string, capabilityPermissionId?: string): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (hasModuleNavAccess(result.user.permissions, moduleKey) || (capabilityPermissionId != null && hasPermission(result.user, capabilityPermissionId))) {
        return result;
    }
    return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
}

/**
 * POS write gate — the operator holds the Role-page tick `pos:voucher:<action>:<kind>`
 * (or the office-equivalent voucher permission). This is the authoritative
 * "create means create" check for the POS create routes; it deliberately does NOT
 * depend on the office `pos` module nav — operators carry `ui:sidebar:workspace:pos`,
 * not `ui:sidebar:pos:*`. The open-shift requirement is enforced in each route body.
 */
export async function requirePosVoucher(kind: string, action: PosAction): Promise<GuardResult> {
    const result = await requireAuth();
    if (result.response) return result;
    if (!canDoPosVoucher(kind, action, result.user.permissions, isAdmin(result.user))) {
        return { user: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return result;
}

/** Build a `ResolvedUser` from a session object without enforcing any guard. */
export function resolvedUserFromSession(session: { user?: SessionUserShape }): ResolvedUser {
    return resolveFromSession(session.user ?? {});
}
