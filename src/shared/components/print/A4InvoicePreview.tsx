/* eslint-disable @next/next/no-head-element -- standalone print document; next/head doesn't apply. */
/**
 * A4 invoice / voucher renderer. Sibling of <ThermalReceiptPreview>; shares
 * the same `template` + `sample` shape so both formats can be driven from
 * the same row in VoucherPrintTemplate.
 *
 * Layout (top → bottom):
 *   1. Letterhead band — logo (optional) + brand name + address + GSTIN + phone.
 *   2. Title banner — uses `headerLine2` ("Tax Invoice", "POS sale receipt", …).
 *   3. Bill-To / Invoice-Details two-column band.
 *   4. Line-items table (S.No · Description · Qty · Rate · Amount).
 *   5. Totals box (subtotal, tax, grand total).
 *   6. Amount-in-words line.
 *   7. Terms + signature block + footer line.
 *
 * Skips per-line CGST/SGST/IGST columns for V1 (those numbers aren't stored
 * per line yet — see "Out of scope" in the plan).
 */

import { isSupplierPartyKind, type VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";
import { rupeesInWords } from "@/shared/lib/format/numberToWords";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { QrSvg } from "@/shared/components/print/QrSvg";

const fmtINR = (n: number) =>
    `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Class used to scope the inline <style> block when rendered inline in the
// host page (previewMode=true). MUST stay in sync with the wrapper div below.
const A4_PREVIEW_SCOPE_CLASS = "vt-a4-preview-root";

/**
 * Emits the A4 stylesheet. In standalone HTML mode `scope === ""` so the
 * rules target `body`/global selectors as a normal print document would.
 * In previewMode `scope === ".vt-a4-preview-root"` so every selector is
 * prefixed and the styles can't leak into the host settings page (which
 * would otherwise lose its global font, padding, and any utility classes
 * that share names like .row / .center / .bold).
 */
function inlineA4Styles(scope: string): string {
    const s = scope ? `${scope} ` : "";
    const rootRule = scope ? scope : "body";
    return `
        ${s}* { margin: 0; padding: 0; box-sizing: border-box; }
        ${rootRule} {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 11px;
            color: #111;
            background: #fff;
        }
        ${s}.a4-sheet {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: 16mm 14mm;
            background: #fff;
        }
        ${s}.row { display: flex; gap: 12px; }
        ${s}.row.between { justify-content: space-between; }
        ${s}.col { flex: 1; min-width: 0; }
        ${s}.muted { color: #555; }
        ${s}.small { font-size: 10px; }
        ${s}.xs    { font-size: 9px; }
        ${s}.center { text-align: center; }
        ${s}.right  { text-align: right; }
        ${s}.bold   { font-weight: 600; }
        ${s}.header { border-bottom: 2px solid #111; padding-bottom: 10px; }
        ${s}.brand  { font-size: 22px; font-weight: 700; letter-spacing: 0.4px; }
        ${s}.banner {
            text-align: center;
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 4px;
            text-transform: uppercase;
            border: 1px solid #111;
            padding: 6px 0;
            margin: 14px 0 12px;
        }
        ${s}.meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 12px;
        }
        ${s}.meta-card {
            border: 1px solid #d0d0d0;
            padding: 8px 10px;
            border-radius: 2px;
        }
        ${s}.meta-card .label {
            font-size: 9px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-bottom: 2px;
        }
        ${s}table.lines {
            width: 100%;
            border-collapse: collapse;
            margin-top: 4px;
            font-size: 11px;
        }
        ${s}table.lines th, ${s}table.lines td {
            border: 1px solid #c8c8c8;
            padding: 6px 8px;
            vertical-align: top;
        }
        ${s}table.lines th {
            background: #f4f4f4;
            font-weight: 600;
            text-align: left;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        ${s}table.lines td.num { text-align: right; font-variant-numeric: tabular-nums; }
        ${s}table.lines td.sn  { text-align: center; width: 28px; }
        ${s}table.lines td.qty { text-align: right; width: 50px; }
        ${s}table.lines td.rate, ${s}table.lines td.amt { text-align: right; width: 90px; }
        ${s}.totals {
            display: flex;
            justify-content: flex-end;
            margin-top: 8px;
        }
        ${s}.totals-box {
            min-width: 280px;
            border: 1px solid #c8c8c8;
            border-radius: 2px;
        }
        ${s}.totals-box .trow {
            display: flex;
            justify-content: space-between;
            padding: 5px 10px;
            border-bottom: 1px solid #e8e8e8;
        }
        ${s}.totals-box .trow:last-child { border-bottom: 0; }
        ${s}.totals-box .trow.grand {
            background: #f4f4f4;
            font-weight: 700;
            font-size: 13px;
        }
        ${s}table.hsn {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 10.5px;
        }
        ${s}table.hsn th, ${s}table.hsn td {
            border: 1px solid #c8c8c8;
            padding: 4px 6px;
            text-align: center;
        }
        ${s}table.hsn th { background: #f4f4f4; font-weight: 600; }
        ${s}table.hsn td.l { text-align: left; }
        ${s}table.hsn td.num { text-align: right; font-variant-numeric: tabular-nums; }
        ${s}table.hsn tr.tot td { font-weight: 700; background: #fafafa; }
        ${s}.words {
            margin-top: 8px;
            font-size: 11px;
            font-style: italic;
            color: #333;
        }
        ${s}.terms {
            margin-top: 16px;
            font-size: 10px;
            color: #444;
            white-space: pre-wrap;
            line-height: 1.5;
        }
        ${s}.sig {
            margin-top: 28px;
            display: flex;
            justify-content: flex-end;
        }
        ${s}.sig-block {
            min-width: 200px;
            text-align: center;
            border-top: 1px solid #111;
            padding-top: 4px;
            font-size: 10px;
            color: #555;
        }
        ${s}.footer-line {
            margin-top: 12px;
            text-align: center;
            font-size: 10px;
            color: #555;
        }
        ${s}.disclaimer {
            margin-top: 6px;
            text-align: center;
            font-size: 9px;
            font-style: italic;
            color: #777;
        }
        ${s}.barcode { max-width: 100%; height: auto; margin-inline: auto; }
        @media print {
            ${s}.no-print { display: none !important; }
            ${rootRule} { background: #fff; }
            ${s}.a4-sheet { padding: 14mm 12mm; }
        }
    `;
}

interface InvoiceBodyProps {
    template: VoucherTemplateDefaults;
    sample:   ThermalReceiptSample;
    /** Custom middle for bespoke documents (repair ticket / shipping slip /
     *  payment slip). Replaces the invoice meta/lines/totals block; the
     *  template-driven letterhead + footer chrome stay shared. */
    body?:    React.ReactNode;
}

type A4ChromeProps = { template: VoucherTemplateDefaults; sample: ThermalReceiptSample };

/** Template-driven letterhead (logo · brand · address · GSTIN · phone) + banner. */
function A4Header({ template, sample }: A4ChromeProps) {
    const brand     = template.headerLine1 || COMPANY_DETAILS.brandName;
    const addrLines = template.addressBlock.split("\n").map((l) => l.trim()).filter(Boolean);

    return (
        <>
            {/* 1 — Letterhead */}
            <div className="header row between" style={{ alignItems: "flex-start" }}>
                <div className="col">
                    <div className="row" style={{ alignItems: "center", gap: 12 }}>
                        {template.showLogo && template.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={template.logoUrl} alt="logo" style={{ maxHeight: 56, maxWidth: 160 }} />
                        )}
                        <div>
                            {template.showHeaderText && <div className="brand">{brand}</div>}
                            {template.showAddress && addrLines.length > 0 && (
                                <div className="small muted" style={{ marginTop: 3 }}>
                                    {addrLines.map((l, i) => <div key={i}>{l}</div>)}
                                </div>
                            )}
                            {template.showBranchAddress && sample.branchAddress && (
                                <div className="small muted" style={{ marginTop: 3 }}>
                                    <span className="bold">Branch: </span>
                                    {sample.branchAddress.split("\n").filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="col right">
                    {template.showGstin && template.gstinLine && (
                        <div className="small">
                            <span className="muted">GSTIN: </span>
                            <span className="bold">{template.gstinLine}</span>
                        </div>
                    )}
                    {template.showPhone && template.phoneLine && (
                        <div className="small">
                            <span className="muted">Ph: </span>
                            <span>{template.phoneLine}</span>
                        </div>
                    )}
                    {template.showPhone && template.emailLine && (
                        <div className="small">
                            <span className="muted">Email: </span>
                            <span>{template.emailLine}</span>
                        </div>
                    )}
                    {template.showPhone && template.websiteLine && (
                        <div className="small">
                            <span className="muted">Web: </span>
                            <span>{template.websiteLine}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 2 — Title banner (document type — kept even when the brand-name
                 text is hidden). */}
            {template.headerLine2 && (
                <div className="banner">{template.headerLine2}</div>
            )}
        </>
    );
}

/** Default invoice middle — bill-to meta, line items, totals, HSN, amount-in-words. */
function DefaultA4Middle({ template, sample }: A4ChromeProps) {
    const grandTotal = sample.total ?? 0;
    return (
        <>
            {/* 3 — Bill-To / Invoice-Details */}
            <div className="meta-grid">
                <div className="meta-card">
                    <div className="label">{isSupplierPartyKind(template.kind) ? "Supplier" : "Bill To"}</div>
                    <div className="bold">{sample.partyName ?? "Walk-in"}</div>
                    {sample.partyPhone && <div className="small muted">{sample.partyPhone}</div>}
                </div>
                <div className="meta-card">
                    <div className="label">Voucher Details</div>
                    <div className="row between" style={{ gap: 6 }}>
                        <span className="muted small">Reference</span>
                        <span className="bold">{sample.reference}</span>
                    </div>
                    <div className="row between" style={{ gap: 6 }}>
                        <span className="muted small">Date</span>
                        <span>{sample.date}</span>
                    </div>
                </div>
            </div>

            {/* 4 — Line items */}
            <table className="lines">
                <thead>
                    <tr>
                        <th style={{ textAlign: "center" }}>#</th>
                        <th>Description</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        {sample.discounts && template.showMrp && <th style={{ textAlign: "right" }}>MRP</th>}
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {sample.lines.map((l, i) => {
                        const rate = l.quantity > 0 ? l.amount / l.quantity : l.amount;
                        return (
                            <tr key={i}>
                                <td className="sn">{i + 1}</td>
                                <td>{l.description}</td>
                                <td className="qty">{l.quantity}</td>
                                {sample.discounts && template.showMrp && (
                                    <td className="rate">
                                        {l.mrp != null && l.mrp > l.amount + 0.005
                                            ? <s style={{ color: "#888" }}>{fmtINR(l.mrp)}</s>
                                            : "—"}
                                    </td>
                                )}
                                <td className="rate">{fmtINR(rate)}</td>
                                <td className="amt">{fmtINR(l.amount)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {/* 5 — Totals box */}
            {sample.discounts ? (
                /* ── "Today's discount" ladder (C density) ─────────────────── */
                <div className="totals">
                    <div className="totals-box">
                        <div className="trow">
                            <span className="muted">Gross</span>
                            <span>{fmtINR(sample.discounts.grossAtTag)}</span>
                        </div>
                        {sample.discounts.rows.map((d, i) => (
                            <div key={i} className="trow">
                                <span className="muted">{d.label}</span>
                                <span>&minus; {fmtINR(d.amount)}</span>
                            </div>
                        ))}
                        {(sample.discounts.charges ?? []).map((c, i) => (
                            <div key={`c${i}`} className="trow">
                                <span className="muted">{c.label}</span>
                                <span>{c.amount < 0 ? "−" : "+"} {fmtINR(Math.abs(c.amount))}</span>
                            </div>
                        ))}
                        <div className="trow grand">
                            <span>Total</span>
                            <span>{fmtINR(sample.total ?? (sample.discounts.grossAtTag - sample.discounts.total))}</span>
                        </div>
                        {/* GST is included in the inclusive amounts above — note, not a row.
                            The HSN/SAC table below gives the full rate-wise breakup. */}
                        {template.showTaxSummary && sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
                            const inter = sample.taxBreakdown?.kind === "INTER";
                            const tax = sample.hsnSummary.reduce((s, h) => s + h.cgst + h.sgst, 0);
                            return tax > 0.005 ? (
                                <div className="trow"><span className="muted">incl. {inter ? "GST (IGST)" : "GST (CGST+SGST)"}</span><span>{fmtINR(tax)}</span></div>
                            ) : null;
                        })()}
                        {sample.discounts.savingsTotal > 0 && (
                            <div className="trow grand" style={{ color: "#047857" }}>
                                <span>You saved</span>
                                <span>{fmtINR(sample.discounts.savingsTotal)} ({sample.discounts.savingsPct}%)</span>
                            </div>
                        )}
                    </div>
                </div>
            ) : (sample.subtotal !== null || sample.total !== null) && (
                <div className="totals">
                    <div className="totals-box">
                        {template.showTaxSummary && sample.subtotal !== null && (
                            <div className="trow">
                                <span className="muted">Subtotal</span>
                                <span>{fmtINR(sample.subtotal)}</span>
                            </div>
                        )}
                        {template.showTaxSummary && sample.taxBreakdown ? (
                            sample.taxBreakdown.kind === "INTRA" ? (
                                <>
                                    <div className="trow">
                                        <span className="muted">CGST</span>
                                        <span>{fmtINR(sample.taxBreakdown.cgst)}</span>
                                    </div>
                                    <div className="trow">
                                        <span className="muted">SGST</span>
                                        <span>{fmtINR(sample.taxBreakdown.sgst)}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="trow">
                                    <span className="muted">IGST</span>
                                    <span>{fmtINR(sample.taxBreakdown.igst)}</span>
                                </div>
                            )
                        ) : template.showTaxSummary && sample.taxAmount !== null && sample.taxAmount > 0 ? (
                            <div className="trow">
                                <span className="muted">Tax</span>
                                <span>{fmtINR(sample.taxAmount)}</span>
                            </div>
                        ) : null}
                        {sample.total !== null && (
                            <div className="trow grand">
                                <span>Total</span>
                                <span>{fmtINR(sample.total)}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 5b — HSN/SAC-wise tax summary (separate table, toggleable) */}
            {template.showTaxSummary && sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
                const inter = sample.taxBreakdown?.kind === "INTER";
                const num = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const sum = sample.hsnSummary.reduce(
                    (a, h) => ({ taxable: a.taxable + h.taxable, cgst: a.cgst + h.cgst, sgst: a.sgst + h.sgst }),
                    { taxable: 0, cgst: 0, sgst: 0 },
                );
                const totalTax = sum.cgst + sum.sgst;
                return (
                    <table className="hsn">
                        <thead>
                            <tr>
                                <th rowSpan={2}>HSN/SAC</th>
                                <th rowSpan={2}>Taxable Value</th>
                                {inter ? (
                                    <th colSpan={2}>IGST</th>
                                ) : (
                                    <>
                                        <th colSpan={2}>Central Tax</th>
                                        <th colSpan={2}>State Tax</th>
                                    </>
                                )}
                                <th rowSpan={2}>Total Tax</th>
                            </tr>
                            <tr>
                                <th>Rate</th><th>Amount</th>
                                {!inter && <><th>Rate</th><th>Amount</th></>}
                            </tr>
                        </thead>
                        <tbody>
                            {sample.hsnSummary.map((h, i) => (
                                <tr key={i}>
                                    <td className="l">{h.hsn}</td>
                                    <td className="num">{num(h.taxable)}</td>
                                    {inter ? (
                                        <><td>{h.ratePct}%</td><td className="num">{num(h.cgst + h.sgst)}</td></>
                                    ) : (
                                        <>
                                            <td>{h.ratePct / 2}%</td><td className="num">{num(h.cgst)}</td>
                                            <td>{h.ratePct / 2}%</td><td className="num">{num(h.sgst)}</td>
                                        </>
                                    )}
                                    <td className="num">{num(h.cgst + h.sgst)}</td>
                                </tr>
                            ))}
                            <tr className="tot">
                                <td>Total</td>
                                <td className="num">{num(sum.taxable)}</td>
                                {inter ? (
                                    <><td /><td className="num">{num(totalTax)}</td></>
                                ) : (
                                    <><td /><td className="num">{num(sum.cgst)}</td><td /><td className="num">{num(sum.sgst)}</td></>
                                )}
                                <td className="num">{num(totalTax)}</td>
                            </tr>
                        </tbody>
                    </table>
                );
            })()}

            {/* 6 — Amount in words */}
            {sample.total !== null && (
                <div className="words">{rupeesInWords(grandTotal)}</div>
            )}
        </>
    );
}

/** Template-driven footer chrome (notes · terms · signature · footer line · barcode). */
function A4Footer({ template, sample }: A4ChromeProps) {
    return (
        <>
            {/* 7 — Notes + terms + signature + footer */}
            {sample.notes && (
                <div className="terms"><span className="bold">Notes: </span>{sample.notes}</div>
            )}
            {template.termsText && (
                <div className="terms"><span className="bold">Terms &amp; Conditions:</span>{"\n"}{template.termsText}</div>
            )}

            {/* Bank block — mirrors the shop's retail-invoice layout: heading,
                then scan-to-pay UPI QR beside the labelled account lines. */}
            {template.showBank && (template.bankDetails || template.bankUpiQr) && (
                <div className="terms">
                    <span className="bold">Bank Details:</span>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 4 }}>
                        {template.bankUpiQr && (
                            <div style={{ textAlign: "center", flexShrink: 0 }}>
                                <QrSvg value={template.bankUpiQr} size={84} />
                                <div style={{ fontSize: 8, letterSpacing: 1 }}>SCAN TO PAY</div>
                            </div>
                        )}
                        {template.bankDetails && (
                            <div style={{ whiteSpace: "pre-line" }}>{template.bankDetails}</div>
                        )}
                    </div>
                </div>
            )}

            {template.showSignature && (
                <div className="sig">
                    <div className="sig-block">{template.signatureLabel}</div>
                </div>
            )}

            {template.footerLine && (
                <div className="footer-line">{template.footerLine}</div>
            )}
            {template.disclaimerLine && (
                <div className="disclaimer">{template.disclaimerLine}</div>
            )}

            {/* Scannable voucher number — for pulling up the sale at return time. */}
            {template.showBarcode && sample.reference && (
                <div style={{ textAlign: "center", marginTop: 10 }}>
                    <BarcodeSvg value={sample.reference} height={40} fontSize={13} margin={4} className="barcode" />
                </div>
            )}
        </>
    );
}

/** Assembles letterhead + (custom or default) middle + footer chrome, so a
 *  bespoke document (repair ticket / shipping slip / payment slip) reuses the
 *  template-driven letterhead + footer and only supplies its own `body`. */
function InvoiceBody({ template, sample, body }: InvoiceBodyProps) {
    return (
        <div className="a4-sheet">
            <A4Header template={template} sample={sample} />
            {body ?? <DefaultA4Middle template={template} sample={sample} />}
            <A4Footer template={template} sample={sample} />
        </div>
    );
}

export interface A4InvoicePreviewProps {
    template:    VoucherTemplateDefaults;
    sample:      ThermalReceiptSample;
    /** True → returns just the sheet (for in-page preview). False → full HTML document. */
    previewMode?: boolean;
    /** previewMode: grow to natural height (host owns the scroll) instead of
     *  scrolling inside its own maxHeight box. Prevents a nested double scroll. */
    previewFill?: boolean;
    /** Inserted before the sheet inside <body>. Used by the print route for the Print/Close toolbar. */
    toolbar?:    React.ReactNode;
    /** <head><title> when not in previewMode. */
    docTitle?:   string;
    /** Custom middle for bespoke documents (repair ticket / shipping slip /
     *  payment slip). Replaces the invoice meta/lines/totals block; the
     *  template-driven letterhead + footer chrome stay shared. */
    body?:       React.ReactNode;
}

export default function A4InvoicePreview({
    template,
    sample,
    previewMode = false,
    previewFill = false,
    toolbar,
    docTitle,
    body,
}: A4InvoicePreviewProps) {
    if (previewMode) {
        return (
            <div
                className={`${A4_PREVIEW_SCOPE_CLASS} bg-white text-black border border-border shadow-sm${previewFill ? "" : " overflow-auto"}`}
                style={previewFill ? undefined : { maxHeight: 720 }}
            >
                <style>{inlineA4Styles(`.${A4_PREVIEW_SCOPE_CLASS}`)}</style>
                <InvoiceBody template={template} sample={sample} body={body} />
            </div>
        );
    }

    return (
        <html>
            {/* Standalone print document — next/head doesn't apply.
                eslint-disable-next-line @next/next/no-head-element */}
            <head>
                <title>{docTitle ?? sample.reference}</title>
                <style>{inlineA4Styles("")}</style>
            </head>
            <body>
                {toolbar}
                <InvoiceBody template={template} sample={sample} body={body} />
            </body>
        </html>
    );
}
