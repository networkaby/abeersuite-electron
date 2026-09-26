/**
 * Where a staff address forwards — Cloudflare Email Routing (cloudflareRouting.ts).
 *
 * The person themselves, or anyone with `users:edit` — the same rule as the password
 * route beside this one. Why it matters: staff addresses have no mailbox; until a
 * forward is set the zone's catch-all takes the mail, so a "Forgot password" code
 * reaches the office, not the person.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import {
    CloudflareError,
    getForwarding,
    isForwardingConfigured,
    isStaffMailAddress,
    setForwarding,
    STAFF_MAIL_DOMAIN,
} from "@/shared/lib/email/cloudflareRouting";

const schema = z.object({
    forwardTo: z.string().trim().toLowerCase().email("Enter a valid email address"),
    /** The part before the @ — a new one renames the sign-in address too. */
    handle: z.string().trim().toLowerCase()
        .regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/, "Handle: letters, numbers, dot, dash or underscore")
        .optional(),
});

type Params = { params: Promise<{ id: string }> };

/** The target's address, or the response that refuses the request. */
async function target(params: Params["params"]): Promise<{ email: string; response: null } | { email: null; response: NextResponse }> {
    const { user: caller, response } = await requireAuth();
    if (response) return { email: null, response };

    const userId = Number((await params).id);
    if (!Number.isInteger(userId)) return { email: null, response: NextResponse.json({ error: "Invalid user id" }, { status: 400 }) };
    if (caller.id !== userId && !hasPermissionWithScope(caller.permissions, PERMISSIONS.USERS_EDIT)) {
        return { email: null, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }

    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u) return { email: null, response: NextResponse.json({ error: "User not found" }, { status: 404 }) };
    if (!isStaffMailAddress(u.email)) {
        return { email: null, response: NextResponse.json({ error: `Only @${STAFF_MAIL_DOMAIN} addresses are forwarded.`, code: "NOT_STAFF_DOMAIN" }, { status: 400 }) };
    }
    if (!isForwardingConfigured()) {
        return { email: null, response: NextResponse.json({ error: "Mail forwarding is set from the office website.", code: "NOT_CONFIGURED" }, { status: 503 }) };
    }
    return { email: u.email, response: null };
}

/** Cloudflare's own refusal is worth showing; anything else stays generic. */
function failed(e: unknown, fallback: string) {
    if (e instanceof CloudflareError) {
        console.error(e.message);
        return NextResponse.json({ error: `Cloudflare refused: ${e.reason}` }, { status: 502 });
    }
    return handleApiError(e, fallback);
}

export async function GET(_req: Request, { params }: Params) {
    const { email, response } = await target(params);
    if (response) return response;
    try {
        return NextResponse.json({ address: email, ...await getForwarding(email) });
    } catch (e) {
        return failed(e, "Could not read the forwarding");
    }
}

export async function PUT(req: Request, { params }: Params) {
    const { email, response } = await target(params);
    if (response) return response;

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    // Forwarding into our own domain would loop, or hand the mail to a colleague.
    if (isStaffMailAddress(data.forwardTo)) {
        return NextResponse.json({ error: `Use a personal email, not an @${STAFF_MAIL_DOMAIN} one.` }, { status: 400 });
    }

    const address = data.handle ? `${data.handle}@${STAFF_MAIL_DOMAIN}` : email;
    const renamed = address !== email.toLowerCase();
    if (renamed) {
        const taken = await prisma.user.findFirst({ where: { email: { equals: address, mode: "insensitive" } }, select: { id: true } });
        if (taken) return NextResponse.json({ error: `${address} is already taken` }, { status: 409 });
    }

    try {
        // Forward first: a Cloudflare refusal must leave the login untouched, not
        // renamed to an address that goes nowhere. The old rule is handed over.
        const status = await setForwarding(address, data.forwardTo, renamed ? email : undefined);
        if (renamed) await prisma.user.update({ where: { id: Number((await params).id) }, data: { email: address } });
        return NextResponse.json({ address, ...status });
    } catch (e) {
        return failed(e, "Could not save the forwarding");
    }
}
