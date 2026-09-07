import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// PATCH /api/portal/social/profile — the customer edits their own social profile
// (handle / cover / bio). Empty string clears cover or bio. The profile photo is
// Person.avatarUrl, edited through PATCH /api/portal/me.
const patchSchema = z.object({
    handle:    z.string().trim().min(3, "At least 3 characters").max(30, "Max 30 characters")
        .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscore only").optional(),
    coverUrl:  z.string().trim().url("Enter a valid URL").nullable().optional().or(z.literal("")),
    bio:       z.string().trim().max(500, "Max 500 characters").nullable().optional(),
});

export async function PATCH(req: Request) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const existing = await prisma.customerSocialProfile.findUnique({ where: { personId: customerId! }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Join social first." }, { status: 403 });

    const { data, error } = await validateRequest(req, patchSchema);
    if (error) return error;

    const update: { handle?: string; coverUrl?: string | null; bio?: string | null } = {};
    if (data.handle !== undefined) {
        const handle = data.handle.toLowerCase();
        const taken = await prisma.customerSocialProfile.findFirst({
            where:  { handle, NOT: { personId: customerId! } },
            select: { id: true },
        });
        if (taken) return NextResponse.json({ error: "That nickname is taken." }, { status: 409 });
        update.handle = handle;
    }
    if (data.coverUrl !== undefined) update.coverUrl = data.coverUrl ? data.coverUrl : null;
    if (data.bio !== undefined) update.bio = data.bio ? data.bio : null;

    try {
        const saved = await prisma.customerSocialProfile.update({
            where:  { personId: customerId! },
            data:   update,
            select: { handle: true, coverUrl: true, bio: true, joinedAt: true },
        });
        return NextResponse.json(saved);
    } catch (e) {
        return handleApiError(e, "Failed to save profile");
    }
}
