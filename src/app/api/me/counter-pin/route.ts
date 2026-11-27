/**
 * The server's small part in a counter PIN — which itself never comes here.
 *
 * Since 2026-11-27 a PIN lives only on the counter PC (`electron/pinVault.ts`): the
 * owner did not want it beside the password in a database. What the server does:
 *
 *  • `POST { password }` — "Set PIN", or a password sign-in renewing one: checks the
 *    password of the person signed in and answers with their email and a signed note
 *    of this password sign-in on this counter (`counterResume.ts`). The PC keeps the
 *    note behind the PIN. Read from the replica, so it works with the line down.
 *  • `DELETE` — "Sign out everywhere": ends every login of this person, and every
 *    PIN note on every counter with it.
 *
 * Only for yourself — there is no id to aim at anybody else. Never relayed
 * (`relayPolicy.ts`): the note is for this counter.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { thisCounterId } from "@/shared/lib/auth/counterPin";
import { issueResumeGrant } from "@/shared/lib/auth/counterResume";
import { revokeUserSessions } from "@/shared/lib/auth/revokeSessions";

const schema = z.object({ password: z.string().min(1, "Enter your password") });

export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const counterId = thisCounterId();
    if (!counterId) {
        return NextResponse.json({ error: "A PIN can only be set on a counter.", code: "NOT_A_COUNTER" }, { status: 400 });
    }
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    try {
        const row = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, password: true } });
        if (!row || !await bcrypt.compare(data.password, row.password)) {
            return NextResponse.json({ error: "That password is not right." }, { status: 403 });
        }
        return NextResponse.json({
            email: row.email,
            grant: issueResumeGrant({ uid: row.id, cid: counterId, at: Date.now() }),
        });
    } catch (e) {
        return handleApiError(e, "Could not check your password");
    }
}

export async function DELETE() {
    const { user, response } = await requireAuth();
    if (response) return response;
    await revokeUserSessions(user.id);
    return NextResponse.json({ success: true });
}
