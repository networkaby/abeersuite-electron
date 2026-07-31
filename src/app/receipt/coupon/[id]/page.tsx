import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { couponHeadline, couponValueText } from "@/modules/coupons/lib/couponShare";

// Standalone, print-friendly coupon design. Opened from the Coupons admin page;
// ReceiptButtons auto-prints on mount. Carries a scannable QR of the code.
export default async function CouponPrintPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const coupon = await prisma.coupon.findUnique({ where: { id: Number(id) } });
    if (!coupon || !coupon.code) notFound();

    const org = getOrganisation();
    const headline = couponHeadline(coupon);
    const value = couponValueText(coupon);
    const qrDataUrl = await QRCode.toDataURL(coupon.code, { width: 240, margin: 1, errorCorrectionLevel: "M" });

    return (
        <html>
            <head>
                <title>Coupon {coupon.code}</title>
                <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; color: #0f172a; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
          .card { width: 360px; border-radius: 22px; overflow: hidden; box-shadow: 0 18px 40px rgba(15,23,42,.25); background: #fff; }
          .hero { background: linear-gradient(135deg, #e11d48 0%, #be123c 55%, #9f1239 100%); color: #fff; padding: 22px 24px 26px; position: relative; }
          .hero::after { content: ""; position: absolute; right: -40px; top: -40px; width: 150px; height: 150px; border-radius: 50%; background: rgba(255,255,255,.08); }
          .brand { font-size: 15px; font-weight: 700; letter-spacing: .3px; }
          .label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: .85; margin-top: 2px; }
          .headline { font-size: 34px; font-weight: 800; line-height: 1.05; margin-top: 18px; }
          .name { font-size: 14px; opacity: .9; margin-top: 6px; }
          .body { padding: 20px 24px 22px; display: flex; gap: 18px; align-items: center; }
          .qr { width: 116px; height: 116px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 6px; background: #fff; flex-shrink: 0; }
          .qr img { width: 100%; height: 100%; display: block; }
          .meta { flex: 1; min-width: 0; }
          .code-cap { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; }
          .code { font-family: ui-monospace, "SF Mono", "Courier New", monospace; font-size: 20px; font-weight: 700; letter-spacing: 1px; margin-top: 2px; word-break: break-all; }
          .sub { font-size: 11px; color: #64748b; margin-top: 10px; line-height: 1.5; }
          .foot { border-top: 1px dashed #cbd5e1; padding: 12px 24px 16px; font-size: 10px; color: #94a3b8; text-align: center; }
          @media print {
            body { background: #fff; padding: 0; }
            .no-print { display: none !important; }
            .card { box-shadow: none; border: 1px solid #e2e8f0; }
          }
        `}</style>
            </head>
            <body>
                <div className="no-print" style={{ width: "360px" }}><ReceiptButtons /></div>

                <div className="card">
                    <div className="hero">
                        <div className="brand">{org.brandName}</div>
                        <div className="label">Coupon</div>
                        <div className="headline">{headline}</div>
                        <div className="name">{coupon.name}</div>
                    </div>
                    <div className="body">
                        <div className="qr">
                            {/* eslint-disable-next-line @next/next/no-img-element -- QR data-URL on a print receipt; next/image is inappropriate here */}
                            <img src={qrDataUrl} alt={`QR for ${coupon.code}`} />
                        </div>
                        <div className="meta">
                            <div className="code-cap">Code</div>
                            <div className="code">{coupon.code}</div>
                            <div className="sub">
                                {value}.
                                {coupon.minBillValue != null && Number(coupon.minBillValue) > 0 ? <><br />Min bill ₹{Number(coupon.minBillValue).toLocaleString("en-IN")}.</> : null}
                                {coupon.endsAt ? <><br />Valid until {coupon.endsAt.toISOString().slice(0, 10)}.</> : null}
                            </div>
                        </div>
                    </div>
                    <div className="foot">
                        {org.brandName}{org.phone ? ` · ${org.phone}` : ""}{org.whatsapp ? ` · WhatsApp ${org.whatsapp}` : ""}
                    </div>
                </div>
            </body>
        </html>
    );
}
