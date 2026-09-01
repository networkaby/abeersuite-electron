// GET  /api/pos/counters
//   - Default: active counters in current user's active branch (consumed by ShiftOpenDialog).
//   - ?scope=all (admin only): every counter in every branch + assigned shift counts. Used by /office/admin/counters.
//   - ?scope=all&authoritative=1: same list, but the device-lock fields are re-read from
//     the DB rather than the counter's replica. Used by /setup/counter.
//
// POST /api/pos/counters  (admin)
//   - Body: { branchId, name }
//   - Auto-creates the till GL account ("Cash – <name> – <branch>") under Cash-in-Hand if missing.
//   - Returns the created counter with tillAccount.

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireAnyPermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { auth } from "@/auth";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { effectiveAccountBalance, EFFECTIVE_BALANCE_SELECT_FIELDS } from "@/modules/accountancy/lib/balance";
import { z } from "zod";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const session = await auth();
        const sessionPerms = (session?.user as { permissions?: string[] })?.permissions ?? [];
        // Seeded admins don't carry admin:bypass (env-super-admin only). Viewing the
        // admin counter list is allowed for anyone who can act on counters — any
        // of create/edit/delete. Checking the LOWEST rung covers all three (the
        // CRUD ladder implies create from edit/delete) plus admin:bypass.
        const canManageCounters = hasPermissionWithScope(sessionPerms, PERMISSIONS.POS_COUNTERS_CREATE);

        const { searchParams } = new URL(req.url);
        const scope = searchParams.get("scope");

        // ── Full list across all branches (admin counters page + the POS Cash
        // Book counter picker). Listing counters is a read — default-open;
        // counter writes below keep their pos-counters:* gates. ─
        if (scope === "all") {
            const counters = await prisma.posCounter.findMany({
                orderBy: [{ branchId: "asc" }, { counterNumber: "asc" }, { name: "asc" }],
                include: {
                    tillAccount: { select: { id: true, name: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS } },
                    branch: { select: { id: true, name: true } },
                    paymentAccounts: {
                        orderBy: { sortOrder: "asc" },
                        select: {
                            id: true, channel: true, label: true, accountId: true, vpa: true,
                            sortOrder: true, isActive: true, defaultVisible: true, gatewayId: true,
                            account: { select: { id: true, name: true } },
                            gateway: { select: { id: true, displayName: true, provider: true } },
                        },
                    },
                    _count: { select: { shifts: true } },
                    shifts: {
                        where: { status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                        select: { id: true, status: true, user: { select: { name: true } } },
                        take: 1,
                    },
                },
            });
            // ── Who actually holds each counter ───────────────────────────────
            // `prisma` above is the REPLICA on a counter PC, and the device-lock
            // fields are the one part of this row a counter writes itself. So the
            // replica can carry a binding the DB has since cleared — a released
            // counter, or this machine's own binding from before a reinstall changed
            // its installation id — and /setup/counter would then grey out a counter
            // that is genuinely free, or offer one another PC really holds. Deciding
            // which counter this PC becomes has to be read from the source of truth,
            // the same reasoning as /api/pos/counters/my-binding.
            //
            // Only the lock fields are re-read; the heavy includes stay local. A
            // failure is reported as `locksReachable: false` rather than silently
            // falling back to replica values — the caller must be able to tell "free"
            // from "cannot check", and setup is an online-by-nature action.
            const authoritative = searchParams.get("authoritative") === "1";
            let locks: Map<number, { boundDeviceId: string | null; boundDeviceLabel: string | null; boundAt: Date | null }> | null = null;
            let locksReachable = true;
            if (authoritative) {
                try {
                    const rows = await prismaAuthoritative.posCounter.findMany({
                        select: { id: true, boundDeviceId: true, boundDeviceLabel: true, boundAt: true },
                    });
                    locks = new Map(rows.map((r) => [r.id, r]));
                } catch {
                    locksReachable = false;
                }
            }

            const list = counters.map((c) => ({
                id: c.id,
                counterNumber: c.counterNumber,
                name: c.name,
                branchId: c.branchId,
                branch: c.branch,
                isActive: c.isActive,
                epbxExtension: c.epbxExtension,
                tillAccount: {
                    id: c.tillAccount.id,
                    name: c.tillAccount.name,
                    balance: String(effectiveAccountBalance(c.tillAccount)),
                },
                paymentAccounts: c.paymentAccounts,
                allowedExpenseAccountIds: c.allowedExpenseAccountIds,
                totalShifts: c._count.shifts,
                activeShift: c.shifts[0] ?? null,
                // Device lock — which PC is bound to this counter (null = free).
                boundDeviceId: locks ? (locks.get(c.id)?.boundDeviceId ?? null) : c.boundDeviceId,
                boundDeviceLabel: locks ? (locks.get(c.id)?.boundDeviceLabel ?? null) : c.boundDeviceLabel,
                boundAt: locks ? (locks.get(c.id)?.boundAt ?? null) : c.boundAt,
            }));

            // The array shape is what every existing caller expects; only the
            // authoritative mode gets the wrapper, so nothing else has to change.
            return NextResponse.json(authoritative ? { counters: list, locksReachable } : list);
        }

        // ── Default: active counters in current user's active branch ──────────
        let branchId: string;
        try {
            branchId = resolveActiveBranchId(req, session);
        } catch (e) {
            if (e instanceof BranchAccessError) {
                // Admin with no branch cookie yet — fall back to the first active branch.
                if (canManageCounters && e.code === "no_active_branch") {
                    const firstBranch = await prisma.branch.findFirst({
                        where: { isActive: true },
                        orderBy: { name: "asc" },
                        select: { id: true },
                    });
                    if (!firstBranch) return NextResponse.json([], { status: 200 });
                    branchId = firstBranch.id;
                } else {
                    return NextResponse.json({ error: e.message }, { status: 400 });
                }
            } else {
                throw e;
            }
        }

        // Authoritative for the same reason as the scope=all branch above — this is the
        // list ShiftOpenDialog locks its picker against.
        const counters = await prisma.posCounter.findMany({
            where: { branchId, isActive: true },
            orderBy: [{ counterNumber: "asc" }, { name: "asc" }],
            include: {
                tillAccount: { select: { id: true, name: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS } },
                shifts: {
                    where: { status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                    select: { id: true, status: true, userId: true, user: { select: { name: true } }, openedAt: true },
                    orderBy: { openedAt: "desc" },
                    take: 1,
                },
            },
        });

        return NextResponse.json(counters.map((c) => ({
            id: c.id,
            counterNumber: c.counterNumber,
            name: c.name,
            branchId: c.branchId,
            isActive: c.isActive,
            // Which extension this counter's phone sits on — the call follow-up
            // popup uses it alongside boundDeviceId to find "my counter" without
            // needing a shift open (see useMyCounterExtension).
            epbxExtension: c.epbxExtension,
            tillAccount: {
                id: c.tillAccount.id,
                name: c.tillAccount.name,
                balance: String(effectiveAccountBalance(c.tillAccount)),
            },
            activeShift: c.shifts[0] ?? null,
            // Device lock — ShiftOpenDialog compares this to the PC's bridge deviceId.
            boundDeviceId: c.boundDeviceId,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch POS counters");
    }
}

// ── POST: create a new counter ───────────────────────────────────────────────

const createSchema = z.object({
    branchId: z.string().trim().min(1, "branchId is required"),
    name: z.string().trim().min(1, "Counter name is required").max(60),
    counterNumber: z.coerce.number().int().positive("Counter number must be greater than 0"),
});

const CASH_IN_HAND_GROUP = "Cash-in-Hand";

export async function POST(req: NextRequest) {
    const { response } = await requireAnyPermission(PERMISSIONS.POS_COUNTERS_CREATE);
    if (response) return response;

    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { branchId, name, counterNumber } = data;

        // Verify branch exists.
        const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
        if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });

        // Reject duplicate (branchId, name).
        const dupName = await prisma.posCounter.findFirst({ where: { branchId, name } });
        if (dupName) return NextResponse.json({ error: `Counter "${name}" already exists in ${branch.name}` }, { status: 409 });

        // counterNumber is GLOBALLY unique (not just per-branch) — it's embedded
        // directly in the offline-safe numeric PK formula (shared/lib/id/numericId.ts)
        // for Tickets/PosShifts/UniversalVoucher, so two counters in different
        // branches must never share a number or their offline-minted ids collide.
        const dupNum = await prisma.posCounter.findFirst({ where: { counterNumber }, select: { id: true, name: true, branch: { select: { name: true } } } });
        if (dupNum) return NextResponse.json({ error: `Counter number ${counterNumber} is already used by "${dupNum.name}" in ${dupNum.branch.name}` }, { status: 409 });

        const tillName = `Cash – ${name} – ${branch.name}`;

        const counter = await prisma.$transaction(async (tx) => {
            // Resolve Cash-in-Hand group.
            const group = await tx.accountGroup.findFirst({ where: { name: CASH_IN_HAND_GROUP }, select: { id: true } });
            if (!group) throw new Error(`Account group "${CASH_IN_HAND_GROUP}" missing — run bootstrap seed`);

            // Reuse existing GL account if one with the same name already exists; else create.
            let till = await tx.account.findFirst({
                where: { name: { equals: tillName, mode: "insensitive" }, personId: null, companyId: null },
                select: { id: true, name: true, balance: true },
            });
            if (!till) {
                till = await tx.account.create({
                    data: {
                        name: tillName,
                        groupId: group.id,
                        normalBalance: "DEBIT",
                        isActive: true,
                    },
                    select: { id: true, name: true, balance: true },
                });
            }

            // If the till is already linked to another counter, refuse.
            const existingLink = await tx.posCounter.findUnique({ where: { tillAccountId: till.id }, select: { id: true } });
            if (existingLink) {
                throw new Error(`Till "${tillName}" is already linked to another counter`);
            }

            return tx.posCounter.create({
                data: {
                    branchId,
                    name,
                    counterNumber,
                    tillAccountId: till.id,
                    isActive: true,
                },
                include: {
                    tillAccount: { select: { id: true, name: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS } },
                    branch: { select: { id: true, name: true } },
                },
            });
        });

        return NextResponse.json({
            id: counter.id,
            counterNumber: counter.counterNumber,
            name: counter.name,
            branchId: counter.branchId,
            branch: counter.branch,
            isActive: counter.isActive,
            tillAccount: {
                id: counter.tillAccount.id,
                name: counter.tillAccount.name,
                balance: String(effectiveAccountBalance(counter.tillAccount)),
            },
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create counter");
    }
}
