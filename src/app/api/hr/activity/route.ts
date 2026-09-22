import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { stampActivity } from "@/shared/lib/hr/attendanceStamp";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { TRACK_OFF_COUNTER, idleLimitMsFor } from "@/shared/lib/hr/dutyTime";

/**
 * POST /api/hr/activity — "somebody is still here".
 *
 * The client calls this every few minutes ONLY while there has been real input
 * since the last call (ActivityPulse). It must never be called from a poll or a
 * heartbeat: this is the one signal that separates a person at the counter from a
 * machine left switched on, and crediting an empty till would pay for it.
 *
 * Optional body: { lastInputAt } — the instant of the caller's last real keypress
 * or click, which only the browser knows. Send it on EVERY call, including the one
 * made as an idle sign-out begins: that is the case where the tail would otherwise
 * be lost for certain. The server clamps it to now, so it can only ever credit
 * less than omitting it would, and the idle-limit cap still applies on top — a
 * client that lies about it can rob itself and nobody else.
 *
 * No permission tick — being signed in IS the credential, and every signed-in
 * person has a working day. Deliberately tiny: one read, one write.
 * Errors are swallowed by the stamp itself; a clock must never break a screen.
 */
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        // A body is optional and a malformed one is not worth a 400 — this route
        // exists to keep a clock, and refusing the beat is worse than ignoring a
        // field. Anything unparseable simply behaves as the old no-payload call.
        const body = (await req.json().catch(() => ({}))) as { lastInputAt?: unknown };
        const lastInputAt =
            typeof body.lastInputAt === "string" || typeof body.lastInputAt === "number"
                ? new Date(body.lastInputAt)
                : null;

        const counterId = thisCounterId();
        // Off a counter, nothing is recorded yet — see TRACK_OFF_COUNTER. Answering
        // 200 with no minutes keeps the client simple: it pulses either way and does
        // not need to know where it is running.
        if (counterId === null && !TRACK_OFF_COUNTER) return NextResponse.json({ workedMinutes: 0, tracked: false });

        // The same limit the client is counting down, taken from the session rather
        // than read again — the two must agree or a gap the client called work would
        // be dropped here as idle.
        const workedMinutes = await stampActivity(
            prisma, Number(user!.id), counterId, new Date(), idleLimitMsFor(user!.idleLimitMinutes), lastInputAt,
        );
        return NextResponse.json({ workedMinutes });
    } catch (e) {
        return handleApiError(e);
    }
}
