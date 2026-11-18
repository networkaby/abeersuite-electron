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
 * fragment scoped to a wrapper div, so it can sit inside the settings
 * page. When false, it returns the print route's full page content
 * (styles + toolbar + receipt) — rendered into the app's normal
 * <html>/<body> from the root layout, not a standalone document.
 */

import { isSupplierPartyKind, PRINT_PARTY_GSTIN, type VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { QrSvg } from "@/shared/components/print/QrSvg";
import SetDocumentTitle from "@/shared/components/print/SetDocumentTitle";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { rupeesInWords } from "@/shared/lib/format/numberToWords";
import { formatAmount } from "@/shared/lib/format/moneyInr";

export interface ThermalReceiptLine {
    description: string;
    quantity:    number;
    amount:      number; // line total (post-tax inclusive or pre-tax, caller's choice)
    /// ── Tally-style tax-invoice columns (A4 goods table) ────────────────────
    /// All optional: a column only renders when at least one line supplies it,
    /// so a bare qty/rate voucher keeps the plain three-column table.
    /// Free-text remark typed on the voucher line — prints indented under the
    /// item name, never in place of it.
    note?:       string | null;
    /// Resolved HSN (goods) / SAC (services) code — groups the rate-wise summary.
    hsn?:        string | null;
    /// Unit label for the `per` column ("Nos", "Ream").
    unit?:       string | null;
    /// Pre-tax line value. When set, the A4 table prints EXCLUSIVE amounts and
    /// carries the GST as `Output CGST/SGST` rows under the table (Tally ladder),
    /// so the goods total, the ledger rows and the HSN summary all reconcile.
    taxable?:    number | null;
    /// Unit rate to print. Pairs with `taxable` (i.e. exclusive) when that is set.
    rate?:       number | null;
    /// Line discount in rupees, deducted from the pre-tax base.
    discount?:   number | null;
    /// GST on this line — `taxRate` is the full rate (18), halved per side for
    /// an intra-state supply.
    taxRate?:    number | null;
    taxAmount?:  number | null;
    /// Customer-ladder snapshots (tax-inclusive line totals, rupees). Optional —
    /// when set, the A4 "C" density shows a struck MRP next to the line.
    mrp?:        number | null;
    barcode?:    number | null;
    /// GL side, set for journal-style vouchers (Contra / Journal) so they render
    /// a Particulars · Debit · Credit table instead of the goods qty/rate table.
    entryType?:  "DEBIT" | "CREDIT";
}

/// Customer-facing "Today's discount" ladder (display only). When present on the
/// sample, the renderer shows Gross-at-tag → Today's discount → (HSN summary) →
/// Total → "You saved ₹X (Y%)" INSTEAD of the legacy subtotal/tax/total block.
export interface ReceiptDiscountRow { label: string; amount: number; taxAmount?: number; taxRate?: number }
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
    /// Total GST embedded in the bill (goods + tax-bearing charges like
    /// shipping — see priceLadder's `taxTotal`). Drives the "incl. GST" note
    /// below the ladder total. Absent → falls back to summing `hsnSummary`
    /// (goods-only; undercounts when a charge carries its own tax).
    taxTotal?:    number;
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

/// Bank pay-in slip data for a Cash → Bank CONTRA, or a cash PAYMENT deposited
/// straight into the party's bank. When present, the A4 renderer swaps the
/// journal table for a deposit slip (bank block, blank denomination boxes,
/// depositor counterfoil the bank stamps and returns). Bank fields come from
/// the bank ledger / Organisation.bankJson (Contra) or the party's own bankJson
/// (Payment); denominations from OrgDefaults.cashDenominationsJson.
export interface DepositSlipInfo {
    /// "deposit" = cash → bank (bank block + counterfoil the bank stamps).
    /// "handover" = cash → cash (from/to ledgers + handed-by / received-by sigs,
    /// no bank block, no counterfoil). Both share the denomination worksheet.
    mode:          "deposit" | "handover";
    bankName:      string | null;
    branch:        string | null;
    accountName:   string | null;
    accountNo:     string | null;
    ifsc:          string | null;
    /// Depositor's PAN (org PAN) — banks ask for it on large cash deposits.
    pan?:          string | null;
    /// Cash PAYMENT only: the party the money is paid to. Set → the bank block is
    /// the PARTY's account, and the slip names them on its face and counterfoil.
    paidTo?:       string | null;
    /// Credit-side (source) ledger, e.g. "Cash in Hand" — where the cash came from.
    fromLedger:    string | null;
    /// Debit-side (destination) ledger — used in handover mode, e.g. "Vault".
    toLedger?:     string | null;
    /// Note denominations to print as blank count boxes, high → low. Used only
    /// when `counted` is absent (denomination capture was off — pen-fill mode).
    denominations: number[];
    /// Captured breakdown (UniversalVoucher.denomJson). When present the slip
    /// prints FILLED: only non-zero note rows, plus a cheque-details section.
    counted?: {
        notes:   { denom: number; count: number }[];   // high → low, count > 0
        cheques: { no: string; amount: number; account?: string }[];
    } | null;
}

export interface ThermalReceiptSample {
    reference: string;          // voucher / invoice number
    date:      string;          // ISO date or display date
    partyName: string | null;   // "Walk-in" if null
    partyPhone:string | null;
    /// Customer's saved address (free text, may be multi-line). Printed under
    /// the name on every bill; absent for walk-in.
    partyAddress?: string | null;
    lines:    ThermalReceiptLine[];
    subtotal:  number | null;   // null hides the subtotal row
    taxAmount: number | null;   // null hides the tax row
    total:     number | null;   // null hides the total row
    notes:     string | null;
    /// Optional CGST/SGST/IGST breakdown — overrides the single Tax row.
    taxBreakdown?: ThermalTaxBreakdown | null;
    /// Customer-facing price ladder (display only). When set, replaces the
    /// legacy subtotal/tax/total block with the "Today's discount" presentation.
    discounts?:  ReceiptDiscounts | null;
    /// HSN/rate-wise net tax summary (paired with `discounts`). Feeds the
    /// "incl. GST" note on the total — the slip has no rate-wise table, so
    /// nothing here is toggleable.
    hsnSummary?: ReceiptHsnRow[] | null;
    /// Buyer GSTIN — printed on the receipt for B2B tax invoices.
    partyGstin?: string | null;
    /// Buyer's state + code ("Assam, Code : 18") — printed under the Bill-To
    /// block; with the place of supply it justifies the CGST+SGST vs IGST split.
    partyState?: string | null;
    /// Terms of payment ("Credit — 30 days" / "Cash") and, for a credit sale,
    /// the derived due date. Null → the row is skipped.
    paymentTerms?: string | null;
    dueDate?:      string | null;
    /// Tally-style ledger rows printed UNDER the goods table and above the
    /// grand total — bill discount, service charges, shipping, round-off.
    /// Signed: a negative amount prints as `(-)x.xx`.
    charges?: ReceiptDiscountRow[] | null;
    /// Rounding adjustment. Printed as the LAST ledger row, after the GST legs,
    /// because it rounds the tax-inclusive figure — same place Tally puts it.
    roundOff?: number | null;
    /// Money already received against this voucher, one row per tender ledger.
    /// Comes from the settlement, so a reprint reflects payments as of now.
    receipts?: ReceiptDiscountRow[] | null;
    /// Outstanding after `receipts`. null / 0 → the balance line is hidden, so a
    /// fully-paid counter bill never shouts "Balance due ₹ 0.00".
    balanceDue?: number | null;
    /// Party ledger balance around the voucher — a money slip (RECEIPT/PAYMENT)
    /// or a bill (SALE/POS, printed under Balance due), preformatted with Dr/Cr
    /// (e.g. "₹ 7,315.00 Dr"). Null/absent → hidden (walk-in customers have
    /// no account of their own). Printed only with the "Party balance" toggle.
    balanceBefore?: string | null;
    balanceAfter?:  string | null;
    /// Bank pay-in slip block (CONTRA cash → bank / cash → cash, or a cash
    /// PAYMENT into the party's bank). Null/absent → the voucher keeps its
    /// normal print.
    depositSlip?: DepositSlipInfo | null;
    /// Issuing-branch address block (multi-line). Rendered only when the
    /// template's `showBranchAddress` flag is on and this is non-empty.
    branchAddress?: string | null;
    /// Challan printed with "Show prices" off (InvVoucher.showPrices): the goods
    /// print as item + qty only — no rate, amount or totals.
    hidePrices?: boolean;
}

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
        /* Denomination table — wider, right-padded count column so the count and
           amount don't crowd together. */
        ${s}.denom-lines .qty { width: 54px; padding-right: 16px; }
        ${s}.total  { font-weight: bold; font-size: ${t.fontSizePx + 1}px; }
        ${s}.small  { font-size: ${Math.max(8, t.fontSizePx - 2)}px; }
        ${s}.terms  { font-size: ${Math.max(8, t.fontSizePx - 3)}px; color: #444; line-height: 1.5; white-space: pre-wrap; }
        ${s}.sig-line { border-top: 1px solid #000; margin-top: 24px; padding-top: 2px; font-size: ${Math.max(8, t.fontSizePx - 3)}px; color: #555; }
        ${s}.doctitle { font-weight: bold; font-size: ${t.fontSizePx + 1}px; letter-spacing: 1px; text-transform: uppercase; margin-top: 6px; }
        ${s}.disclaimer { font-size: ${Math.max(7, t.fontSizePx - 4)}px; color: #666; font-style: italic; margin-top: 4px; }
        ${s}.barcode { max-width: 100%; height: auto; margin-inline: auto; }
        @media print {
            ${s}.no-print { display: none !important; }
${scope ? "" : `
            /* The page box MUST be declared, or the Windows driver falls back to
               its own default (A4/Letter). The receipt then centres itself inside
               that A4 width — leaving the left of an 80mm roll blank and pushing
               the body off the right edge. Same rule the shipping label already
               carries. @page is global, so it is only emitted in standalone
               document mode (scope === ""), never into the settings preview. */
            @page { size: ${t.paperWidthMm}mm auto; margin: 2mm; }
            body { padding: 0; }
            /* On paper the roll IS the width — no centring, no max-width. */
            .receipt { max-width: none; width: 100%; margin: 0; }
`}        }
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
    // headerLine1 is always filled by mergeTemplateWithOrg (Organisation brand
    // fallback) — one brand source, no second fallback here.
    const brand     = template.headerLine1;
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

            {/* Brand at double size, like the ESC/POS brand line (setTextSize 1,1 = 2× width and height). */}
            {template.showHeaderText && brand && (
                <div className="center" style={{ fontWeight: "bold", fontSize: template.fontSizePx * 2, lineHeight: 1.15 }}>
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

// Contra print variants rendering the bespoke denomination slip — BANK_DEPOSIT
// (cash → bank) and CASH_HANDOVER (cash → cash). Both go through
// DepositThermalMiddle, which branches on `sample.depositSlip.mode`. Plain CONTRA
// is NOT here — it keeps the neutral journal table. (Mirrors A4 DEPOSIT_SLIP_KINDS.)
const DEPOSIT_SLIP_KINDS = new Set(["BANK_DEPOSIT", "CASH_HANDOVER"]);

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
            {sample.partyAddress && (
                <div className="small" style={{ textAlign: "right", whiteSpace: "pre-line" }}>{sample.partyAddress}</div>
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
                    <span>{formatAmount(l.amount)}</span>
                </div>
            ))}
            {sample.notes && <div className="small" style={{ marginTop: 2 }}>Towards: {sample.notes}</div>}
            <div className="hr" />
            <div className="row total">
                <span>{isPayment ? "PAID" : "RECEIVED"}</span>
                <span>{formatAmount(total)}</span>
            </div>
            <div className="center small" style={{ marginTop: 2 }}>{rupeesInWords(total)}</div>
            {template.showPartyBalance && (sample.balanceBefore || sample.balanceAfter) && (
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

function ThermalReceiptsBlock({ template, sample }: { template: VoucherTemplateDefaults; sample: ThermalReceiptSample }) {
    const receipts = (sample.receipts ?? []).filter((r) => Math.abs(r.amount) > 0.005);
    const due      = sample.balanceDue ?? 0;
    if (receipts.length === 0 && due <= 0.005) return null;
    return (
        <>
            <div className="hr" />
            {receipts.map((r, i) => (
                <div key={i} className="row"><span>{r.label}</span><span>{formatAmount(r.amount)}</span></div>
            ))}
            {due > 0.005 && (
                <div className="row total"><span>Balance due</span><span>{formatAmount(due)}</span></div>
            )}
            {/* The party's running account — opt-in, as on the A4 settlement. */}
            {template.showPartyBalance && sample.balanceBefore && (
                <div className="row"><span>Previous balance</span><span>{sample.balanceBefore}</span></div>
            )}
            {template.showPartyBalance && sample.balanceAfter && (
                <div className="row total"><span>Closing balance</span><span>{sample.balanceAfter}</span></div>
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
            {sample.partyAddress && (
                <div className="small" style={{ textAlign: "right", whiteSpace: "pre-line" }}>{sample.partyAddress}</div>
            )}
            {PRINT_PARTY_GSTIN && sample.partyGstin && (
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
                        {!sample.hidePrices && <th className="amt">Amount</th>}
                    </tr>
                </thead>
                <tbody>
                    {sample.lines.map((l, i) => (
                        <tr key={i}>
                            <td>
                                {l.description}
                                {template.showLineNote && l.note && <div className="small">{l.note}</div>}
                                {template.showMrp && sample.discounts && l.mrp != null && l.mrp > l.amount + 0.005 && (
                                    <div className="small">MRP <s>{formatAmount(l.mrp)}</s></div>
                                )}
                            </td>
                            <td className="qty">{l.quantity}</td>
                            {!sample.hidePrices && <td className="amt">{formatAmount(l.amount)}</td>}
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
                    <div className="row"><span>Gross</span><span>{formatAmount(sample.discounts.grossAtTag)}</span></div>
                    {sample.discounts.rows.map((d, i) => (
                        <div key={i} className="row"><span>{d.label}</span><span>&minus; {formatAmount(d.amount)}</span></div>
                    ))}
                    {(sample.discounts.charges ?? []).map((c, i) => (
                        <div key={`c${i}`} className="row"><span>{c.label}</span><span>{c.amount < 0 ? "−" : "+"} {formatAmount(Math.abs(c.amount))}</span></div>
                    ))}
                    <div className="hr" />
                    <div className="row total"><span>Total</span><span>{formatAmount(sample.total ?? sample.discounts.grossAtTag - sample.discounts.total)}</span></div>
                    {/* GST is INCLUDED in the inclusive line amounts above — shown as a
                        note on the total, not a column row (so the math reads correctly).
                        Part of the total block, so it always prints. */}
                    {sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
                        const inter = sample.taxBreakdown?.kind === "INTER";
                        // Prefer the ladder's complete total (goods + tax-bearing
                        // charges like shipping); fall back to goods-only for
                        // callers that haven't supplied it yet.
                        const tax = sample.discounts?.taxTotal
                            ?? sample.hsnSummary.reduce((s, h) => s + h.cgst + h.sgst, 0);
                        return tax > 0.005 ? (
                            <div className="row small"><span>incl. {inter ? "GST (IGST)" : "GST (CGST+SGST)"}</span><span>{formatAmount(tax)}</span></div>
                        ) : null;
                    })()}
                    {sample.discounts.savingsTotal > 0 && (
                        <div className="row total" style={{ marginTop: 2 }}>
                            <span>You saved</span>
                            <span>{formatAmount(sample.discounts.savingsTotal)} ({sample.discounts.savingsPct}%)</span>
                        </div>
                    )}
                </>
            ) : (
                <>
                    {/* Subtotal + the GST legs build the Total — never toggleable. */}
                    {sample.subtotal !== null && (
                        <>
                            <div className="hr" />
                            <div className="row"><span>Subtotal</span><span>{formatAmount(sample.subtotal)}</span></div>
                            {sample.taxBreakdown ? (
                                sample.taxBreakdown.kind === "INTRA" ? (
                                    <>
                                        <div className="row"><span>CGST</span><span>{formatAmount(sample.taxBreakdown.cgst)}</span></div>
                                        <div className="row"><span>SGST</span><span>{formatAmount(sample.taxBreakdown.sgst)}</span></div>
                                    </>
                                ) : (
                                    <div className="row"><span>IGST</span><span>{formatAmount(sample.taxBreakdown.igst)}</span></div>
                                )
                            ) : sample.taxAmount !== null && sample.taxAmount > 0 && (
                                <div className="row"><span>Tax</span><span>{formatAmount(sample.taxAmount)}</span></div>
                            )}
                        </>
                    )}

                    {sample.total !== null && (
                        <>
                            <div className="hr" />
                            <div className="row total"><span>Total</span><span>{formatAmount(sample.total)}</span></div>
                        </>
                    )}
                </>
            )}

            {/* Tenders received (one row per ledger) + balance due — the counter
                slip's Cash / UPI / Card rows. A reprint shows payments as of now. */}
            <ThermalReceiptsBlock template={template} sample={sample} />

            {/* No narration on the counter slip either — it is internal
                bookkeeping text, not customer-facing. Per-line item notes still
                print with their item. */}
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

            {template.kind !== "SHIFT_CLOSE" && template.showSignature && (
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
// Bespoke 80mm middle for a deposit (Contra cash → bank, or a cash Payment into
// the party's bank) / a Contra handover. A thermal print is NOT
// accepted at the bank counter — it's a WORKSHEET the carrier fills the bank's
// own pay-in slip from (deposit) or a handover record (cash → cash). Shows the
// bank/ledger block + the denomination breakdown (filled when captured, blank
// pen-fill rows otherwise) + cheque list + total.
function DepositThermalMiddle({ sample }: { sample: ThermalReceiptSample }) {
    const slip  = sample.depositSlip!;
    const isHandover = slip.mode === "handover";
    const voucherTotal = sample.total ?? 0;
    const counted = slip.counted && (slip.counted.notes.length || slip.counted.cheques.length)
        ? slip.counted : null;
    const notes    = slip.denominations.filter((d) => d >= 10);
    const hasCoins = slip.denominations.some((d) => d < 10);
    const bankLine = [slip.bankName, slip.branch].filter(Boolean).join(", ");
    // Denomination amounts print WITHOUT the currency symbol — on an 80mm roll the
    // prefix pushes the number onto a second line. Currency is clear from the
    // symbol-led total below. nowrap keeps each amount on one right-aligned line.
    const cashTotal   = counted ? counted.notes.reduce((s, n) => s + n.denom * n.count, 0) : 0;
    const chequeTotal = counted ? counted.cheques.reduce((s, c) => s + c.amount, 0) : 0;
    // Slip = physical deposit (cash + cheques); pen-fill mode → voucher total.
    const total = counted ? cashTotal + chequeTotal : voucherTotal;
    return (
        <>
            {/* Title comes from the customizable doctitle (template.headerLine2)
                in ReceiptBody — no hardcoded title here. */}
            {!isHandover && (
                <div className="center small">Worksheet — fill the bank&rsquo;s own slip from this</div>
            )}
            <div className="hr" />
            <div className="row"><span>{sample.reference}</span><span>{sample.date}</span></div>
            <div className="hr" />
            {isHandover ? (
                <>
                    {slip.fromLedger && <div className="row"><span>From</span><span>{slip.fromLedger}</span></div>}
                    {slip.toLedger   && <div className="row"><span>To</span><span>{slip.toLedger}</span></div>}
                </>
            ) : (
                <>
                    {slip.paidTo    && <div className="row"><span>Paid to</span><span style={{ textAlign: "right" }}>{slip.paidTo}</span></div>}
                    {bankLine       && <div className="row"><span>Bank</span><span style={{ textAlign: "right" }}>{bankLine}</span></div>}
                    {slip.paidTo && slip.accountName && <div className="row"><span>A/C Name</span><span style={{ textAlign: "right" }}>{slip.accountName}</span></div>}
                    {slip.accountNo && <div className="row"><span>A/C</span><span>{slip.accountNo}</span></div>}
                    {slip.ifsc      && <div className="row"><span>IFSC</span><span>{slip.ifsc}</span></div>}
                    {slip.pan       && <div className="row"><span>PAN</span><span>{slip.pan}</span></div>}
                    {slip.fromLedger && <div className="row"><span>From</span><span>{slip.fromLedger}</span></div>}
                </>
            )}
            <div className="hr" />
            {counted ? (
                <>
                    <table className="lines denom-lines">
                        <thead><tr><th>Note</th><th className="qty">Cnt</th><th className="amt">Amount</th></tr></thead>
                        <tbody>
                            {counted.notes.map((n) => (
                                <tr key={n.denom}>
                                    <td>{n.denom} &times;</td>
                                    <td className="qty">{n.count}</td>
                                    <td className="amt" style={{ whiteSpace: "nowrap" }}>{formatAmount(n.denom * n.count)}</td>
                                </tr>
                            ))}
                            {counted.notes.length > 0 && (
                                <tr>
                                    <td style={{ borderTop: "1px solid #000" }}><b>Cash</b></td>
                                    <td className="qty" style={{ borderTop: "1px solid #000" }}><b>{counted.notes.reduce((s, n) => s + n.count, 0)}</b></td>
                                    <td className="amt" style={{ borderTop: "1px solid #000", whiteSpace: "nowrap" }}><b>{formatAmount(cashTotal)}</b></td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    {counted.cheques.length > 0 && (
                        <>
                            <div className="small" style={{ marginTop: 4 }}>Cheques:</div>
                            {counted.cheques.map((c, i) => (
                                <div className="row" key={i}>
                                    <span>{c.account ? `${c.account} · ${c.no}` : c.no}</span>
                                    <span>{formatAmount(c.amount)}</span>
                                </div>
                            ))}
                        </>
                    )}
                </>
            ) : (
                <table className="lines denom-lines">
                    <thead><tr><th>Note</th><th className="qty">Cnt</th><th className="amt">Amount</th></tr></thead>
                    <tbody>
                        {notes.map((d) => (
                            <tr key={d}><td>{d} &times;</td><td className="qty">____</td><td className="amt">_______</td></tr>
                        ))}
                        {hasCoins && <tr><td>Coins</td><td className="qty">____</td><td className="amt">_______</td></tr>}
                    </tbody>
                </table>
            )}
            <div className="hr" />
            <div className="row total">
                <span>{isHandover ? "HANDED OVER" : "DEPOSIT"}</span>
                <span>{formatAmount(total)}</span>
            </div>
            <div className="center small" style={{ marginTop: 2 }}>{rupeesInWords(total)}</div>
            {isHandover ? (
                <div className="row" style={{ marginTop: 26 }}>
                    <span className="sig-line" style={{ width: "45%" }}>Handed over by</span>
                    <span className="sig-line" style={{ width: "45%" }}>Received by</span>
                </div>
            ) : (
                <div className="sig-line">Depositor&rsquo;s Signature</div>
            )}
        </>
    );
}

// Journal-style GL vouchers (plain Contra, Journal) — a double-entry document.
// Prints each ledger leg as "Account Dr/Cr … amount" + a balancing total, never
// the goods Item/Qty table. (Mirrors JournalMiddle on A4.)
const JOURNAL_KINDS = new Set(["CONTRA", "JOURNAL"]);

function JournalThermalMiddle({ sample }: { sample: ThermalReceiptSample }) {
    const lines   = sample.lines;
    const totalDr = lines.filter((l) => l.entryType !== "CREDIT").reduce((s, l) => s + l.amount, 0);
    const grand   = sample.total ?? totalDr;
    return (
        <>
            <div className="row"><span>{sample.reference}</span><span>{sample.date}</span></div>
            <div className="hr" />
            {lines.map((l, i) => {
                const isCr = l.entryType === "CREDIT";
                return (
                    <div className="row" key={i}>
                        <span>{isCr ? "  " : ""}{l.description} <b>{isCr ? "Cr" : "Dr"}</b></span>
                        <span>{formatAmount(l.amount)}</span>
                    </div>
                );
            })}
            <div className="hr" />
            <div className="row total"><span>Total</span><span>{formatAmount(totalDr)}</span></div>
            <div className="center small" style={{ marginTop: 2 }}>{rupeesInWords(grand)}</div>
            {sample.notes && <div className="small" style={{ marginTop: 4 }}>Narration: {sample.notes}</div>}
        </>
    );
}

function ReceiptBody({ template, sample, body }: BodyProps) {
    return (
        <div className="receipt">
            <ThermalHeader template={template} sample={sample} />
            <div className="hr" />
            {/* Document title — below the divider, sitting right above the ticket
                no / ref that the body opens with, so it reads as the heading of
                what follows rather than a small line lost in the identity block.
                Customizable via template.headerLine2 for every kind, including the
                Contra deposit / handover slip. */}
            {template.headerLine2 && (
                <div className="center doctitle" style={{ marginTop: 0, marginBottom: 6 }}>{template.headerLine2}</div>
            )}
            {body ?? (DEPOSIT_SLIP_KINDS.has(template.kind) && sample.depositSlip
                ? <DepositThermalMiddle sample={sample} />
                : MONEY_RECEIPT_KINDS.has(template.kind)
                ? <MoneyThermalMiddle template={template} sample={sample} />
                : JOURNAL_KINDS.has(template.kind)
                ? <JournalThermalMiddle sample={sample} />
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
    /** document.title when not in previewMode (applied via SetDocumentTitle). */
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

    // Full-document mode still renders into the app's normal <html>/<body> (set
    // by the root layout) — it does NOT mount its own. A second <html>/<body>
    // nested inside the first used to work by accident (browsers merge
    // duplicate <body> tags while parsing) but made React throw a "mounting a
    // new body" console error. `docTitle` is applied to document.title via
    // SetDocumentTitle instead of a hand-rolled <title> tag.
    return (
        <>
            <SetDocumentTitle title={docTitle ?? sample.reference} />
            <style>{inlineStyleFromTemplate(template, "")}</style>
            {toolbar}
            <ReceiptBody template={template} sample={sample} body={body} />
        </>
    );
}
