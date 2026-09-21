import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";
import { stampActivity } from "@/shared/lib/hr/attendanceStamp";
import { thisCounterId } from "@/shared/lib/auth/counterPin";

/**
 * POST /api/hr/activity — "somebody is still here".
 *
 * The client calls this every few minutes ONLY while there has been real input
 * since the last call (ActivityPulse). It must never be called from a poll or a
 * heartbeat: this is the one signal that separates a person at the counter from a
 * machine left switched on, and crediting an empty till would pay for it.
 *
 * No permission tick — being signed in IS the credential, and every signed-in
 * person has a working day. Deliberately tiny: one read, one write, no payload.
 * Errors are swallowed by the stamp itself; a clock must never break a screen.
 */
export async function POST() {
    const { user, response } = await requireAuth();
    if (response) return response;
    try {
        const workedMinutes = await stampActivity(prisma, Number(user!.id), thisCounterId());
        return NextResponse.json({ workedMinutes });
    } catch (e) {
        return handleApiError(e);
    }
}
