import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { isLikelyEmail, normalizeMobile10, normalizePortalEmail } from "@/shared/lib/auth/portalIdentifier";
import { resolvePortalIdentity } from "@/shared/lib/auth/authorizePortalPasswordless";
import { ContactConflictError, createEmail, createPhone, markEmailVerified, markPhoneVerified } from "@/modules/customer/lib/contactWrite";
import { bindLoginChannel, findOwnEmail, findOwnPhone, loadPortalProfile } from "@/shared/lib/portal/portalProfile";

/**
 * POST /api/portal/me/contacts — add a mobile/email to my own profile.
 *
 * Two shapes, one route:
 *   { value }  — plain add, saved UNVERIFIED. The shop can still find the
 *                customer by it at the counter, but it cannot be primary, sign
 *                in by OTP, or reset the password until verified.
 *   { token }  — an OTP ticket from /api/portal/otp/verify. The identity comes
 *                out of the ticket, never the body: it marks the matching own
 *                contact verified, or attaches it verified when it is new.
 *
 * A value that already sits on ANOTHER customer's profile is refused — the
 * portal never moves a contact between people; that is the shop's call.
 */

const bodySchema = z.union([
    z.object({ value: z.string().trim().min(3, "Enter a mobile number or email") }),
    z.object({ token: z.string().min(1) }),
]);

const ON_ANOTHER_PROFILE = "This contact is already on another customer's profile. Please ask the shop to sort it out.";

export async function POST(req: Request) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;
    const customerId = context!.customerId;

    const { data, error } = await validateRequest(req, bodySchema);
    if (error) return error;

    try {
        if ("token" in data) {
            const identity = await resolvePortalIdentity(data.token);
            if (!identity) {
                return NextResponse.json({ error: "Please verify the code again." }, { status: 401 });
            }
            if (identity.phoneNormalized) {
                const own = await findOwnPhone(customerId, identity.phoneNormalized);
                if (own) {
                    if (!own.verifiedAt) await markPhoneVerified(own.id);
                } else {
                    await createPhone({ personId: customerId }, { value: `+91${identity.phoneNormalized}` });
                }
            } else if (identity.emailNormalized) {
                const own = await findOwnEmail(customerId, identity.emailNormalized);
                if (own) {
                    if (!own.verifiedAt) await markEmailVerified(own.id);
                } else {
                    await createEmail({ personId: customerId }, { value: identity.emailNormalized });
                }
            }
            await bindLoginChannel(customerId, identity);
        } else {
            const raw = data.value;
            if (isLikelyEmail(raw)) {
                const email = normalizePortalEmail(raw);
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
                }
                if (await findOwnEmail(customerId, email)) {
                    return NextResponse.json({ error: "That email is already on your profile" }, { status: 409 });
                }
                await createEmail({ personId: customerId }, { value: email, verified: false });
            } else {
                const digits = normalizeMobile10(raw);
                if (!digits) {
                    return NextResponse.json({ error: "Enter a valid 10-digit mobile number" }, { status: 400 });
                }
                if (await findOwnPhone(customerId, digits)) {
                    return NextResponse.json({ error: "That mobile is already on your profile" }, { status: 409 });
                }
                await createPhone({ personId: customerId }, { value: `+91${digits}`, verified: false });
            }
        }

        const profile = await loadPortalProfile(customerId, context!.active.accountId);
        return NextResponse.json(profile, { status: 201 });
    } catch (e) {
        if (e instanceof ContactConflictError) {
            return NextResponse.json({ error: ON_ANOTHER_PROFILE }, { status: 409 });
        }
        return handleApiError(e, "Failed to add the contact");
    }
}
