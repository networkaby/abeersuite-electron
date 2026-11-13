import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { shipwayStatusToStage } from "@/modules/delivery/lib/shipwayStatus";
import { mirrorStageToOrder } from "@/modules/delivery/lib/mirrorOrderStage";
import { publishChangeServer } from "@/shared/lib/realtime/serverPublish";
import { timingSafeEqual } from "crypto";
import { incomingSecret } from "@/modules/incoming/lib/incomingApi";

// POST /api/shop/shipway-updates — Shipway tracking webhook.
//
// Configure in Shipway → Track → Tracking Webhooks → add this URL. Shipway's
// webhook form takes only a URL (no auth-header field), so the shared secret
// rides the query string: add ?token=<key> to the URL you register. The key is
// set on Settings → Incoming API → Shipway (else SHIPWAY_WEBHOOK_TOKEN); calls with
// a wrong/missing token are rejected once one is set.
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
    // Settings → Incoming API (switched off there = refuse), else SHIPWAY_WEBHOOK_TOKEN.
    const { value: expected, enabled } = await incomingSecret("SHIPWAY");
    if (!enabled) return NextResponse.json({ ok: false, error: "switched off" }, { status: 403 });
    if (expected) {
        const got = new URL(req.url).searchParams.get("token")?.trim() ?? "";
        const a = Buffer.from(got);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
