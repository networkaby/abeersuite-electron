import { NextResponse } from "next/server";
import { resolveCustomerLink } from "@/modules/external/portal/portalDocAccess";

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
    const link = await resolveCustomerLink((await params).id);
    const path =
        link.to === "repairs" ? "/portal/repairs"
        : link.to === "due" ? "/portal/bills?tab=outstanding"
        : link.to === "bill" ? `/portal/orders/${link.detailId}/bill`
        : link.to === "receipt" ? `/portal/receipts/${link.uvId}`
        : "/portal/orders";
    return NextResponse.redirect(new URL(path, req.url));
}
