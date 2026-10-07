import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";

type RouteCtx = { params: Promise<{ id: string }> };

/** Staff only — a customer session never reads delivery records. */
async function staff() {
    const { user, response } = await requireAuth();
    if (response) return response;
    if ((user as { kind?: string }).kind === "customer") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
}

async function readStatus(refId: number) {
    // Repair rows carry Ticket ids in refId — a voucher lookup must skip them.
    const n = await prisma.billNotification.findFirst({
        where: { refId, kind: { notIn: ["REPAIR_RECEIVED", "REPAIR_READY"] } },
        select: { pushStatus: true, pushMessageId: true, waStatus: true, waError: true, mobile: true, createdAt: true },
    });
    if (!n) return null;
    const push = n.pushMessageId
        ? await prisma.pushMessage.findUnique({
            where: { id: n.pushMessageId },
            select: { shownAt: true, clickedAt: true },
        })
        : null;
    return {
        pushStatus: n.pushStatus,
        shownAt: push?.shownAt ?? null,
        clickedAt: push?.clickedAt ?? null,
        waStatus: n.waStatus,
        waError: n.waError,
        mobile: n.mobile,
        createdAt: n.createdAt,
    };
}

// GET /api/bill-notifications/<universalVoucherId> — how the customer was told
// about this document: app notification (and whether the phone showed it) and
// WhatsApp. `{ notification: null }` when nothing was sent (walk-in, draft, an
// estimate nobody sent, or a document from before this existed).
export async function GET(_req: Request, { params }: RouteCtx) {
    const denied = await staff();
    if (denied) return denied;
    const refId = Number((await params).id);
    if (!Number.isInteger(refId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    return NextResponse.json({ notification: await readStatus(refId) });
}
