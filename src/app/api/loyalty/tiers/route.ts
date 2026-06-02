import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// GET /api/loyalty/tiers — the 4 spend-tier auto-discount rows (sorted by spend).
// Read-only to any authed user (POS / hub both read it); edits go through PATCH.
export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    try {
        const tiers = await prisma.loyaltyTier.findMany({ orderBy: { sortOrder: "asc" } });
        return NextResponse.json(tiers);
    } catch (e) {
        return handleApiError(e, "Failed to fetch tiers");
    }
}
