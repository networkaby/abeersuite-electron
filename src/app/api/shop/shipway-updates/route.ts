import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { shipwayStatusToStage } from "@/modules/delivery/lib/shipwayStatus";
import { mirrorStageToOrder } from "@/modules/delivery/lib/mirrorOrderStage";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";

// POST /api/shop/shipway-updates — Shipway tracking webhook.
//
// Configure in Shipway → Track → Tracking Webhooks → add this URL. Shipway's
// webhook form takes only a URL (no auth-header field), so the shared secret
// rides the query string: add ?token=<SHIPWAY_WEBHOOK_TOKEN> to the URL you
// register. Calls with a wrong/missing token are rejected when the env is set.
//
// Payload (apidocs.shipway.com → Webhooks): { awbno, scans_current_status,
// scans_current_status_time, carrier, pickupdate, … }. We map the scan text
// onto the P8 delivery stage for the matching AWB and mirror major milestones
// onto the P7 order (picked up → Dispatched, delivered → Delivered —
// forward-only). Always 200s so Shipway doesn't retry-flood.

type WebhookBody = {
    awbno?: string | number;
    awb?: string | number;
    scans_current_status?: string;
    current_status?: string;
    shipment_status?: string;
};

export async function POST(req: Request) {
    const expected = process.env.SHIPWAY_WEBHOOK_TOKEN?.trim();
    if (expected) {
        const got = new URL(req.url).searchParams.get("token")?.trim();
        if (got !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    try {
        const body = (await req.json().catch(() => ({}))) as WebhookBody;
        const awb = String(body.awbno ?? body.awb ?? "").trim();
        if (!awb) return NextResponse.json({ ok: true, skipped: "no awb" });

        const del = await prisma.ticketDelivery.findFirst({
            where: { awb },
            select: { ticketId: true, orderSource: true, orderId: true },
        });
        if (!del) return NextResponse.json({ ok: true, skipped: "unknown awb" });

        const stage = shipwayStatusToStage({
            code: body.shipment_status ?? null,
            status: body.scans_current_status ?? body.current_status ?? null,
        });
        if (stage) {
            await prisma.ticket.update({ where: { id: del.ticketId }, data: { status: stage } });
            await mirrorStageToOrder(del, stage, awb).catch(() => undefined);
            // Shipway posted straight here — no browser, so no axios interceptor to
            // announce the write. Published after both writes returned.
            void publishChangeServer(["tickets", "ledger"]);
        }
        return NextResponse.json({ ok: true, statusId: stage });
    } catch {
        // Never 500 a webhook — log-and-200.
        return NextResponse.json({ ok: true });
    }
}
