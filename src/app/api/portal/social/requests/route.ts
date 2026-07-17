import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { handleApiError } from "@/shared/lib/api";
import { resolveSocialActors, socialKey } from "@/shared/lib/social/socialActor";

// GET /api/portal/social/requests — incoming pending friend requests for the
// signed-in customer.
export async function GET() {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    try {
        const rows = await prisma.socialConnection.findMany({
            where:   { addresseeId: customerId!, status: "PENDING" },
            orderBy: { createdAt: "desc" },
            select:  { id: true, requesterId: true, createdAt: true },
        });
        const actors = await resolveSocialActors(rows.map((r) => ({ kind: "PERSON" as const, id: r.requesterId })));
        const requests = rows.map((r) => ({
            requestId: r.id,
            createdAt: r.createdAt,
            from: actors.get(socialKey("PERSON", r.requesterId))!,
        }));
        return NextResponse.json(requests);
    } catch (e) {
        return handleApiError(e, "Failed to load requests");
    }
}
