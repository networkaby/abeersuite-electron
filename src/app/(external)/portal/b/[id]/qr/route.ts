import QRCode from "qrcode";
import { decodeUpiPayCode, upiDeepLink } from "@/modules/pos/lib/upiPayLink";

// GET /portal/b/p<signed>/qr — the UPI QR as a PNG: the photo header of the
// PAY_REQUEST WhatsApp template. Meta fetches it at send time; the signed code
// carries the VPA + amount, so nothing is stored (no R2, no DB).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const r = decodeUpiPayCode((await params).id);
    if (!r) return new Response("Not found", { status: 404 });
    const png = await QRCode.toBuffer(upiDeepLink(r), { type: "png", width: 640, margin: 4, errorCorrectionLevel: "M" });
    return new Response(new Uint8Array(png), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, immutable" },
    });
}
