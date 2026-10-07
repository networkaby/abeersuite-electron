import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAuth } from "@/shared/lib/auth/permissions";

// GET /api/bill-notifications/<universalVoucherId> — how the customer was told
// about this bill: app notification (and whether the phone showed it) and
// WhatsApp. `{ notification: null }` when nothing was sent (walk-in, draft, or
// a bill from before this existed).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { user, response } = await requireAuth();
    if (response) return response;
    if ((user as { kind?: string }).kind === "customer") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const refId = Number((await params).id);
    if (!Number.isInteger(refId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const n = await prisma.billNotification.findUnique({
        where: { refId },
        select: { pushStatus: true, pushMessageId: true, waStatus: true, waError: true, mobile: true, createdAt: true },
    });
    if (!n) return NextResponse.json({ notification: null });

    const push = n.pushMessageId
        ? await prisma.pushMessage.findUnique({
            where: { id: n.pushMessageId },
            select: { sentAt: true, shownAt: true, clickedAt: true },
        })
        : null;

    return NextResponse.json({
        notification: {
            pushStatus: n.pushStatus,
            shownAt: push?.shownAt ?? null,
            clickedAt: push?.clickedAt ?? null,
            waStatus: n.waStatus,
            waError: n.waError,
            mobile: n.mobile,
            createdAt: n.createdAt,
        },
    });
}
