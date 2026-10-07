import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";

// GET /portal/b/<universalVoucherId> — the one short link a bill message
// carries (WhatsApp "View bill" button and the app notification alike).
// Sends the customer to the page for that voucher: a sale has a VoucherDetail
// and opens the bill page, a receipt opens the receipt page. Both pages check
// the signed-in customer owns the voucher, so this hop reveals nothing.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const id = Number((await params).id);
    const fallback = new URL("/portal/orders", req.url);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.redirect(fallback);

    const uv = await prisma.universalVoucher.findUnique({
        where: { id },
        select: { voucherDetail: { select: { id: true } } },
    });
    if (!uv) return NextResponse.redirect(fallback);
    const dest = uv.voucherDetail ? `/portal/orders/${uv.voucherDetail.id}/bill` : `/portal/receipts/${id}`;
    return NextResponse.redirect(new URL(dest, req.url));
}
