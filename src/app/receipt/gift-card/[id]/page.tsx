import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";

// Standalone, print-friendly "beautiful" gift-card design. Opened in a new tab
// from the Gift Cards admin page; ReceiptButtons auto-prints on mount. Carries a
// scannable QR of the code plus the human-readable code for POS redemption.
export default async function GiftCardPrintPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    const card = await prisma.giftCard.findUnique({
        where: { id: Number(id) },
        include: { ownerAccount: { select: { name: true } } },
    });
    if (!card) notFound();

    const org = getOrganisation();
    const value = Number(card.balance);
    const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qrDataUrl = await QRCode.toDataURL(card.code, { width: 240, margin: 1, errorCorrectionLevel: "M" });

    return (
        <html>
            <head>
                <title>Gift Card {card.code}</title>
                <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; color: #0f172a; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
          .card { width: 360px; border-radius: 22px; overflow: hidden; box-shadow: 0 18px 40px rgba(15,23,42,.25); background: #fff; }
          .hero { background: linear-gradient(135deg, #0d9488 0%, #0f766e 55%, #115e59 100%); color: #fff; padding: 22px 24px 26px; position: relative; }
          .hero::after { content: ""; position: absolute; right: -40px; top: -40px; width: 150px; height: 150px; border-radius: 50%; background: rgba(255,255,255,.08); }
          .brand { font-size: 15px; font-weight: 700; letter-spacing: .3px; }
          .label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: .85; margin-top: 2px; }
          .value-cap { font-size: 11px; opacity: .85; margin-top: 22px; }
          .value { font-size: 40px; font-weight: 800; line-height: 1; margin-top: 2px; }
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
                        <div className="label">Gift Card</div>
                        <div className="value-cap">VALUE</div>
                        <div className="value">₹{fmtAmt(value)}</div>
                    </div>
                    <div className="body">
                        <div className="qr">
                            {/* eslint-disable-next-line @next/next/no-img-element -- QR data-URL on a print receipt; next/image is inappropriate here */}
                            <img src={qrDataUrl} alt={`QR for ${card.code}`} />
                        </div>
                        <div className="meta">
                            <div className="code-cap">Redeem code</div>
                            <div className="code">{card.code}</div>
                            <div className="sub">
                                Scan or enter this code at checkout.
                                {card.ownerAccount ? <> For {card.ownerAccount.name}.</> : null}
                                {card.expiresAt ? <><br />Valid until {card.expiresAt.toISOString().slice(0, 10)}.</> : null}
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
