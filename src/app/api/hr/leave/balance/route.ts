import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { handleApiError } from "@/shared/lib/api";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import { leaveBalancesFor } from "@/modules/hr/lib/leaveBalance";
import type { LeaveBalancePayload } from "@/modules/hr/lib/leaveTypes";

/**
 * GET /api/hr/leave/balance?userId=&on=YYYY-MM-DD — how much leave is left.
 *
 * Without `userId` it answers about the signed-in person, and needs no grant: a
 * person is entitled to know his own balance, the same reasoning `/api/hr/my-day`
 * follows. Asking about SOMEBODY ELSE needs `hr:leave:approve`, because that is the
 * one role with a reason to know — HR cannot decide a request without seeing what
 * the person has already spent.
 *
 * `on` picks the leave year (1 April → 31 March); it defaults to today.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const { searchParams } = new URL(req.url);
        const asked = searchParams.get("userId");
        const on = searchParams.get("on") ?? businessTodayIso();
        if (!ISO.test(on)) return NextResponse.json({ error: "Bad date" }, { status: 400 });

        let userId = user.id;
        if (asked) {
            const n = Number(asked);
            if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
            if (n !== user.id && !hasPermissionWithScope(user.permissions, PERMISSIONS.HR_LEAVE_APPROVE)) {
                return NextResponse.json({ error: "Only HR may read somebody else's leave balance" }, { status: 403 });
            }
            userId = n;
        }

        const payload: LeaveBalancePayload = await leaveBalancesFor(userId, on);
        return NextResponse.json(payload);
    } catch (e) {
        return handleApiError(e, "Failed to read the leave balance");
    }
}
