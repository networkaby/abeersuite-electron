import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { cardCss, cardFootText } from "@/shared/components/print/CouponCard";

// Printable gift card — its own design (teal hero with the value, QR + redeem
// code). Shares only the card CSS rules with the coupon (same 360px card face);
// the layout below is its own. The print template (GIFT_CARD kind) drives the
// brand line, the small label, extra terms lines and the dashed foot.

export interface GiftCardData {
    valueText: string;          // "₹1,000.00"
    code:      string;
    qrDataUrl: string;
    subLines:  string[];        // "For <owner>." / "Valid until …"
}

const GIFT_SCOPE = "vt-gift-card";
const GIFT_HERO  = "linear-gradient(135deg, #0d9488 0%, #0f766e 55%, #115e59 100%)";

export default function GiftCardCard({ template, data }: {
    template: VoucherTemplateDefaults;
    data:     GiftCardData;
}) {
    const terms = template.termsText?.trim();
    const foot  = cardFootText(template);
    return (
        <div className={GIFT_SCOPE}>
            <style>{cardCss(`.${GIFT_SCOPE}`, GIFT_HERO)}</style>
            <div className="card">
                <div className="hero">
                    {template.showLogo && template.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- print document
                        <img className="logo" src={template.logoUrl} alt="logo" />
                    )}
                    {template.showHeaderText && template.headerLine1 && <div className="brand">{template.headerLine1}</div>}
                    {template.headerLine2 && <div className="label">{template.headerLine2}</div>}
                    <div className="value-cap">VALUE</div>
                    <div className="value">{data.valueText}</div>
                </div>
                <div className="body">
                    <div className="qr">
                        {/* eslint-disable-next-line @next/next/no-img-element -- QR data-URL on a print document */}
                        <img src={data.qrDataUrl} alt={`QR for ${data.code}`} />
                    </div>
                    <div className="meta">
                        <div className="code-cap">Redeem code</div>
                        <div className="code">{data.code}</div>
                        <div className="sub">
                            {["Scan or enter this code at checkout.", ...data.subLines].join("\n")}
                            {terms ? `\n${terms}` : ""}
                        </div>
                    </div>
                </div>
                {foot && <div className="foot">{foot}</div>}
            </div>
        </div>
    );
}
