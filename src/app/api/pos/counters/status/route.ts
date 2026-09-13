// GET /api/pos/counters/status
//
// Counter-centric status board (manager view). For each active counter in scope,
// returns its latest shift classified as:
//   • OPEN / AWAITING_HANDOVER — occupied: cashier, day opening, the till's
//     movement per book since open, and the live cash-in-drawer (running
//     expected = till book balance − drops — the same math the close route uses).
//   • FREE — no open shift: the last close (declared / variance / to-vault /
//     closed-by) plus the till GL balance (carry-over float sitting in the drawer).
//
// Default scope: active branch (radius is always branch). `branchId=all` is
// admin-only (admin:bypass), mirroring /api/pos/shifts.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { resolveActiveBranchId, BranchAccessError } from "@/shared/lib/auth/activeBranch";
import { auth } from "@/auth";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sumPaise, computeExpectedCash, effectiveBalancePaise } from "@/modules/pos/lib/shiftMath";
import { EFFECTIVE_BALANCE_SELECT_FIELDS } from "@/modules/accountancy/lib/balance";

type Person = { id: number; name: string };

type OpenInfo = {
    shiftId:              number;
    user:                 Person;
    openedAt:             Date;
    openingFloatPaise:    string;
    tillMovementPaise:    string;
    runningExpectedPaise: string;
    // AWAITING_HANDOVER only — who is taking over + what A declared.
    handoverToUser:       Person | null;
    declaredByAPaise:     string | null;
};

type LastClose = {
    shiftId:           number;
    user:              Person;
    closedBy:          Person | null;
    closedAt:          Date | null;
    declaredCashPaise: string | null;
    variancePaise:     string | null;
    toVaultPaise:      string | null;
};

export async function GET(req: NextRequest) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const session = await auth();
        const branchParam = new URL(req.url).searchParams.get("branchId");

        let branchFilter: { branchId?: string } = {};
        if (branchParam === "all") {
            // Cross-branch view is admin-only (branch is the only radius).
            if (!user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS)) {
                return NextResponse.json({ error: "Cross-branch view not permitted" }, { status: 403 });
            }
        } else if (branchParam) {
            branchFilter = { branchId: branchParam };
        } else {
            try { branchFilter = { branchId: resolveActiveBranchId(req, session) }; }
            catch (e) {
                if (e instanceof BranchAccessError) return NextResponse.json({ error: e.message }, { status: 400 });
                throw e;
            }
        }

        const counters = await prisma.posCounter.findMany({
            where:   { ...branchFilter, isActive: true },
            orderBy: [{ branchId: "asc" }, { name: "asc" }],
            include: {
                branch:      { select: { id: true, name: true } },
                tillAccount: { select: { id: true, name: true, ...EFFECTIVE_BALANCE_SELECT_FIELDS } },
                // Latest shift only — enough to classify occupied vs free.
                shifts: {
                    orderBy: { openedAt: "desc" },
                    take:    1,
                    include: {
                        user:         { select: { id: true, name: true } },
                        closedBy:     { select: { id: true, name: true } },
                        drops:        { select: { amountPaise: true } },
                        handover:    { select: { declaredByAPaise: true, toUser: { select: { id: true, name: true } } } },
                    },
                },
            },
        });

        const cards = await Promise.all(counters.map(async (c) => {
            const tillBalancePaise = effectiveBalancePaise(c.tillAccount);
            const shift = c.shifts[0] ?? null;
            const live  = !!shift && (shift.status === "OPEN" || shift.status === "AWAITING_HANDOVER");

            let open: OpenInfo | null = null;
            if (live && shift) {
                const dropsPaise           = sumPaise(shift.drops);
                const runningExpectedPaise = computeExpectedCash(tillBalancePaise, dropsPaise);
                const awaiting = shift.status === "AWAITING_HANDOVER";
                open = {
                    shiftId:              shift.id,
                    user:                 shift.user,
                    openedAt:             shift.openedAt,
                    openingFloatPaise:    shift.openingFloatPaise.toString(),
                    tillMovementPaise:    (tillBalancePaise - shift.openingFloatPaise).toString(),
                    runningExpectedPaise: runningExpectedPaise.toString(),
                    handoverToUser:       awaiting ? (shift.handover?.toUser ?? null) : null,
                    declaredByAPaise:     awaiting ? (shift.handover?.declaredByAPaise?.toString() ?? null) : null,
                };
            }

            const lastClose: LastClose | null = (!live && shift && shift.status === "CLOSED") ? {
                shiftId:           shift.id,
                user:              shift.user,
                closedBy:          shift.closedBy,
                closedAt:          shift.closedAt,
                declaredCashPaise: shift.declaredCashPaise?.toString() ?? null,
                variancePaise:     shift.variancePaise?.toString()     ?? null,
                toVaultPaise:      shift.toVaultPaise?.toString()       ?? null,
            } : null;

            return {
                counterId:        c.id,
                counterName:      c.name,
                branch:           c.branch,
                tillAccountId:    c.tillAccount.id,
                tillBalancePaise: tillBalancePaise.toString(),
                status:           live && shift ? shift.status : "FREE" as const,
                open,
                lastClose,
            };
        }));

        return NextResponse.json(cards);
    } catch (e) {
        return handleApiError(e, "Failed to fetch counter status");
    }
}
