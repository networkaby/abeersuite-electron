import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { excludingSuperAdmin } from "@/shared/lib/users/staffSelect";
import { staffHasLeft } from "@/shared/lib/hr/staffStatus";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import { COMMISSION_USER_SELECT, appliedHeadsFor, entriesByUser, loadHeads, monthFor, roleLabelOf, salesByUser } from "@/modules/hr/lib/commissionServer";
import type { CommissionBoardPayload, CommissionBoardRow } from "@/modules/hr/lib/commissionTypes";

// GET /api/hr/commission?month=YYYY-MM — the Targets & Commission board: the
// catalogue of heads, the roles a head can be limited to, and every current
// staff member with the heads that reach them and the month's own sales judged
// by them. One read for both tabs, one sales query for everyone.
//
// Writes live beside it: POST /heads, PATCH|DELETE /heads/[id], PUT /overrides.

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

        const [users, heads] = await Promise.all([
            prisma.user.findMany({
                where: excludingSuperAdmin(),
                orderBy: { name: "asc" },
                select: {
                    id: true, name: true, avatarUrl: true,
                    ...COMMISSION_USER_SELECT,
                    staffProfile: { select: { ...COMMISSION_USER_SELECT.staffProfile.select, staffCode: true, leftOn: true } },
                },
            }),
            loadHeads(prisma),
        ]);
        const live = users.filter((u) => !staffHasLeft(u.staffProfile, today));
        const ids = live.map((u) => u.id);
        const [tallies, entries] = await Promise.all([salesByUser(prisma, ids, from, to), entriesByUser(prisma, ids, from, to)]);

        let teamSalesPaise = 0;
        const rows: CommissionBoardRow[] = live.map((u) => {
            const role = roleLabelOf(u);
            const applied = appliedHeadsFor(heads, role, u.staffProfile?.commissionOverrides ?? [], entries.get(u.id) ?? []);
            const thisMonth = monthFor(applied, tallies.get(u.id), month, today, u.staffProfile?.weeklyOff ?? [0]);
            teamSalesPaise += thisMonth.salesPaise;
            return { userId: u.id, name: u.name, avatarUrl: u.avatarUrl, role, staffCode: u.staffProfile?.staffCode ?? null, thisMonth };
        });
        const payload: CommissionBoardPayload = {
            month, today, heads, rows, teamSalesPaise,
            roles: [...new Set(rows.map((r) => r.role).filter((r): r is string => !!r))].sort(),
        };
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the commission board");
    }
}
