import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { ensurePortalPerson, matchPortalPerson } from "@/shared/lib/auth/findPortalPerson";
import { resolvePortalIdentity } from "@/shared/lib/auth/authorizePortalPasswordless";

/**
 * Set the portal password for a **verified** mobile or email.
 *
 * One route for both "create my account" and "I forgot my password", because
 * once a token proves the identity they are the same operation: find or create
 * the Person, then write the password. Splitting them would only duplicate the
 * verification and the person lookup.
 *
 * ── Why a token is mandatory ────────────────────────────────────────────────
 * This route used to take a bare mobile/email and a password with nothing to
 * prove ownership. Because it links to an existing customer record by number,
 * anyone could type a customer's mobile, pick a password, and walk into that
 * customer's orders, invoices, wallet and repairs. So the identity now comes
 * only out of the OTP ticket (or a Google ID token) — never from the body.
 */

const bodySchema = z.object({
    /** OTP ticket from /api/portal/otp/verify, or a Firebase ID token. */
    token: z.string().min(1),
    password: z.string().min(6, "Password must be at least 6 characters"),
    /** Used only when we are creating the customer; never renames an existing one. */
    name: z.string().trim().optional(),
    /** Optional second contact offered on the create form. */
    extraContact: z.string().trim().optional(),
});

export async function POST(req: Request) {
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        const identity = await resolvePortalIdentity(data.token);
        if (!identity) {
            return NextResponse.json(
                { error: "Please verify your mobile or email again." },
                { status: 401 }
            );
        }

        // An unverified self-added contact cannot set or reset a password —
        // it proves nothing about who owns the profile it sits on.
        if ((await matchPortalPerson(prisma, identity)).status === "unverified") {
            return NextResponse.json(
                { error: "This contact is saved on a profile but not verified yet. Sign in with your password or a verified mobile/email, then verify it from My Profile." },
                { status: 403 }
            );
        }

        const person = await ensurePortalPerson(
            prisma,
            identity,
            data.name ?? "",
            data.extraContact ?? ""
        );
        const passwordHash = await bcrypt.hash(data.password, 10);

        // Fill in the channel column only when it is still empty, so signing in
        // by mobile keeps working after a reset done over email (and the other
        // way round) without ever stealing a column another person owns — both
        // are unique, hence the guarded write rather than a blind overwrite.
        const existing = await prisma.personPortalCredential.findUnique({
            where: { personId: person.id },
            select: { phoneNormalized: true, emailNormalized: true },
        });

        const channelColumns = {
            ...(identity.phoneNormalized && !existing?.phoneNormalized
                ? { phoneNormalized: identity.phoneNormalized }
                : {}),
            ...(identity.emailNormalized && !existing?.emailNormalized
                ? { emailNormalized: identity.emailNormalized }
                : {}),
        };

        try {
            await prisma.personPortalCredential.upsert({
                where: { personId: person.id },
                create: { personId: person.id, passwordHash, ...channelColumns },
                update: { passwordHash, ...channelColumns },
            });
        } catch {
            // The only way that fails is another credential already claiming this
            // mobile/email. The password itself must still land, so retry without
            // the channel columns.
            await prisma.personPortalCredential.upsert({
                where: { personId: person.id },
                create: { personId: person.id, passwordHash },
                update: { passwordHash },
            });
        }

        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Could not set your password. Please try again.");
    }
}
