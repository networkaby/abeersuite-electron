import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";

// Printable coupon card — its OWN design (hero band + QR + code), deliberately
// not shared with the gift card or the voucher chrome. The print template
// (COUPON kind) drives the brand line, the small label, extra terms lines and
// the dashed foot; the coupon itself (headline / name / code / QR) is data.

export interface CouponCardData {
    headline:  string;          // "20% OFF" / "₹500 OFF"
    name:      string;          // coupon name
    code:      string;
    qrDataUrl: string;
    subLines:  string[];        // "Min bill ₹1,000." / "Valid until …"
}

export function cardCss(scope: string, heroGradient: string): string {
    const s = scope ? `${scope} ` : "";
    return `
        ${s}.card { width: 360px; border-radius: 22px; overflow: hidden; box-shadow: 0 18px 40px rgba(15,23,42,.25); background: #fff; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
        ${s}.hero { background: ${heroGradient}; color: #fff; padding: 22px 24px 26px; position: relative; }
        ${s}.hero::after { content: ""; position: absolute; right: -40px; top: -40px; width: 150px; height: 150px; border-radius: 50%; background: rgba(255,255,255,.08); }
        ${s}.hero img.logo { max-height: 36px; max-width: 160px; margin-bottom: 8px; display: block; }
        ${s}.brand { font-size: 15px; font-weight: 700; letter-spacing: .3px; }
        ${s}.label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: .85; margin-top: 2px; }
        ${s}.headline { font-size: 34px; font-weight: 800; line-height: 1.05; margin-top: 18px; }
        ${s}.name { font-size: 14px; opacity: .9; margin-top: 6px; }
        ${s}.value-cap { font-size: 11px; opacity: .85; margin-top: 22px; }
        ${s}.value { font-size: 40px; font-weight: 800; line-height: 1; margin-top: 2px; }
        ${s}.body { padding: 20px 24px 22px; display: flex; gap: 18px; align-items: center; }
        ${s}.qr { width: 116px; height: 116px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 6px; background: #fff; flex-shrink: 0; }
        ${s}.qr img { width: 100%; height: 100%; display: block; }
        ${s}.meta { flex: 1; min-width: 0; }
        ${s}.code-cap { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; }
        ${s}.code { font-family: ui-monospace, "SF Mono", "Courier New", monospace; font-size: 20px; font-weight: 700; letter-spacing: 1px; margin-top: 2px; word-break: break-all; }
        ${s}.sub { font-size: 11px; color: #64748b; margin-top: 10px; line-height: 1.5; white-space: pre-line; }
        ${s}.foot { border-top: 1px dashed #cbd5e1; padding: 12px 24px 16px; font-size: 10px; color: #94a3b8; text-align: center; }
        @media print {
            ${s}.card { box-shadow: none; border: 1px solid #e2e8f0; }
        }
    `;
}

/** Dashed foot line: brand · phone · footer line — each only when the template says so. */
export function cardFootText(t: VoucherTemplateDefaults): string {
    return [
        t.showHeaderText ? t.headerLine1 : "",
        t.showPhone ? t.phoneLine?.replace(/^Ph:\s*/i, "").trim() : "",
        t.footerLine?.trim(),
    ].filter(Boolean).join(" · ");
}

const COUPON_SCOPE = "vt-coupon-card";
const COUPON_HERO  = "linear-gradient(135deg, #e11d48 0%, #be123c 55%, #9f1239 100%)";

export default function CouponCard({ template, data }: {
    template: VoucherTemplateDefaults;
    data:     CouponCardData;
}) {
    const terms = template.termsText?.trim();
    const foot  = cardFootText(template);
    return (
        <div className={COUPON_SCOPE}>
            <style>{cardCss(`.${COUPON_SCOPE}`, COUPON_HERO)}</style>
            <div className="card">
                <div className="hero">
                    {template.showLogo && template.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- print document
                        <img className="logo" src={template.logoUrl} alt="logo" />
                    )}
                    {template.showHeaderText && template.headerLine1 && <div className="brand">{template.headerLine1}</div>}
                    {template.headerLine2 && <div className="label">{template.headerLine2}</div>}
                    <div className="headline">{data.headline}</div>
                    <div className="name">{data.name}</div>
                </div>
                <div className="body">
                    <div className="qr">
                        {/* eslint-disable-next-line @next/next/no-img-element -- QR data-URL on a print document */}
                        <img src={data.qrDataUrl} alt={`QR for ${data.code}`} />
                    </div>
                    <div className="meta">
                        <div className="code-cap">Code</div>
                        <div className="code">{data.code}</div>
                        <div className="sub">
                            {data.subLines.join("\n")}
                            {terms ? `\n${terms}` : ""}
                        </div>
                    </div>
                </div>
                {foot && <div className="foot">{foot}</div>}
            </div>
        </div>
    );
}
