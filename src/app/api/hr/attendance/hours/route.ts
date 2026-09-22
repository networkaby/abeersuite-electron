import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { monthBounds } from "@/modules/hr/lib/attendanceCalendar";
import { loadHoursBreakup } from "@/modules/hr/lib/attendanceHoursServer";

/**
 * GET /api/hr/attendance/hours?userId=&from=&to= — one person's hour breakup.
 *
 * The drill-down behind a name in the register: every stretch they were active,
 * how many times, and the working that turns those minutes into a full day, a
 * half or an absence.
 *
 * Gated exactly as the register's own GET is — signed in, and the HR page's
 * permission is what decides who reaches the screen. This route shows nothing the
 * register does not already show for the same person; it only shows it broken up.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
    const { response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const userId = Number(searchParams.get("userId"));
        if (!Number.isInteger(userId) || userId <= 0) {
            return NextResponse.json({ error: "Which person?" }, { status: 400 });
        }
        const today = businessTodayIso();
        const cur = monthBounds(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
        const from = searchParams.get("from") ?? cur.from;
        const to = searchParams.get("to") ?? cur.to;
        if (!ISO.test(from) || !ISO.test(to) || to < from) {
            return NextResponse.json({ error: "Bad date range" }, { status: 400 });
        }

        const payload = await loadHoursBreakup(userId, from, to);
        if (!payload) return NextResponse.json({ error: "No such person" }, { status: 404 });
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the hours breakup");
    }
}
