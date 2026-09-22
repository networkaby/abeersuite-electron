import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError, prismaUniqueError, validateRequest } from "@/shared/lib/api";
import { excludingSuperAdmin } from "@/shared/lib/users/staffSelect";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { commissionSchemeCreateSchema } from "@/shared/lib/schemas/hrSchema";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import { ensureStaffProfile, dateOnlyFromIso } from "@/modules/hr/lib/staffProfileServer";
import {
    COMMISSION_PROFILE_SELECT, loadGlobalSchemes, modeOf, monthFor, salesByUser, schemeInForce, schemesFor, toCommissionSchemeDto,
} from "@/modules/hr/lib/commissionServer";
import type { CommissionBoardPayload, CommissionBoardRow } from "@/modules/hr/lib/commissionTypes";

// /api/hr/commission — the Targets & Commission board.
//
// GET ?month=YYYY-MM  — the shop's scheme, then every current staff member:
//                       mode, own scheme and history, and the month's own
//                       sales judged by whichever scheme applies. One read for
//                       the board, one sales query for everyone.
// POST                — a new dated scheme: the shop's (userId null) or one
//                       person's. hr:staff:edit — a target is pay, the same
//                       key that writes a salary revision.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const today = businessTodayIso();
        const asked = new URL(req.url).searchParams.get("month");
        if (asked && !MONTH.test(asked)) return NextResponse.json({ error: "Bad month" }, { status: 400 });
        const month = asked ?? today.slice(0, 7);
        const { from, to } = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

        const [users, globalHistory] = await Promise.all([
            prisma.user.findMany({
                where: excludingSuperAdmin(),
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, avatarUrl: true,
                    staffProfile: { select: { staffCode: true, leftOn: true, weeklyOff: true, ...COMMISSION_PROFILE_SELECT } },
                },
            }),
            loadGlobalSchemes(prisma),
        ]);
        const live = users.filter((u) => !staffHasLeft(u.staffProfile, today));
        const tallies = await salesByUser(prisma, live.map((u) => u.id), from, to);

        let teamSalesPaise = 0;
        const rows: CommissionBoardRow[] = live.map((u) => {
            const mode = modeOf(u.staffProfile?.commissionMode);
            const history = (u.staffProfile?.commissionSchemes ?? []).map(toCommissionSchemeDto);
            const thisMonth = monthFor(mode, schemesFor(mode, history, globalHistory), tallies.get(u.id), month, today, u.staffProfile?.weeklyOff ?? [0]);
            teamSalesPaise += thisMonth.salesPaise;
            return {
                userId: u.id,
                name: u.name,
                avatarUrl: u.avatarUrl,
                staffCode: u.staffProfile?.staffCode ?? null,
                mode,
                own: schemeInForce(history, today),
                history,
                thisMonth,
            };
        });
        const payload: CommissionBoardPayload = {
            month, today, rows, teamSalesPaise,
            global: schemeInForce(globalHistory, today),
            globalHistory,
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the commission board");
    }
}

class NotFound extends Error {}

export async function POST(req: Request) {
    const { user: caller, response } = await requirePermission(PERMISSIONS.HR_STAFF_EDIT);
    if (response) return response;
    const { data: body, error } = await validateRequest(req, commissionSchemeCreateSchema);
    if (error) return error;
    try {
        const row = await prisma.$transaction(async (tx) => {
            if (body.userId !== null) {
                const user = await tx.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true } });
                if (!user) throw new NotFound();
                await ensureStaffProfile(tx, user);
            }
            return tx.commissionScheme.create({
                data: {
                    userId: body.userId,
                    effectiveFrom: dateOnlyFromIso(body.effectiveFrom),
                    rulesJson: body.rules,
                    note: body.note?.trim() || null,
                    createdById: caller.id,
                },
            });
        });
        return NextResponse.json(toCommissionSchemeDto(row));
    } catch (e) {
        if (e instanceof NotFound) return NextResponse.json({ error: "User not found" }, { status: 404 });
        const conflict = prismaUniqueError(e, "A scheme already starts on that date — delete it first, or pick another date");
        if (conflict) return conflict;
        return handleApiError(e, "Failed to save the scheme");
    }
}
