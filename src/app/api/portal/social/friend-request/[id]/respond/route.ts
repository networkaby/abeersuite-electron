import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePortalCustomer } from "@/shared/lib/auth/portalAuthGuard";
import { validateRequest, handleApiError } from "@/shared/lib/api";

// POST /api/portal/social/friend-request/[id]/respond — the addressee accepts or
// declines a pending request. Accept → ACCEPTED; decline → row removed.
const schema = z.object({ accept: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { customerId, response } = await requirePortalCustomer();
    if (response) return response;

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const { data, error } = await validateRequest(req, schema);
    if (error) return error;

    const conn = await prisma.socialConnection.findUnique({ where: { id }, select: { id: true, addresseeId: true, status: true } });
    if (!conn || conn.addresseeId !== customerId || conn.status !== "PENDING") {
        return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    try {
        if (data.accept) {
            await prisma.socialConnection.update({ where: { id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
        } else {
            await prisma.socialConnection.delete({ where: { id } });
        }
        return NextResponse.json({ accepted: data.accept });
    } catch (e) {
        return handleApiError(e, "Failed to respond");
    }
}
