import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { isLikelyEmail, normalizeMobile10, normalizePortalEmail } from "@/shared/lib/auth/portalIdentifier";
import { resolvePortalIdentity } from "@/shared/lib/auth/authorizePortalPasswordless";
import { ContactConflictError, createEmail, createPhone, markEmailVerified, markPhoneVerified } from "@/modules/customer/lib/contactWrite";
import { bindLoginChannel, findOwnEmail, findOwnPhone, loadPortalProfile } from "@/shared/lib/portal/portalProfile";
import { mergeParty, MergeBlockedError } from "@/modules/customer/lib/convertParty";
import { requireCanonicalPhone } from "@/shared/lib/format/phone";
import { prisma } from "@/shared/lib/prisma/prismaClient";

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
 * A value that already sits on ANOTHER customer's profile:
 *   { value } → refused with code VERIFY_TO_MERGE — prove it first.
 *   { token } → the OTP proved this person owns it, so the other profile
 *               (typically made at the counter by mobile) is MERGED into the
 *               signed-in one: bills, ledger, points and contacts move here,
 *               the other row goes. The signed-in profile always survives so
 *               the session and its login stay valid. Companies and profiles
 *               the merge tool blocks are still refused — the shop's call.
 */

const bodySchema = z.union([
    z.object({ value: z.string().trim().min(3, "Enter a mobile number or email") }),
    z.object({ token: z.string().min(1) }),
]);

const ON_ANOTHER_PROFILE = "This contact is already on another customer's profile. Please ask the shop to sort it out.";
const VERIFY_TO_MERGE = "This contact is already with the shop under another profile. Verify it with a code to link that profile to this account.";

/**
 * The OTP proved `identity` is this customer's. If another active Person holds
 * it, merge that Person into `customerId`. Returns false when it cannot (owner
 * is a company, or the merge tool blocks it) — caller refuses as before.
 */
async function absorbProfileHolding(
    customerId: number,
    identity: { phoneNormalized?: string | null; emailNormalized?: string | null },
): Promise<boolean> {
    const row = identity.phoneNormalized
        ? await prisma.phone.findUnique({
            where: { phone: requireCanonicalPhone(identity.phoneNormalized) },
            select: { personId: true },
        })
        : identity.emailNormalized
            ? await prisma.email.findFirst({
                where: { email: { equals: identity.emailNormalized, mode: "insensitive" } },
                select: { personId: true },
            })
            : null;
    const otherId = row?.personId;
    if (!otherId || otherId === customerId) return false;
    try {
        await mergeParty("person", customerId, otherId);
        return true;
    } catch (e) {
        if (e instanceof MergeBlockedError) return false;
        throw e;
    }
}

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
            // Held by another profile → merge it in first; the contact then
            // arrives with it and the own-row branch below verifies it.
            const phoneOwn = identity.phoneNormalized ? await findOwnPhone(customerId, identity.phoneNormalized) : null;
            const emailOwn = identity.emailNormalized ? await findOwnEmail(customerId, identity.emailNormalized) : null;
            if (!phoneOwn && !emailOwn) await absorbProfileHolding(customerId, identity);

            if (identity.phoneNormalized) {
                const own = await findOwnPhone(customerId, identity.phoneNormalized);
                if (own) {
                    if (!own.verifiedAt) await markPhoneVerified(own.id);
                } else {
                    await createPhone({ personId: customerId }, { value: identity.phoneNormalized });
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
                await createPhone({ personId: customerId }, { value: digits, verified: false });
            }
        }

        const profile = await loadPortalProfile(customerId, context!.active.accountId);
        return NextResponse.json(profile, { status: 201 });
    } catch (e) {
        if (e instanceof ContactConflictError) {
            // A plain add can still be proved by OTP and merged; a proved one
            // reaching here was blocked from merging.
            return "token" in data
                ? NextResponse.json({ error: ON_ANOTHER_PROFILE }, { status: 409 })
                : NextResponse.json({ error: VERIFY_TO_MERGE, code: "VERIFY_TO_MERGE" }, { status: 409 });
        }
        return handleApiError(e, "Failed to add the contact");
    }
}
