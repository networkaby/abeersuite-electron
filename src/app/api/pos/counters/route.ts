// GET  /api/pos/counters
//   - Default: active counters in current user's active branch (consumed by ShiftOpenDialog).
//   - ?scope=all (admin only): every counter in every branch + assigned shift counts. Used by /office/admin/counters.
//
// POST /api/pos/counters  (admin)
//   - Body: { branchId, name }
//   - Auto-creates the till GL account ("Cash – <name> – <branch>") under Cash-in-Hand if missing.
//   - Returns the created counter with tillAccount.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { auth } from "@/auth";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { z } from "zod";

export async function GET(req: NextRequest) {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const session = await auth();
        const sessionPerms = (session?.user as { permissions?: string[] })?.permissions ?? [];
        // Seeded admins don't carry admin:bypass (env-super-admin only). The
        // admin counter management page is gated by settings:manage, which
        // is the same gate the layout + PATCH/POST already use.
        const canManageCounters = sessionPerms.includes(PERMISSIONS.SETTINGS_MANAGE) || sessionPerms.includes(PERMISSIONS.ADMIN_BYPASS);

        const { searchParams } = new URL(req.url);
        const scope = searchParams.get("scope");

        // ── Admin: full list across all branches (for /office/admin/counters) ─
        if (scope === "all") {
            if (!canManageCounters) {
                return NextResponse.json({ error: "settings:manage permission required" }, { status: 403 });
            }
            const counters = await prisma.posCounter.findMany({
                orderBy: [{ branchId: "asc" }, { name: "asc" }],
                include: {
                    tillAccount:         { select: { id: true, name: true, balance: true } },
                    branch:              { select: { id: true, name: true } },
                    paymentAccounts: {
                        orderBy: { sortOrder: "asc" },
                        select: {
                            id: true, channel: true, label: true, accountId: true, vpa: true,
                            sortOrder: true, isActive: true, defaultVisible: true, gatewayId: true,
                            account: { select: { id: true, name: true } },
                            gateway: { select: { id: true, displayName: true, provider: true } },
                        },
                    },
                    _count:      { select: { shifts: true } },
                    shifts: {
                        where:  { status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                        select: { id: true, status: true, user: { select: { name: true } } },
                        take: 1,
                    },
                },
            });
            return NextResponse.json(counters.map((c) => ({
                id:          c.id,
                name:        c.name,
                branchId:    c.branchId,
                branch:      c.branch,
                isActive:    c.isActive,
                tillAccount: {
                    id:      c.tillAccount.id,
                    name:    c.tillAccount.name,
                    balance: c.tillAccount.balance.toString(),
                },
                paymentAccounts: c.paymentAccounts,
                allowedExpenseAccountIds: c.allowedExpenseAccountIds,
                totalShifts: c._count.shifts,
                activeShift: c.shifts[0] ?? null,
            })));
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

        const counters = await prisma.posCounter.findMany({
            where:   { branchId, isActive: true },
            orderBy: { name: "asc" },
            include: {
                tillAccount: { select: { id: true, name: true, balance: true } },
                shifts: {
                    where:  { status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
                    select: { id: true, status: true, userId: true, user: { select: { name: true } }, openedAt: true },
                    orderBy: { openedAt: "desc" },
                    take: 1,
                },
            },
        });

        return NextResponse.json(counters.map((c) => ({
            id:          c.id,
            name:        c.name,
            branchId:    c.branchId,
            isActive:    c.isActive,
            tillAccount: {
                id:      c.tillAccount.id,
                name:    c.tillAccount.name,
                balance: c.tillAccount.balance.toString(),
            },
            activeShift: c.shifts[0] ?? null,
        })));
    } catch (e) {
        return handleApiError(e, "Failed to fetch POS counters");
    }
}

// ── POST: create a new counter ───────────────────────────────────────────────

const createSchema = z.object({
    branchId: z.string().trim().min(1, "branchId is required"),
    name:     z.string().trim().min(1, "Counter name is required").max(60),
});

const CASH_IN_HAND_GROUP = "Cash-in-Hand";

export async function POST(req: NextRequest) {
    const { response } = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    if (response) return response;

    try {
        const { data, error } = await validateRequest(req, createSchema);
        if (error) return error;
        const { branchId, name } = data;

        // Verify branch exists.
        const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
        if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });

        // Reject duplicate (branchId, name).
        const dup = await prisma.posCounter.findFirst({ where: { branchId, name } });
        if (dup) return NextResponse.json({ error: `Counter "${name}" already exists in ${branch.name}` }, { status: 409 });

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
                        name:          tillName,
                        groupId:       group.id,
                        normalBalance: "DEBIT",
                        isActive:      true,
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
                    tillAccountId: till.id,
                    isActive:      true,
                },
                include: {
                    tillAccount: { select: { id: true, name: true, balance: true } },
                    branch:      { select: { id: true, name: true } },
                },
            });
        });

        return NextResponse.json({
            id:       counter.id,
            name:     counter.name,
            branchId: counter.branchId,
            branch:   counter.branch,
            isActive: counter.isActive,
            tillAccount: {
                id:      counter.tillAccount.id,
                name:    counter.tillAccount.name,
                balance: counter.tillAccount.balance.toString(),
            },
        }, { status: 201 });
    } catch (e) {
        return handleApiError(e, "Failed to create counter");
    }
}
