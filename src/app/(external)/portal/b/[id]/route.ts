import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";

// GET /portal/b/<code> — the one short link every customer message carries
// (WhatsApp "View" button and the app notification alike).
//   <uvId>       a voucher: anything with a VoucherDetail (sale, return, order,
//                estimate) opens the bill page; a money voucher (receipt,
//                refund) opens the receipt page
//   t<ticketId>  a repair: My Repairs
//   due          a due reminder: My Bills → Outstanding (UPI pay)
// The pages check the signed-in customer owns the document, so this hop
// reveals nothing.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const code = (await params).id;
    const to = (path: string) => NextResponse.redirect(new URL(path, req.url));

    if (/^t\d+$/.test(code)) return to("/portal/repairs");
    // A due reminder's "Pay now": the balance with its UPI pay button.
    if (code === "due") return to("/portal/bills?tab=outstanding");

    const id = Number(code);
    if (!Number.isInteger(id) || id <= 0) return to("/portal/orders");
    const uv = await prisma.universalVoucher.findUnique({
        where: { id },
        select: { voucherDetail: { select: { id: true } } },
    });
    if (!uv) return to("/portal/orders");
    return to(uv.voucherDetail ? `/portal/orders/${uv.voucherDetail.id}/bill` : `/portal/receipts/${id}`);
}
