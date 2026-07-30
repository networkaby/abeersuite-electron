import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { findPortalPerson } from "@/shared/lib/auth/findPortalPerson";
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

        const person = await findPortalPerson(prisma, identity);
        return NextResponse.json({ exists: person !== null });
    } catch (e) {
        return handleApiError(e, "Could not check your details. Please try again.");
    }
}
