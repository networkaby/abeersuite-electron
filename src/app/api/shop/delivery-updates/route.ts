import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { shiprocketStatusToStage } from "@/modules/delivery/lib/shiprocketStatus";
import { mirrorStageToOrder } from "@/modules/delivery/lib/mirrorOrderStage";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

// POST /api/shop/delivery-updates — carrier tracking callback (used by Shiprocket).
//
// NOTE: the path deliberately avoids the words "shiprocket", "kartrocket", "sr",
// "kr" — Shiprocket rejects webhook URLs containing those keywords.
//
// Configure this URL in Shiprocket → Settings → Additional Settings → Webhooks,
// pick Auth Token Type "x-api-key", and set a Token there; Shiprocket sends it as
// the `x-api-key` header. We reject calls whose header doesn't match
// SHIPROCKET_WEBHOOK_TOKEN (when that env is set). The payload carries the AWB +
// current status; we map it onto the P8 delivery stage for the matching delivery
// and mirror major milestones onto the P7 order (picked up → Dispatched,
// delivered → Delivered — forward-only). Always returns 200 quickly (Shiprocket
// requirement).

type WebhookBody = {
    awb?: string;
    current_status?: string;
    current_status_id?: number;
    shipment_status?: string;
    shipment_status_id?: number;
};

export async function POST(req: Request) {
    // Verify the shared secret when configured. When it's unset (dev), accept.
    const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN?.trim();
    if (expected) {
        const got = req.headers.get("x-api-key")?.trim();
        if (got !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    try {
        const body = (await req.json().catch(() => ({}))) as WebhookBody;
        const awb = body.awb?.trim();
        if (!awb) return NextResponse.json({ ok: true, skipped: "no awb" });

        const del = await prisma.ticketDelivery.findFirst({
            where: { awb },
            select: { ticketId: true, orderSource: true, orderId: true },
        });
        if (!del) return NextResponse.json({ ok: true, skipped: "unknown awb" });

        const stage = shiprocketStatusToStage({
            statusId: body.current_status_id ?? body.shipment_status_id ?? null,
            status: body.current_status ?? body.shipment_status ?? null,
        });
        if (stage) {
            await prisma.ticket.update({ where: { id: del.ticketId }, data: { status: stage } });
            await mirrorStageToOrder(del, stage, awb).catch(() => undefined);
            // The courier posted straight here — no browser, so no axios interceptor
            // to announce the write. Published after both writes returned.
            void publishChangeServer(["tickets", "ledger"]);
        }
        return NextResponse.json({ ok: true, statusId: stage });
    } catch {
        // Never 500 a webhook — Shiprocket retries and floods. Log-and-200.
        return NextResponse.json({ ok: true });
    }
}
