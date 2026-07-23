import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { handleApiError } from "@/shared/lib/api";

// POST /api/deliveries/[id]/shipway/label — return the courier's official
// shipping-label PDF for this booked Shipway shipment. Shipway issues the URL
// only in the booking response (no re-fetch API), so it's read from the
// labelUrl stamped on the delivery's address snapshot at booking time.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const { response } = await requireAuth();
    if (response) return response;

    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    try {
        const del = await prisma.ticketDelivery.findUnique({
            where: { ticketId: id },
            select: { awb: true, addressJson: true },
        });
        if (!del?.awb) {
            return NextResponse.json({ error: "Book the courier first — no AWB yet." }, { status: 400 });
        }
        const labelUrl = String((del.addressJson as { labelUrl?: unknown } | null)?.labelUrl ?? "").trim();
        if (!labelUrl) {
            return NextResponse.json(
                { error: "No label was stored for this shipment — download it from the Shipway panel." },
                { status: 404 },
            );
        }
        return NextResponse.json({ ok: true, labelUrl });
    } catch (e) {
        return handleApiError(e, "Failed to fetch the shipping label");
    }
}
