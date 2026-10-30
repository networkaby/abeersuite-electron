import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { handleApiError, validateRequest } from "@/shared/lib/api";
import { requirePortalAccountContext } from "@/shared/lib/auth/portalAuthGuard";
import { loadPortalProfile } from "@/shared/lib/portal/portalProfile";

/**
 * GET  /api/portal/me — the signed-in customer's own profile (see PortalProfile).
 * PATCH /api/portal/me — name / photo (addresses: /api/portal/addresses). The customer owns these now;
 * staff can still change them from the office. A rename also renames the
 * personal Account, which is the name that prints on bills.
 */

const patchSchema = z.object({
    name: z.string().trim().min(2, "Enter your name").max(120).optional(),
    /** Cloudinary URL from /api/portal/upload-signature; empty string clears. */
    avatarUrl: z.string().trim().url("Enter a valid image URL").nullable().optional().or(z.literal("")),
});

export async function GET() {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;

    try {
        const profile = await loadPortalProfile(context!.customerId, context!.active.accountId);
        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
        return NextResponse.json(profile);
    } catch (e) {
        return handleApiError(e, "Failed to load your profile");
    }
}

export async function PATCH(req: Request) {
    const { context, response } = await requirePortalAccountContext();
    if (response) return response;

    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;

    const customerId = context!.customerId;
    try {
        await prisma.$transaction(async (tx) => {
            await tx.person.update({
                where: { id: customerId },
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl || null }),
                },
            });
            if (data.name !== undefined) {
                await tx.account.updateMany({ where: { personId: customerId }, data: { name: data.name } });
            }
        });
        const profile = await loadPortalProfile(customerId, context!.active.accountId);
        return NextResponse.json(profile);
    } catch (e) {
        return handleApiError(e, "Failed to save your profile");
    }
}
