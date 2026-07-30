import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { markSurfaceSeen } from "@/shared/lib/nav/navCounts";
import { ALL_NAV_SURFACES } from "@/shared/lib/nav/navSurfaces";
import { handleApiError } from "@/shared/lib/api";

/**
 * "I have looked at this list now." Each board posts its own surface on mount,
 * which resets the `new` half of that badge — and only that badge.
 */
export async function POST(req: Request) {
    const { user, response } = await requireAuth();
    if (response) return response;

    try {
        const { surface } = (await req.json()) as { surface?: string };
        if (!surface || !ALL_NAV_SURFACES.includes(surface)) {
            return NextResponse.json({ error: "Unknown surface" }, { status: 400 });
        }
        await markSurfaceSeen(user.id, surface);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return handleApiError(e, "Failed to mark surface seen");
    }
}
