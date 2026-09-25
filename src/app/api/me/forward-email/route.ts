/**
 * Your own mail forwarding. Nobody else's — like `/api/me/counter-pin`, there is no id
 * to pass, so it can only ever touch the signed-in person's own address.
 *
 * Why it matters: staff addresses have no mailbox; without a forward, a
 * "Forgot password" mail goes nowhere.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import {
    getForwarding,
    isForwardingConfigured,
    isStaffMailAddress,
    setForwarding,
    STAFF_MAIL_DOMAIN,
} from "@/shared/lib/email/cloudflareRouting";

const schema = z.object({
    forwardTo: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/** The session carries no email — read the account's own. */
async function myEmail(userId: number): Promise<string> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email ?? "";
}

/** Why this person cannot use forwarding here, or null when they can. */
function blocked(email: string) {
    if (!isStaffMailAddress(email)) {
        return NextResponse.json({ error: `Only @${STAFF_MAIL_DOMAIN} addresses are forwarded.`, code: "NOT_STAFF_DOMAIN" }, { status: 400 });
    }
    if (!isForwardingConfigured()) {
        return NextResponse.json({ error: "Mail forwarding is set from the office website.", code: "NOT_CONFIGURED" }, { status: 503 });
    }
    return null;
}

export async function GET() {
    const { user, response } = await requireAuth();
    if (response) return response;
    const email = await myEmail(user.id);
    const no = blocked(email);
    if (no) return no;
    try {
        return NextResponse.json({ address: email, ...await getForwarding(email) });
    } catch (e) {
        return handleApiError(e, "Could not read your forwarding");
    }
}

export async function PUT(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;
    const email = await myEmail(user.id);
    const no = blocked(email);
    if (no) return no;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    // Forwarding into our own domain would loop, or hand the mail to a colleague.
    if (isStaffMailAddress(data.forwardTo)) {
        return NextResponse.json({ error: `Use your personal email, not an @${STAFF_MAIL_DOMAIN} one.` }, { status: 400 });
    }

    try {
        return NextResponse.json({ address: email, ...await setForwarding(email, data.forwardTo) });
    } catch (e) {
        return handleApiError(e, "Could not save your forwarding");
    }
}
