import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { matchPortalPerson } from "@/shared/lib/auth/findPortalPerson";
import { resolvePortalIdentity } from "@/shared/lib/auth/authorizePortalPasswordless";

/**
 * "Do you already know this verified person?" — asked between verifying an OTP
 * and signing in, so the UI knows whether to show the onboarding form.
 *
 * Requires a valid token, so it cannot be used to probe whether an arbitrary
 * mobile/email is registered: you must already have passed OTP or Google for
 * that identity before this route will tell you anything about it.
 */

const bodySchema = z.object({
    token: z.string().min(1),
});

export async function POST(req: Request) {
    try {
        const { data, error } = await validateRequest(req, bodySchema);
        if (error) return error;

        // The channel is read out of the token itself, not sent by the client.
        const identity = await resolvePortalIdentity(data.token);
        if (!identity) {
            return NextResponse.json({ error: "Verification failed" }, { status: 401 });
        }

        // `unverified` = on file, but only as a contact the customer typed into
        // the portal without an OTP. It must not create a second customer, and
        // it must not sign in — the UI explains how to verify it instead.
        const match = await matchPortalPerson(prisma, identity);
        return NextResponse.json({ exists: match.status === "found", unverified: match.status === "unverified" });
    } catch (e) {
        return handleApiError(e, "Could not check your details. Please try again.");
    }
}
