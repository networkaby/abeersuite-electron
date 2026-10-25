import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { resolveCustomerLink } from "@/modules/external/portal/portalDocAccess";
import { decodeUpiPayCode, isUpiPayCode, upiDeepLink, type UpiPayRequest } from "@/modules/pos/lib/upiPayLink";
import { DEFAULT_PAYEE_NAME } from "@/modules/pos/lib/paymentLink";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { loadCurrencySymbol } from "@/shared/lib/format/currencySymbol.server";

// GET /portal/b/<code> — the one short link every customer message carries
// (WhatsApp "View" button and the app notification alike).
//   <uvId>       a voucher: anything with a VoucherDetail (sale, return, order,
//                estimate) opens the bill page; a money voucher (receipt,
//                refund) opens the receipt page
//   t<ticketId>  a repair: My Repairs
//   due          a due reminder: My Bills → Outstanding (UPI pay)
//   p<signed>    a UPI payment request's Pay now: a page that opens the UPI app
// The pages check the signed-in customer owns the document, so this hop
// reveals nothing.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const code = (await params).id;
    if (isUpiPayCode(code)) return payPage(decodeUpiPayCode(code));
    const link = await resolveCustomerLink(code);
    const path =
        link.to === "repairs" ? "/portal/repairs"
        : link.to === "due" ? "/portal/bills?tab=outstanding"
        : link.to === "bill" ? `/portal/orders/${link.detailId}/bill`
        : link.to === "receipt" ? `/portal/receipts/${link.uvId}`
        : "/portal/orders";
    return NextResponse.redirect(new URL(path, req.url));
}

const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// A bare page, not a React route: it must open fast inside WhatsApp's in-app
// browser. Android opens the UPI app chooser from the button (and tries once on
// load); a PC or iPhone without a UPI app scans the QR or copies the UPI ID.
async function payPage(r: UpiPayRequest | null): Promise<Response> {
    if (!r) {
        return new Response(shell("<h1>Link not valid</h1><p>Please ask the shop for a fresh payment link.</p>"), {
            status: 400,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    }
    await loadCurrencySymbol();
    const upi = upiDeepLink(r);
    const qr = await QRCode.toDataURL(upi, { width: 480, margin: 1, errorCorrectionLevel: "M" });
    const body = `
<p class="muted">Pay to ${esc(DEFAULT_PAYEE_NAME)}</p>
<h1>${esc(formatInr(r.amount))}</h1>
${r.note ? `<p class="muted">${esc(r.note)}</p>` : ""}
<a class="btn" href="${esc(upi)}">Pay now with UPI app</a>
<p class="muted small">GPay · PhonePe · Paytm · BHIM · any UPI app</p>
<img src="${qr}" alt="UPI QR" width="240" height="240">
<p class="small">Or scan this QR from another phone</p>
<button class="ghost" onclick="navigator.clipboard&&navigator.clipboard.writeText(${esc(JSON.stringify(r.vpa))}).then(()=>this.textContent='UPI ID copied')">Copy UPI ID: ${esc(r.vpa)}</button>
<script>if(/Android/i.test(navigator.userAgent))setTimeout(function(){location.href=${JSON.stringify(upi)}},400)</script>`;
    return new Response(shell(body), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=86400, immutable" },
    });
}

function shell(inner: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Pay by UPI</title>
<style>body{margin:0;font-family:system-ui,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;display:flex;justify-content:center}
main{max-width:380px;width:100%;padding:32px 16px;text-align:center}h1{font-size:40px;margin:4px 0 8px}
.muted{color:#475569;margin:4px 0}.small{font-size:13px;color:#64748b}
.btn{display:block;background:#128C7E;color:#fff;text-decoration:none;font-weight:600;padding:16px;border-radius:12px;margin:20px 0 6px;font-size:18px}
img{background:#fff;padding:8px;border-radius:12px;margin-top:16px}
.ghost{margin-top:12px;background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:10px 14px;font-size:14px;width:100%}</style>
</head><body><main>${inner}</main></body></html>`;
}
