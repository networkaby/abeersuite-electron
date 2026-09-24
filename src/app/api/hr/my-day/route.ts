import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { buildMyDay } from "@/modules/hr/lib/myDayServer";

/**
 * GET /api/hr/my-day — "how was my day?", answered to the person who worked it.
 *
 * Owner, 2026-09-22: the counter hand should be able to assess his own work. Until
 * now every one of these numbers existed only in the office register, so the man
 * being measured was the one person who could not see the measurement. This is
 * read at sign-out and shown on the login screen.
 *
 * No permission tick, and none is missing: it answers for the SIGNED-IN USER ONLY,
 * never takes a userId, and being signed in is the credential — the same reasoning
 * as `/api/hr/activity`.
 *
 * Counter only, like the measuring itself — off a till nothing is recorded (see
 * TRACK_OFF_COUNTER), so `tracked: false` comes back and the screen shows nothing
 * rather than an honest-looking zero.
 */

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        if (thisCounterId() === null) {
            return NextResponse.json({ tracked: false });
        }
        return NextResponse.json(await buildMyDay(Number(user!.id)));
    } catch (e) {
        return handleApiError(e);
    }
}
