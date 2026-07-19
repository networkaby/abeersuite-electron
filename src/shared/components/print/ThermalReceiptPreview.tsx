/* eslint-disable @next/next/no-head-element -- standalone print document; next/head doesn't apply. */
/**
 * Shared thermal-receipt renderer.
 *
 * Pure presentational — no data loading, no auth. Renders the same HTML
 * structure the legacy `/receipt/invoice/[id]` route hand-rolled before
 * 2026-05-23 (POS sale receipt) but driven by the values on `template`
 * so the same component covers all 21 voucher kinds.
 *
 * Used in two places:
 *   • src/app/receipt/invoice/[id]/page.tsx — real print flow (POS + SALE)
 *   • src/modules/settings/components/VoucherTemplatesPanel.tsx — live preview
 *
 * When `previewMode` is true, the component returns just the receipt
 * fragment (no <html>/<head>/<body>) so it can sit inside the settings
 * page. When false, it returns the full standalone HTML document for
 * the print route to ship to the browser.
 */

import { isSupplierPartyKind, type VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { QrSvg } from "@/shared/components/print/QrSvg";
import { COMPANY_DETAILS } from "@/utils/constants-company-details";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { rupeesInWords } from "@/shared/lib/format/numberToWords";

export interface ThermalReceiptLine {
    description: string;
    quantity:    number;
    amount:      number; // line total (post-tax inclusive or pre-tax, caller's choice)
    /// Customer-ladder snapshots (tax-inclusive line totals, rupees). Optional —
    /// when set, the A4 "C" density shows a struck MRP next to the line.
    mrp?:        number | null;
    barcode?:    number | null;
}

/// Customer-facing "Today's discount" ladder (display only). When present on the
/// sample, the renderer shows Gross-at-tag → Today's discount → (HSN summary) →
/// Total → "You saved ₹X (Y%)" INSTEAD of the legacy subtotal/tax/total block.
export interface ReceiptDiscountRow { label: string; amount: number }
export interface ReceiptHsnRow {
    hsn: string; ratePct: number; taxable: number; cgst: number; sgst: number; total: number;
}
export interface ReceiptDiscounts {
    grossAtTag:   number;             // Σ barcode/tag line totals
    rows:         ReceiptDiscountRow[]; // priceBenefit + tier + loyalty + coupon (non-zero)
    charges?:     ReceiptDiscountRow[]; // signed bill adjustments: shipping/round-off/manual
    total:        number;             // Σ rows
    savingsTotal: number;             // MRP total − paid
    savingsPct:   number;
}

/**
 * Per-invoice GST split for the totals box. When `taxBreakdown` is set, the
 * renderer shows two rows (CGST + SGST) for INTRA-state supply OR one row
 * (IGST) for INTER-state supply, instead of a single generic "Tax" row.
 * When null, the renderer falls back to the legacy single-row layout driven
 * by `taxAmount`.
 */
export type ThermalTaxBreakdown =
    | { kind: "INTRA"; cgst: number; sgst: number; placeOfSupplyName: string | null }
    | { kind: "INTER"; igst: number; placeOfSupplyName: string | null };

export interface ThermalReceiptSample {
    reference: string;          // voucher / invoice number
    date:      string;          // ISO date or display date
    partyName: string | null;   // "Walk-in" if null
    partyPhone:string | null;
    lines:     ThermalReceiptLine[];
    subtotal:  number | null;   // null hides the subtotal row
    taxAmount: number | null;   // null hides the tax row
    total:     number | null;   // null hides the total row
    notes:     string | null;
    /// Optional CGST/SGST/IGST breakdown — overrides the single Tax row.
    taxBreakdown?: ThermalTaxBreakdown | null;
    /// Customer-facing price ladder (display only). When set, replaces the
    /// legacy subtotal/tax/total block with the "Today's discount" presentation.
    discounts?:  ReceiptDiscounts | null;
    /// HSN/rate-wise net tax summary (paired with `discounts`). Gated by
    /// `template.showTaxSummary` so it can be toggled off.
    hsnSummary?: ReceiptHsnRow[] | null;
    /// Buyer GSTIN — printed on the receipt for B2B tax invoices.
    partyGstin?: string | null;
    /// Party ledger balance around a money voucher (RECEIPT/PAYMENT slips),
    /// preformatted with Dr/Cr (e.g. "Rs. 7,315.00 Dr"). Null/absent → hidden
    /// (walk-in customers have no ledger account).
    balanceBefore?: string | null;
    balanceAfter?:  string | null;
    /// Issuing-branch address block (multi-line). Rendered only when the
    /// template's `showBranchAddress` flag is on and this is non-empty.
    branchAddress?: string | null;
}

const fmtINR = (n: number) =>
    `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Class used to scope the inline <style> block when rendered inline in the
// host page (previewMode=true). MUST stay in sync with the wrapper div below.
const THERMAL_PREVIEW_SCOPE_CLASS = "vt-thermal-preview-root";

/**
 * The thermal styles are emitted into an inline `<style>` block. In standalone
 * HTML mode they target `body`, `.center`, `.row`, etc — which is what a
 * full print document wants. In previewMode they would otherwise leak into
 * the host settings page and rewrite `body { font-family, padding, ... }`
 * along with global utility class names like `.row`/`.center`/`.bold`. So
 * we prefix every selector with the wrapper class so the rules only apply
 * inside the preview box.
 *
 * `scope`:
 *   ""                            → full-document mode (uses `body { ... }`)
 *   ".vt-thermal-preview-root"    → inline preview mode
 */
function inlineStyleFromTemplate(t: VoucherTemplateDefaults, scope: string): string {
    const s = scope ? `${scope} ` : "";
    const rootRule = scope ? scope : "body";
    return `
        ${s}* { margin: 0; padding: 0; box-sizing: border-box; }
        ${rootRule} {
            font-family: ${t.fontFamily};
            font-size: ${t.fontSizePx}px;
            background: #fff;
            color: #000;
            padding: 12px;
        }
        ${s}.receipt { max-width: ${t.paperWidthMm * 4}px; margin: 0 auto; }
        ${s}.center { text-align: center; }
        ${s}.right  { text-align: right; }
        ${s}.row    { display: flex; justify-content: space-between; gap: 8px; }
        ${s}.hr     { border-top: 1px dashed #000; margin: 6px 0; }
        ${s}.lines  { width: 100%; border-collapse: collapse; }
        ${s}.lines th, ${s}.lines td { padding: 2px 0; vertical-align: top; }
        ${s}.lines th { font-weight: normal; border-bottom: 1px dashed #000; }
        ${s}.lines .qty { text-align: right; width: 38px; }
        ${s}.lines .amt { text-align: right; width: 70px; }
        ${s}.total  { font-weight: bold; font-size: ${t.fontSizePx + 1}px; }
        ${s}.small  { font-size: ${Math.max(8, t.fontSizePx - 2)}px; }
        ${s}.terms  { font-size: ${Math.max(8, t.fontSizePx - 3)}px; color: #444; line-height: 1.5; white-space: pre-wrap; }
        ${s}.sig-line { border-top: 1px solid #000; margin-top: 24px; padding-top: 2px; font-size: ${Math.max(8, t.fontSizePx - 3)}px; color: #555; }
        ${s}.doctitle { font-weight: bold; font-size: ${t.fontSizePx + 1}px; letter-spacing: 1px; text-transform: uppercase; margin-top: 6px; }
        ${s}.disclaimer { font-size: ${Math.max(7, t.fontSizePx - 4)}px; color: #666; font-style: italic; margin-top: 4px; }
        ${s}.barcode { max-width: 100%; height: auto; margin-inline: auto; }
        @media print {
            ${s}.no-print { display: none !important; }
        }
    `;
}

interface BodyProps {
    template: VoucherTemplateDefaults;
    sample:   ThermalReceiptSample;
    /** Custom middle — repair ticket / shipping slip / payment slip supply their
     *  own device / tender body here. When set, it replaces the invoice
     *  ref/date/lines/totals block; the template-driven header + footer chrome
     *  stay shared. */
    body?:    React.ReactNode;
}

/** Template-driven header chrome (logo · brand · address · GSTIN · phone). */
function ThermalHeader({ template, sample }: { template: VoucherTemplateDefaults; sample: ThermalReceiptSample }) {
    const brand     = template.headerLine1 || COMPANY_DETAILS.brandName;
    const addrLines = template.addressBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    return (
        <>
            {template.showLogo && template.logoUrl && (
                <div className="center" style={{ marginBottom: 4 }}>
                    {/* Plain <img> so this works inside the standalone print HTML
                        (no next/image runtime). */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={template.logoUrl} alt="logo" style={{ maxHeight: 60, maxWidth: "100%" }} />
                </div>
            )}

            {template.showHeaderText && (
                <div className="center" style={{ fontWeight: "bold", fontSize: template.fontSizePx + 2 }}>
                    {brand}
                </div>
            )}
            {template.showAddress && addrLines.length > 0 && (
                <div className="center small">
                    {addrLines.map((line, i) => (
                        <div key={i}>{line}</div>
                    ))}
                </div>
            )}
            {template.showBranchAddress && sample.branchAddress && (
                <div className="center small">
                    {sample.branchAddress.split("\n").filter(Boolean).map((line, i) => (
                        <div key={i}>{line}</div>
                    ))}
                </div>
            )}
            {template.showPhone && template.phoneLine && (
                <div className="center small">{template.phoneLine}</div>
            )}
            {template.showPhone && template.emailLine && (
                <div className="center small">{template.emailLine}</div>
            )}
            {template.showPhone && template.websiteLine && (
                <div className="center small">{template.websiteLine}</div>
            )}
            {template.showGstin && template.gstinLine && (
                <div className="center small">{template.gstinLine}</div>
            )}
        </>
    );
}

/** Default invoice middle — ref/date/customer meta, line-items table and totals. */
// Money vouchers get the cash-slip middle below instead of the goods Item/Qty
// table — a ₹5,000 cash receipt is not a sale. Deliberately bespoke; do NOT
// fold back into DefaultThermalMiddle. (Mirrors MoneyReceiptMiddle on A4.)
const MONEY_RECEIPT_KINDS = new Set(["RECEIPT", "PAYMENT"]);

/** Bespoke 80mm middle for money vouchers — party, tender(s), big
 *  RECEIVED/PAID amount with words, and the party balance strip. */
function MoneyThermalMiddle({ template, sample }: { template: VoucherTemplateDefaults; sample: ThermalReceiptSample }) {
    const isPayment = template.kind === "PAYMENT";
    const total  = sample.total ?? 0;
    const modes  = sample.lines.filter((l) => l.description.trim());
    return (
        <>
            <div className="row">
                <span>{sample.reference}</span>
                <span>{sample.date}</span>
            </div>
            <div className="hr" />
            <div className="row">
                <span>{isPayment ? "Paid to:" : "Received from:"}</span>
                <span><b>{sample.partyName ?? "Walk-in"}</b></span>
            </div>
            {sample.partyPhone && (
                <div className="row">
                    <span></span>
                    <span>{sample.partyPhone}</span>
                </div>
            )}
            {modes.length === 1 && (
                <div className="row">
                    <span>By:</span>
                    <span>{modes[0].description}</span>
                </div>
            )}
            {modes.length > 1 && modes.map((l, i) => (
                <div key={i} className="row">
                    <span>{i === 0 ? "By:" : ""} {l.description}</span>
                    <span>{fmtINR(l.amount)}</span>
                </div>
            ))}
            {sample.notes && <div className="small" style={{ marginTop: 2 }}>Towards: {sample.notes}</div>}
            <div className="hr" />
            <div className="row total">
                <span>{isPayment ? "PAID" : "RECEIVED"}</span>
                <span>{fmtINR(total)}</span>
            </div>
            <div className="center small" style={{ marginTop: 2 }}>{rupeesInWords(total)}</div>
            {(sample.balanceBefore || sample.balanceAfter) && (
                <>
                    <div className="hr" />
                    {sample.balanceBefore && (
                        <div className="row">
                            <span>Balance before</span>
                            <span>{sample.balanceBefore}</span>
                        </div>
                    )}
                    {sample.balanceAfter && (
                        <div className="row">
                            <span><b>Balance after</b></span>
                            <span><b>{sample.balanceAfter}</b></span>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

function DefaultThermalMiddle({ template, sample }: { template: VoucherTemplateDefaults; sample: ThermalReceiptSample }) {
    return (
        <>
            <div className="row">
                <span>{sample.reference}</span>
                <span>{sample.date}</span>
            </div>
            <div className="row">
                <span>{isSupplierPartyKind(template.kind) ? "Supplier:" : "Customer:"}</span>
                <span>{sample.partyName ?? "Walk-in"}</span>
            </div>
            {sample.partyPhone && (
                <div className="row">
                    <span></span>
                    <span>{sample.partyPhone}</span>
                </div>
            )}
            {sample.partyGstin && (
                <div className="row">
                    <span>GSTIN:</span>
                    <span>{sample.partyGstin}</span>
                </div>
            )}

            <div className="hr" />

            <table className="lines">
                <thead>
                    <tr>
                        <th style={{ textAlign: "left" }}>Item</th>
                        <th className="qty">Qty</th>
                        <th className="amt">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {sample.lines.map((l, i) => (
                        <tr key={i}>
                            <td>
                                {l.description}
                                {template.showMrp && sample.discounts && l.mrp != null && l.mrp > l.amount + 0.005 && (
                                    <div className="small">MRP <s>{fmtINR(l.mrp)}</s></div>
                                )}
                            </td>
                            <td className="qty">{l.quantity}</td>
                            <td className="amt">{fmtINR(l.amount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {sample.discounts ? (
                /* ── "Today's discount" ladder (B density) ───────────────────
                   Gross-at-tag → Today's discount → (HSN summary) → Total →
                   "You saved". The per-item real price is never shown. */
                <>
                    <div className="hr" />
                    <div className="row"><span>Gross</span><span>{fmtINR(sample.discounts.grossAtTag)}</span></div>
                    {sample.discounts.rows.map((d, i) => (
                        <div key={i} className="row"><span>{d.label}</span><span>&minus; {fmtINR(d.amount)}</span></div>
                    ))}
                    {(sample.discounts.charges ?? []).map((c, i) => (
                        <div key={`c${i}`} className="row"><span>{c.label}</span><span>{c.amount < 0 ? "−" : "+"} {fmtINR(Math.abs(c.amount))}</span></div>
                    ))}
                    <div className="hr" />
                    <div className="row total"><span>Total</span><span>{fmtINR(sample.total ?? sample.discounts.grossAtTag - sample.discounts.total)}</span></div>
                    {/* GST is INCLUDED in the inclusive line amounts above — shown as a
                        note on the total, not a column row (so the math reads correctly). */}
                    {template.showTaxSummary && sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
                        const inter = sample.taxBreakdown?.kind === "INTER";
                        const tax = sample.hsnSummary.reduce((s, h) => s + h.cgst + h.sgst, 0);
                        return tax > 0.005 ? (
                            <div className="row small"><span>incl. {inter ? "GST (IGST)" : "GST (CGST+SGST)"}</span><span>{fmtINR(tax)}</span></div>
                        ) : null;
                    })()}
                    {sample.discounts.savingsTotal > 0 && (
                        <div className="row total" style={{ marginTop: 2 }}>
                            <span>You saved</span>
                            <span>{fmtINR(sample.discounts.savingsTotal)} ({sample.discounts.savingsPct}%)</span>
                        </div>
                    )}
                </>
            ) : (
                <>
                    {template.showTaxSummary && sample.subtotal !== null && (
                        <>
                            <div className="hr" />
                            <div className="row"><span>Subtotal</span><span>{fmtINR(sample.subtotal)}</span></div>
                            {sample.taxBreakdown ? (
                                sample.taxBreakdown.kind === "INTRA" ? (
                                    <>
                                        <div className="row"><span>CGST</span><span>{fmtINR(sample.taxBreakdown.cgst)}</span></div>
                                        <div className="row"><span>SGST</span><span>{fmtINR(sample.taxBreakdown.sgst)}</span></div>
                                    </>
                                ) : (
                                    <div className="row"><span>IGST</span><span>{fmtINR(sample.taxBreakdown.igst)}</span></div>
                                )
                            ) : sample.taxAmount !== null && sample.taxAmount > 0 && (
                                <div className="row"><span>Tax</span><span>{fmtINR(sample.taxAmount)}</span></div>
                            )}
                        </>
                    )}

                    {sample.total !== null && (
                        <>
                            <div className="hr" />
                            <div className="row total"><span>Total</span><span>{fmtINR(sample.total)}</span></div>
                        </>
                    )}
                </>
            )}

            {sample.notes && (
                <>
                    <div className="hr" />
                    <div className="small" style={{ whiteSpace: "pre-wrap" }}>{sample.notes}</div>
                </>
            )}
        </>
    );
}

/** Template-driven footer chrome (terms · signature · footer line · barcode). */
function ThermalFooter({ template, sample }: { template: VoucherTemplateDefaults; sample: ThermalReceiptSample }) {
    return (
        <>
            {template.termsText && (
                <>
                    <div className="hr" />
                    <div className="terms">{template.termsText}</div>
                </>
            )}

            {template.showBank && (template.bankDetails || template.bankUpiQr) && (
                <>
                    <div className="hr" />
                    {template.bankDetails && (
                        <div className="terms" style={{ whiteSpace: "pre-line" }}>
                            <b>Bank Details</b>{"\n"}{template.bankDetails}
                        </div>
                    )}
                    {template.bankUpiQr && (
                        <div className="center" style={{ marginTop: 6 }}>
                            <QrSvg value={template.bankUpiQr} size={110} />
                            <div className="small">SCAN TO PAY</div>
                        </div>
                    )}
                </>
            )}

            {template.showSignature && (
                <div style={{ marginTop: 20 }}>
                    <div className="sig-line">{template.signatureLabel}</div>
                </div>
            )}

            <div className="hr" />
            <div className="center small">{template.footerLine}</div>
            {template.disclaimerLine && (
                <div className="center disclaimer">{template.disclaimerLine}</div>
            )}

            {/* Scannable voucher number — for pulling up the sale at return time. */}
            {template.showBarcode && sample.reference && (
                <div className="center" style={{ marginTop: 6 }}>
                    <BarcodeSvg value={sample.reference} height={30} fontSize={10} margin={2} className="barcode" />
                </div>
            )}
        </>
    );
}

/** Assembles header chrome + (custom or default) middle + footer chrome, so a
 *  bespoke document (repair ticket / shipping slip / payment slip) reuses the
 *  template-driven header + footer and only supplies its own `body`. */
function ReceiptBody({ template, sample, body }: BodyProps) {
    return (
        <div className="receipt">
            <ThermalHeader template={template} sample={sample} />
            <div className="hr" />
            {/* Document title — below the divider, sitting right above the ticket
                no / ref that the body opens with, so it reads as the heading of
                what follows rather than a small line lost in the identity block. */}
            {template.headerLine2 && (
                <div className="center doctitle" style={{ marginTop: 0, marginBottom: 6 }}>{template.headerLine2}</div>
            )}
            {body ?? (MONEY_RECEIPT_KINDS.has(template.kind)
                ? <MoneyThermalMiddle template={template} sample={sample} />
                : <DefaultThermalMiddle template={template} sample={sample} />)}
            <ThermalFooter template={template} sample={sample} />
        </div>
    );
}

export interface ThermalReceiptPreviewProps {
    template:    VoucherTemplateDefaults;
    sample:      ThermalReceiptSample;
    /** When true, returns just the body fragment (for in-page preview). */
    previewMode?: boolean;
    /** previewMode: grow to natural height (host owns the scroll) instead of
     *  scrolling inside its own maxHeight box. Prevents a nested double scroll. */
    previewFill?: boolean;
    /** Inserted inside the <body> ahead of the receipt — used by the print
     *  route to drop in the Print/Close toolbar. Ignored in previewMode. */
    toolbar?:    React.ReactNode;
    /** Title used in <head><title> when not in previewMode. */
    docTitle?:   string;
    /** Custom middle for bespoke documents (repair ticket / shipping slip /
     *  payment slip). When set, replaces the invoice ref/date/lines/totals
     *  block; the template-driven header + footer chrome stay shared. */
    body?:       React.ReactNode;
}

export default function ThermalReceiptPreview({
    template,
    sample,
    previewMode = false,
    previewFill = false,
    toolbar,
    docTitle,
    body,
}: ThermalReceiptPreviewProps) {
    if (previewMode) {
        return (
            <div
                className={`${THERMAL_PREVIEW_SCOPE_CLASS} border border-border bg-white text-black${previewFill ? "" : " overflow-auto"}`}
                style={{
                    width:      `${template.paperWidthMm * 4}px`,
                    fontFamily: template.fontFamily,
                    fontSize:   `${template.fontSizePx}px`,
                    padding:    12,
                    ...(previewFill ? {} : { maxHeight: 600 }),
                }}
            >
                <style>{inlineStyleFromTemplate(template, `.${THERMAL_PREVIEW_SCOPE_CLASS}`)}</style>
                <ReceiptBody template={template} sample={sample} body={body} />
            </div>
        );
    }

    return (
        <html>
            {/* Standalone print document, not a Next.js layout — next/head doesn't apply.
                eslint-disable-next-line @next/next/no-head-element */}
            <head>
                <title>{docTitle ?? sample.reference}</title>
                <style>{inlineStyleFromTemplate(template, "")}</style>
            </head>
            <body>
                {toolbar}
                <ReceiptBody template={template} sample={sample} body={body} />
            </body>
        </html>
    );
}
