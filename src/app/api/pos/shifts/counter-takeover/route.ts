// GET /api/pos/shifts/counter-takeover?counterId=
//
// "Is somebody else's drawer on this counter?" — asked by the POS screen right
// after sign-in when the person has no shift of their own. On a counter PC the
// counter is this PC's own (`thisCounterId()`); elsewhere the caller names it,
// having picked a busy counter in the open-shift dialog.
//
// Answers null when the counter is free, when the shift there is the caller's
// own, or when the caller could not take it over anyway (another branch). Else it
// returns everything the takeover modal shows: whose shift, since when, A's count
// and denominations when A handed over properly, and the drawer summary.

import { prisma, prismaAuthoritative } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { buildShiftSummary } from "@/modules/pos/lib/shiftSummary";
import { parseHandoverDenominations } from "@/modules/pos/lib/handoverDenominations";

export async function GET(req: Request) {
    const { user, response } = await requirePermission(PERMISSIONS.POS_SHIFT_OPEN);
    if (response) return response;

    const asked = Number(new URL(req.url).searchParams.get("counterId"));
    const counterId = Number.isInteger(asked) && asked > 0 ? asked : thisCounterId();
    if (!counterId) return NextResponse.json(null);

    try {
        const shift = await prisma.posShift.findFirst({
            where:   { counterId, status: { in: ["OPEN", "AWAITING_HANDOVER"] } },
            orderBy: { openedAt: "desc" },
            include: {
                user:    { select: { id: true, name: true } },
                branch:  { select: { id: true, name: true } },
                counter: {
                    include: {
                        tillAccount:     { select: { id: true, name: true } },
                        paymentAccounts: { where: { isActive: true }, select: { channel: true, label: true, accountId: true } },
                    },
                },
                drops:    { select: { amountPaise: true } },
                handover: { select: { status: true, declaredByAPaise: true, denominationsJson: true, notes: true, initiatedAt: true } },
            },
        });
        if (!shift || shift.userId === user!.id) return NextResponse.json(null);

        const isAdmin = user!.permissions.includes(PERMISSIONS.ADMIN_BYPASS);
        if (!isAdmin && !user!.branchIds.includes(shift.branchId)) return NextResponse.json(null);

        // The replica cannot know about a close made while this PC was away (see
        // shifts/current). One indexed column confirms it; offline, the replica stands.
        try {
            const live = await prismaAuthoritative.posShift.findUnique({ where: { id: shift.id }, select: { status: true } });
            if (live?.status === "CLOSED") return NextResponse.json(null);
        } catch { /* DB unreachable — trust the replica */ }

        const pending = shift.status === "AWAITING_HANDOVER" && shift.handover?.status === "PENDING" ? shift.handover : null;

        return NextResponse.json({
            shift: {
                id:       shift.id,
                status:   shift.status,
                openedAt: shift.openedAt,
                user:     shift.user,
                counter:  { id: shift.counter.id, name: shift.counter.name, tillAccount: { name: shift.counter.tillAccount.name } },
                branch:   shift.branch,
            },
            handover: pending ? {
                declaredByAPaise: pending.declaredByAPaise?.toString() ?? null,
                denominations:    parseHandoverDenominations(pending.denominationsJson),
                notes:            pending.notes,
                initiatedAt:      pending.initiatedAt,
            } : null,
            summary: await buildShiftSummary(prisma, shift),
        });
    } catch (e) {
        return handleApiError(e, "Failed to read the counter");
    }
}
