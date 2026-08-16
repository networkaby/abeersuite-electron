/**
 * A4 invoice / voucher renderer. Sibling of <ThermalReceiptPreview>; shares
 * the same `template` + `sample` shape so both formats can be driven from
 * the same row in VoucherPrintTemplate.
 *
 * Layout (top → bottom):
 *   1. Letterhead band — logo (optional) + brand name + address + GSTIN + phone.
 *   2. Title banner — uses `headerLine2` ("Tax Invoice", "POS sale receipt", …).
 *   3. Bill-To / Invoice-Details two-column band (buyer GSTIN + state, terms of
 *      payment, due date, place of supply — all skipped when absent).
 *   4. Goods table. Two shapes, picked by the sample:
 *      • `sample.discounts` set → the POS customer price ladder (qty · MRP ·
 *        rate · amount, then the Gross → Special Discount → Grand Total box).
 *      • otherwise → the Tally tax-invoice table: HSN/SAC · per · line note ·
 *        line discount, with the bill charges and the GST legs as LEDGER ROWS
 *        inside the table, ending at the Total. See <GoodsTable>.
 *   5. Amount chargeable in words + E. & O.E.
 *   6. HSN/SAC rate-wise tax summary + tax amount in words.
 *   7. Settlement — money received per tender, and the balance if any is due.
 *   8. Terms + bank block + signature + footer line + barcode.
 */

import { isSupplierPartyKind, type VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import { rupeesInWords } from "@/shared/lib/format/numberToWords";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { QrSvg } from "@/shared/components/print/QrSvg";
import SetDocumentTitle from "@/shared/components/print/SetDocumentTitle";
import { gstinDerivedStateCode } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode } from "@/shared/lib/gst/indianStates";

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
            /* Push the page footer to the bottom of the sheet so "Page 1 of 2"
               sits on the paper edge, not directly under the last row. */
            display: flex;
            flex-direction: column;
        }
        ${s}.a4-sheet > .pagefoot { margin-top: auto; }
        /* Second and later sheets start on a fresh page when printed, and are
           visually separated in the on-screen preview. */
        ${s}.a4-sheet + .a4-sheet {
            break-before: page;
            page-break-before: always;
            border-top: 1px dashed #bbb;
        }
        /* Sign-off sits at the foot of its sheet, below whatever content the
           sheet carries, so a short page still signs at the bottom edge. */
        ${s}.signoff { margin-top: auto; }
        ${s}.pagefoot {
            margin-top: 10px;
            border-top: 1px solid #d0d0d0;
            padding-top: 4px;
            text-align: center;
            font-size: 9px;
            color: #777;
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
        ${s}.header { border-bottom: 2px solid #111; padding-bottom: 5px; }
        ${s}.brand  { font-size: 22px; font-weight: 700; letter-spacing: 0.4px; }
        /* Document title — plain centred heading, no box. The letterhead rule
           above it already separates it from the address block; a second border
           around the words just adds furniture. */
        ${s}.banner {
            text-align: center;
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 4px;
            text-transform: uppercase;
            padding: 2px 0;
            margin: 7px 0 6px;
        }
        /* Deposit / handover slip — plain centred heading, no boxed border. */
        ${s}.banner.banner-plain {
            border: 0;
            padding: 0;
            margin: 12px 0 10px;
        }
        /* Bill-To / Voucher-Details band — deliberately tight. It is reference
           data the reader scans once, so padding here is bought straight out of
           the item table's space on every single sheet. */
        /* Sits flush on the goods table so the two read as one continuous
           frame. Its own bottom border is dropped — the goods table's top
           border is the shared rule, otherwise the two stack into a double
           line. */
        ${s}.meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            margin-bottom: 0;
            border: 1px solid #111;
            border-bottom: 0;
        }
        /* One table, two cells — a single frame with an internal rule, the way
           Tally prints the buyer / invoice band. Two separately-bordered cards
           with a gap read as two unrelated boxes. */
        ${s}.meta-card {
            border-right: 1px solid #c8c8c8;
            padding: 4px 8px;
            line-height: 1.35;
        }
        ${s}.meta-card:last-child { border-right: 0; }
        /* Annexure sheet: no goods table follows, so the band closes itself. */
        ${s}.meta-grid-closed { border-bottom: 1px solid #111; }
        ${s}.meta-card .label {
            font-size: 9px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-bottom: 1px;
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
        /* ── Tally-style goods table (tax invoices) ──────────────────────────
           Deliberately NOT the .lines table: no horizontal rule between item
           rows (the items read as one block, like a Tally voucher), and the
           GST / bill-charge ledger rows live INSIDE the table so the printed
           column of figures is one continuous arithmetic. */
        ${s}table.goods {
            width: 100%;
            border-collapse: collapse;
            margin-top: 0;
            font-size: 11px;
            border: 1px solid #111;
        }
        ${s}table.goods th {
            background: #f4f4f4;
            border-bottom: 1px solid #111;
            border-right: 1px solid #c8c8c8;
            padding: 5px 4px;
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        ${s}table.goods td {
            border-right: 1px solid #c8c8c8;
            padding: 4px;
            vertical-align: top;
        }
        ${s}table.goods th:last-child, ${s}table.goods td:last-child { border-right: 0; }
        ${s}table.goods td.num { text-align: right; font-variant-numeric: tabular-nums; }
        ${s}table.goods td.ctr, ${s}table.goods th.ctr { text-align: center; }
        ${s}table.goods th.num { text-align: right; }
        ${s}table.goods .item { font-weight: 600; }
        /* Line remark — indented under the item name so it reads as a note on
           the item, never as a second product. */
        ${s}table.goods .note {
            font-weight: 400;
            font-style: italic;
            color: #555;
            font-size: 10px;
            padding-left: 10px;
        }
        /* Rule above the item subtotal — Tally draws it over the Amount figure
           only, marking where goods stop and ledger rows begin. */
        /* The rule marking "goods stop here" runs the FULL row width — Tally
           draws it edge to edge under the last item, not just above the
           subtotal figure — so it continues left through the empty cell(s)
           between the description and the amount column. */
        ${s}table.goods tr.subtotal td { border-top: 1px solid #111; }
        /* The ledger region (item subtotal → charges → GST → round-off) is OPEN
           space in a Tally voucher: the column rules stop at the last goods row
           and only the outer frame continues. Without this the collapsed column
           borders keep painting down through the spanned cells and read as
           stray vertical bars beside the figures. */
        ${s}table.goods tr.ledger td, ${s}table.goods tr.subtotal td { border-right: 0; }
        ${s}table.goods tr.ledger td { padding: 1.5px 6px; font-style: italic; }
        ${s}table.goods tr.grand td {
            border-top: 1px solid #111;
            background: #f4f4f4;
            font-weight: 700;
        }
        /* ── Multi-page behaviour ────────────────────────────────────────────
           A long bill runs onto a second sheet: repeat the column header on
           every page, never split a line across the break, and keep the
           closing blocks (words · HSN summary · settlement · signature)
           together so the arithmetic is never orphaned from its total. */
        @media print {
            ${s}table.goods thead { display: table-header-group; }
            ${s}table.goods tr { break-inside: avoid; page-break-inside: avoid; }
            ${s}table.goods tr.grand { break-before: avoid; page-break-before: avoid; }
            ${s}.eoe, ${s}table.hsn, ${s}.settle, ${s}.signoff-row {
                break-inside: avoid; page-break-inside: avoid;
            }
        }
        ${s}.eoe {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 16px;
            margin-top: 4px;
        }
        /* Settlement columns: tendered on the left, balances on the right. The
           two carry a different number of rows, so they are aligned on their
           BOTTOM edge — that puts "Total received" and "Closing balance", the
           figures a reader compares, on one line instead of staggered. */
        ${s}.settle {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 28px;
            margin-top: 8px;
            border-top: 1px solid #d0d0d0;
            padding-top: 6px;
            font-size: 11px;
        }
        /* Balance block hugs the right margin — the auto left margin keeps it
           there even on a pure credit sale, where the tender column is absent
           and it is the flex row's only child. */
        ${s}.settle-right { margin-left: auto; min-width: 260px; }
        ${s}.settle-row { display: flex; justify-content: space-between; gap: 16px; padding: 1px 0; }
        ${s}.totals {
            display: flex;
            justify-content: flex-end;
            align-items: flex-start;
            gap: 20px;
            margin-top: 8px;
        }
        ${s}.totals-box {
            min-width: 280px;
            border: 1px solid #c8c8c8;
            border-radius: 2px;
        }
        /* Today's-discount itemisation parked left of the ladder; the ladder
           collapses these to one highlighted "Special Discount" row. Below it,
           the MRP saving (vs sticker) sits in its own green box. */
        ${s}.disc-detail { flex: 1; padding: 2px 0 0 2px; font-size: 11px; color: #555; min-width: 280px; }
        ${s}.disc-detail-h {
            text-transform: uppercase; letter-spacing: 1px;
            color: #999; font-size: 10px; margin-bottom: 4px;
        }
        ${s}.disc-detail-row {
            display: flex; justify-content: space-between; gap: 12px;
            padding: 1.5px 0;
        }
        ${s}.disc-detail-row span:first-child { flex: 1; }
        ${s}.disc-detail-row span:last-child { white-space: nowrap; }
        /* Box expands to fill available width so the "MRP … − you
           pay …" note stays on one row instead of wrapping. */
        ${s}.mrp-save {
            flex: 1; min-width: 240px; margin-top: 12px; padding: 9px 14px;
            background: #eafaf1; border: 1px solid #a7e0c4; border-radius: 3px;
        }
        ${s}.mrp-save-top {
            display: flex; justify-content: space-between; gap: 24px;
            color: #047857; font-weight: 700; font-size: 13px;
        }
        ${s}.mrp-save-note {
            font-size: 10px; color: #5a9c7e; margin-top: 2px; white-space: nowrap;
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
        /* The special (today's) discount — the reduction vs the regular price —
           highlighted so it reads as the headline offer on the ladder. */
        ${s}.totals-box .trow.special {
            background: #fff3d9;
            font-weight: 700;
            color: #8a5a00;
        }
        ${s}table.hsn {
            width: 100%;
            border-collapse: collapse;
            margin-top: 6px;
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
            margin-top: 5px;
            font-size: 11px;
            font-style: italic;
            color: #333;
        }
        ${s}.terms {
            margin-top: 9px;
            font-size: 10px;
            color: #444;
            white-space: pre-wrap;
            line-height: 1.5;
        }
        /* Bank block (left) and signature (right) on one row, bottoms aligned
           — align-items: flex-end is what does the aligning, so a tall bank
           block and a short signature label still finish on the same line. */
        ${s}.signoff-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 20px;
            margin-top: 12px;
            font-size: 10px;
            color: #444;
        }
        ${s}.signoff-bank { flex: 1; min-width: 0; }
        ${s}.sig-block {
            min-width: 200px;
            text-align: center;
            border-top: 1px solid #111;
            padding-top: 4px;
            font-size: 10px;
            color: #555;
        }
        ${s}.footer-line {
            margin-top: 5px;
            text-align: center;
            font-size: 10px;
            color: #555;
        }
        ${s}.disclaimer {
            margin-top: 1px;
            text-align: center;
            font-size: 9px;
            font-style: italic;
            color: #777;
        }
        /* Sized by width, not transform: BarcodeSvg carries a viewBox, so the
           height follows proportionally and no leftover whitespace is reserved
           the way scale() would.
           An absolute mm width (not a %) keeps it the same physical size on
           every sheet. 60mm is about a third of the content column and is the
           floor for a ~14-character Code128 to stay reliably scannable — going
           much narrower shrinks the bar modules past what cheap scanners read. */
        ${s}.barcode { max-width: 60mm; height: auto; display: block; margin-inline: auto; }
        ${s}.barcode-corner { margin-top: 4px; text-align: center; }
        /* Money-receipt middle (RECEIPT / PAYMENT) — receipt-book prose with
           dotted fill-ins and a boxed amount. */
        ${s}.mr-meta {
            display: flex; justify-content: space-between;
            margin: 2px 0 14px; font-size: 11px;
        }
        ${s}.mr-prose { font-size: 13px; line-height: 2.5; }
        ${s}.mr-fill {
            font-weight: 700; border-bottom: 1px dotted #999; padding: 0 8px;
        }
        ${s}.mr-fill.mr-normal { font-weight: 400; }
        ${s}.mr-amt-row {
            display: flex; justify-content: space-between;
            align-items: flex-end; gap: 24px; margin-top: 20px;
        }
        ${s}.mr-amt-box {
            border: 2px solid #111; border-radius: 3px;
            padding: 8px 18px; font-size: 18px; font-weight: 700;
        }
        /* Party ledger strip — outstanding before this voucher, this amount,
           outstanding after. Only for parties with a ledger account. */
        ${s}.mr-bal { min-width: 230px; font-size: 11px; }
        ${s}.mr-bal-row {
            display: flex; justify-content: space-between;
            gap: 16px; padding: 2px 0;
        }
        ${s}.mr-bal-row.grand {
            border-top: 1px solid #111; font-weight: 700; font-size: 12px;
            margin-top: 2px; padding-top: 3px;
        }
        /* Bank deposit slip (CONTRA cash → bank) — pay-in slip with blank
           denomination boxes and a depositor counterfoil the bank stamps. */
        ${s}.ds-bank {
            border: 1px solid #111; border-radius: 2px;
            padding: 6px 12px; margin-bottom: 10px;
        }
        ${s}.ds-bank .brow { display: flex; padding: 2px 0; font-size: 11px; }
        ${s}.ds-bank .brow .l { width: 110px; color: #555; flex-shrink: 0; }
        ${s}table.ds-denoms {
            width: 100%; border-collapse: collapse; font-size: 11px;
        }
        ${s}table.ds-denoms th, ${s}table.ds-denoms td {
            border: 1px solid #c8c8c8; padding: 4px 8px;
        }
        ${s}table.ds-denoms th {
            border-color: #111; background: #f4f4f4; font-weight: 600;
            font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
        }
        ${s}table.ds-denoms td.cnt { width: 70px; }
        ${s}table.ds-denoms td.amt { width: 90px; text-align: right; }
        ${s}table.ds-denoms tr.tot td { border-top: 2px solid #111; font-weight: 700; }
        ${s}.ds-amt-box {
            border: 2px solid #111; border-radius: 3px;
            text-align: center; padding: 8px 12px;
        }
        ${s}.ds-amt-box .cap {
            font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.6px;
        }
        ${s}.ds-amt-box .val { font-size: 18px; font-weight: 700; }
        ${s}.ds-fill { border-bottom: 1px dotted #999; padding: 0 8px; }
        ${s}.ds-sigs {
            display: flex; justify-content: space-between; margin-top: 56px;
        }
        ${s}.ds-sig {
            width: 170px; text-align: center; border-top: 1px solid #111;
            padding-top: 4px; font-size: 10px; color: #555;
        }
        ${s}.ds-cut {
            display: flex; align-items: center; gap: 10px;
            margin: 16px 0; color: #999; font-size: 9px; letter-spacing: 1px;
        }
        ${s}.ds-cut::before, ${s}.ds-cut::after {
            content: ""; flex: 1; border-top: 1.5px dashed #999;
        }
        ${s}.ds-foil { border: 1.5px solid #111; border-radius: 2px; padding: 8px 12px; }
        ${s}.ds-foil-h {
            display: flex; justify-content: space-between;
            font-size: 10px; margin-bottom: 4px;
        }
        ${s}.ds-foil-h .t { font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
        ${s}.ds-foil .brow { display: flex; padding: 1.5px 0; font-size: 11px; }
        ${s}.ds-foil .brow .l { width: 110px; color: #555; flex-shrink: 0; }
        ${s}.ds-stamp-row {
            display: flex; justify-content: space-between;
            align-items: flex-end; gap: 20px; margin-top: 10px;
        }
        ${s}.ds-stamp-note { font-size: 9px; color: #666; max-width: 250px; }
        ${s}.ds-stamp {
            border: 1px dashed #999; width: 170px; height: 58px;
            display: flex; align-items: center; justify-content: center;
            text-align: center; font-size: 9.5px; color: #888;
        }
        /* The sheet IS the page: it already carries A4 geometry and its own
           14mm/12mm margin as padding. Without this the browser adds its
           default page margin on top of a full-height 297mm box, so every
           sheet overflows by that margin and emits a trailing near-blank
           page — the classic "my one-page invoice prints as two". */
        @page { size: A4; margin: 0; }
        @media print {
            ${s}.no-print { display: none !important; }
            ${rootRule} { background: #fff; }
            /* A sheet exactly as tall as the page box spills a blank page on
               sub-pixel rounding, which is where the stray empty sheet between
               the voucher and the annexure came from. A few mm of slack costs
               nothing visually — the sign-off is still bottom-anchored — and
               guarantees each sheet stays inside its own page. */
            ${s}.a4-sheet { padding: 14mm 12mm; min-height: 288mm; }
            /* Terms + bank/QR, and the sign-off strip, each move as ONE unit.
               Splitting them means a page carrying nothing but a barcode or a
               lone disclaimer line, which reads as an accident; if either has to
               go over, the whole meaningful group goes with it. The sign-off
               needs this as much as the terms — the barcode is its last child
               and is exactly what used to spill on its own. */
            ${s}.footer-block, ${s}.signoff {
                break-inside: avoid; page-break-inside: avoid;
            }
        }
    `;
}

interface InvoiceBodyProps {
    template: VoucherTemplateDefaults;
    sample: ThermalReceiptSample;
    /** Custom middle for bespoke documents (repair ticket / shipping slip /
     *  payment slip). Replaces the invoice meta/lines/totals block; the
     *  template-driven letterhead + footer chrome stay shared. */
    body?: React.ReactNode;
}

type A4ChromeProps = { template: VoucherTemplateDefaults; sample: ThermalReceiptSample };

/** Template-driven letterhead (logo · brand · address · GSTIN · phone) + banner. */
function A4Header({ template, sample }: A4ChromeProps) {
    const brand = template.headerLine1 || COMPANY_DETAILS.brandName;
    const addrLines = template.addressBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    // The configured lines often already carry their own label ("GSTIN: 18AX…",
    // "Ph: +91 …") because that's how they read in the settings field. Strip it
    // so the rendered row doesn't print "GSTIN: GSTIN: 18AX…".
    const unlabel = (v: string, label: RegExp) => v.replace(label, "").trim();
    const gstin = unlabel(template.gstinLine, /^\s*GSTIN(\s*\/\s*UIN)?\s*[:\-]?\s*/i);
    const phone = unlabel(template.phoneLine, /^\s*(Ph|Phone|Tel|Mob(ile)?)\s*[:\-]?\s*/i);
    // A tax invoice must state the supplier's state and code. The GSTIN encodes
    // it in its first two characters, so no extra configuration is needed.
    const sellerStateCode = gstinDerivedStateCode(gstin);
    const sellerState = stateNameForCode(sellerStateCode);

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
                    {template.showGstin && gstin && (
                        <div className="small">
                            <span className="muted">GSTIN/UIN: </span>
                            <span className="bold">{gstin}</span>
                        </div>
                    )}
                    {template.showGstin && sellerState && (
                        <div className="small">
                            <span className="muted">State Name: </span>
                            <span>{sellerState}, Code : {sellerStateCode}</span>
                        </div>
                    )}
                    {template.showPhone && phone && (
                        <div className="small">
                            <span className="muted">Ph: </span>
                            <span>{phone}</span>
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
                 text is hidden). The deposit / handover slip drops the boxed
                 border and shows a plain centred heading instead. */}
            {template.headerLine2 && (
                <div className={`banner${DEPOSIT_SLIP_KINDS.has(template.kind) ? " banner-plain" : ""}`}>
                    {template.headerLine2}
                </div>
            )}
        </>
    );
}

// Money vouchers get the receipt-book middle below instead of the goods
// invoice table — a ₹5,000 cash receipt is not a sale and shouldn't look
// like one. Deliberately bespoke; do NOT fold back into DefaultA4Middle.
const MONEY_RECEIPT_KINDS = new Set(["RECEIPT", "PAYMENT"]);

// Contra print variants that render the bespoke denomination slip: BANK_DEPOSIT
// carries the bank pay-in slip, CASH_HANDOVER the cash→cash handover slip. Both
// go through DepositSlipMiddle, which branches on `sample.depositSlip.mode`.
// Plain CONTRA is NOT here — it keeps the neutral journal table.
const DEPOSIT_SLIP_KINDS = new Set(["BANK_DEPOSIT", "CASH_HANDOVER"]);

/** Bespoke middle for money vouchers — classic receipt-book prose
 *  ("Received with thanks from ___ the sum of Rupees ___") with dotted
 *  fill-ins and a boxed amount. Letterhead + footer chrome stay shared. */
function MoneyReceiptMiddle({ template, sample }: A4ChromeProps) {
    const isPayment = template.kind === "PAYMENT";
    const total = sample.total ?? 0;
    // "by" = the payment instrument line(s) on the voucher (Cash / UPI / Bank).
    // A split tender lists each with its amount.
    const modes = sample.lines.filter((l) => l.description.trim());
    const byText = modes.length > 1
        ? modes.map((l) => `${l.description} (${fmtINR(l.amount)})`).join(", ")
        : modes[0]?.description ?? "";
    return (
        <>
            <div className="mr-meta">
                <div>
                    <span className="muted">{isPayment ? "Voucher No.: " : "Receipt No.: "}</span>
                    <span className="bold">{sample.reference}</span>
                </div>
                <div>
                    <span className="muted">Date: </span>
                    <span className="bold">{sample.date}</span>
                </div>
            </div>

            <div className="mr-prose">
                <div>
                    {isPayment ? "Paid to" : "Received with thanks from"}
                    {" "}<span className="mr-fill">{sample.partyName ?? "Walk-in"}</span>
                    {sample.partyPhone && <span className="small muted"> ({sample.partyPhone})</span>}
                </div>
                <div>
                    the sum of Rupees <span className="mr-fill">{rupeesInWords(total).replace(/^Rupees /, "")}</span>
                </div>
                {(byText || sample.notes) && (
                    <div>
                        {byText && <>by <span className="mr-fill">{byText}</span></>}
                        {sample.notes && <>{byText ? " towards " : "towards "}<span className="mr-fill mr-normal">{sample.notes}</span></>}
                    </div>
                )}
            </div>

            <div className="mr-amt-row">
                <div className="mr-amt-box">{fmtINR(total)}</div>
                {(sample.balanceBefore || sample.balanceAfter) && (
                    <div className="mr-bal">
                        {sample.balanceBefore && (
                            <div className="mr-bal-row">
                                <span className="muted">Balance Before</span>
                                <span>{sample.balanceBefore}</span>
                            </div>
                        )}
                        <div className="mr-bal-row">
                            <span className="muted">{isPayment ? "This Payment" : "This Receipt"}</span>
                            <span>&minus; {fmtINR(total)}</span>
                        </div>
                        {sample.balanceAfter && (
                            <div className="mr-bal-row grand">
                                <span>Balance After</span>
                                <span>{sample.balanceAfter}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

/** Bespoke middle for a Cash → Bank CONTRA — a bank pay-in slip. Top portion
 *  goes to the bank with the cash (blank denomination boxes filled by pen);
 *  the counterfoil below the cut line is the depositor's copy, which the
 *  teller stamps and signs and hands back as proof of deposit. */
function DepositSlipMiddle({ sample }: A4ChromeProps) {
    const slip = sample.depositSlip!;
    const voucherTotal = sample.total ?? 0;
    // Captured mode (denomJson saved on the voucher): print FILLED — only the
    // non-zero note rows plus the cheque list. Pen-fill mode (capture off):
    // notes get blank count boxes; coins/small change collapse to one row
    // (same as a real pay-in slip, which lists notes and a single coins line).
    const counted = slip.counted && (slip.counted.notes.length || slip.counted.cheques.length)
        ? slip.counted : null;
    // The pay-in slip reflects only the PHYSICAL deposit — cash counted + cheques.
    // Any non-cash, non-cheque source (a wallet/UPI settlement) stays on the
    // voucher but off the slip, so the amount can be below the voucher total.
    // Blank pen-fill mode has no breakdown, so it falls back to the voucher total.
    const cashTotal = counted ? counted.notes.reduce((s, n) => s + n.denom * n.count, 0) : 0;
    const chequeTotal = counted ? counted.cheques.reduce((s, c) => s + c.amount, 0) : 0;
    const total = counted ? cashTotal + chequeTotal : voucherTotal;
    const words = rupeesInWords(total);
    const notes = slip.denominations.filter((d) => d >= 10);
    const hasCoins = slip.denominations.some((d) => d < 10);
    const bankLine = [slip.bankName, slip.branch].filter(Boolean).join(", ");
    const fmtNum = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // "handover" = cash → cash (an internal transfer between tills/vault). No
    // bank block, no bank-acknowledgment counterfoil — just a from/to record
    // with handed-by / received-by signatures.
    const isHandover = slip.mode === "handover";
    const byLabel = isHandover ? "Handed over by" : "Deposited by";
    return (
        <>
            {/* Title comes from the customizable banner (template.headerLine2) in
                A4Header — no hardcoded title here. On a bank deposit the voucher
                number is internal, so it sits ONLY on the depositor's counterfoil;
                the bank copy carries just the date. The handover slip has no
                counterfoil, so it keeps the voucher number on the face. */}
            <div className="mr-meta">
                {isHandover && (
                    <div>
                        <span className="muted">Voucher No.: </span>
                        <span className="bold">{sample.reference}</span>
                    </div>
                )}
                <div style={isHandover ? undefined : { marginLeft: "auto" }}>
                    <span className="muted">Date: </span>
                    <span className="bold">{sample.date}</span>
                </div>
            </div>

            <div className="ds-bank">
                {isHandover ? (
                    <>
                        {slip.fromLedger && <div className="brow"><span className="l">From Ledger</span><span className="bold">{slip.fromLedger}</span></div>}
                        {slip.toLedger && <div className="brow"><span className="l">To Ledger</span><span className="bold">{slip.toLedger}</span></div>}
                    </>
                ) : (
                    <>
                        {bankLine && <div className="brow"><span className="l">Bank</span><span className="bold">{bankLine}</span></div>}
                        {slip.accountName && <div className="brow"><span className="l">A/C Name</span><span>{slip.accountName}</span></div>}
                        {slip.accountNo && <div className="brow"><span className="l">A/C No</span><span>{slip.accountNo}</span></div>}
                        {slip.ifsc && <div className="brow"><span className="l">IFSC</span><span>{slip.ifsc}</span></div>}
                        {slip.pan && <div className="brow"><span className="l">Depositor&rsquo;s PAN</span><span>{slip.pan}</span></div>}
                        {slip.fromLedger && <div className="brow"><span className="l">From Ledger</span><span>{slip.fromLedger}</span></div>}
                    </>
                )}
            </div>

            <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
                <div className="col">
                    {counted ? (
                        <>
                            {counted.notes.length > 0 && (
                                <table className="ds-denoms">
                                    <thead>
                                        <tr><th>Note</th><th style={{ textAlign: "center" }}>&times; Count</th><th style={{ textAlign: "right" }}>Amount</th></tr>
                                    </thead>
                                    <tbody>
                                        {counted.notes.map((n) => (
                                            <tr key={n.denom}>
                                                <td>{n.denom.toLocaleString("en-IN")}</td>
                                                <td className="cnt" style={{ textAlign: "center" }}>{n.count}</td>
                                                <td className="amt">{fmtNum(n.denom * n.count)}</td>
                                            </tr>
                                        ))}
                                        <tr className="tot">
                                            <td>Cash Total</td>
                                            <td className="cnt" style={{ textAlign: "center" }}>{counted.notes.reduce((s, n) => s + n.count, 0)}</td>
                                            <td className="amt">{fmtNum(counted.notes.reduce((s, n) => s + n.denom * n.count, 0))}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}
                            {counted.cheques.length > 0 && (
                                <table className="ds-denoms" style={{ marginTop: counted.notes.length ? 8 : 0 }}>
                                    <thead>
                                        <tr><th>Cheque (drawer &middot; no.)</th><th style={{ textAlign: "right" }}>Amount</th></tr>
                                    </thead>
                                    <tbody>
                                        {counted.cheques.map((c, i) => (
                                            <tr key={i}>
                                                <td>{c.account ? `${c.account} · ${c.no}` : c.no}</td>
                                                <td className="amt">{fmtNum(c.amount)}</td>
                                            </tr>
                                        ))}
                                        {counted.cheques.length > 1 && (
                                            <tr className="tot">
                                                <td>Cheques Total</td>
                                                <td className="amt">{fmtNum(counted.cheques.reduce((s, c) => s + c.amount, 0))}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </>
                    ) : (
                        <table className="ds-denoms">
                            <thead>
                                <tr><th>Note</th><th style={{ textAlign: "center" }}>&times; Count</th><th style={{ textAlign: "right" }}>Amount</th></tr>
                            </thead>
                            <tbody>
                                {notes.map((d) => (
                                    <tr key={d}><td>{d.toLocaleString("en-IN")}</td><td className="cnt" /><td className="amt" /></tr>
                                ))}
                                {hasCoins && <tr><td>Coins / small</td><td className="cnt" /><td className="amt" /></tr>}
                                <tr className="tot"><td>Total</td><td className="cnt" /><td className="amt">{fmtNum(total)}</td></tr>
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="col">
                    <div className="ds-amt-box">
                        <div className="cap">{isHandover ? "Amount Handed Over" : "Amount Deposited"}</div>
                        <div className="val">{fmtINR(total)}</div>
                    </div>
                    <div style={{ marginTop: 10, lineHeight: 1.9 }}>
                        Rupees <span className="ds-fill" style={{ fontStyle: "italic" }}>{words.replace(/^Rupees /, "")}</span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                        {byLabel} <span className="ds-fill">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                    </div>
                    {/* Narration is internal — kept on the handover slip for
                        context, dropped from the bank copy (the bank doesn't need it). */}
                    {isHandover && sample.notes && (
                        <div className="small muted" style={{ marginTop: 8 }}>
                            Narration: {sample.notes}
                        </div>
                    )}
                </div>
            </div>

            {isHandover ? (
                /* Cash → cash is an internal handover: both parties sign, no
                   cut-off counterfoil, no bank acknowledgment. */
                <div className="ds-sigs">
                    <div className="ds-sig">Handed over by (Signature)</div>
                    <div className="ds-sig">Received by (Signature)</div>
                </div>
            ) : (
                <>
                    <div className="ds-sigs">
                        <div className="ds-sig">Depositor&rsquo;s Signature</div>
                        <div className="ds-sig">Bank Seal / Acknowledgment</div>
                    </div>

                    <div className="ds-cut">&#9986; CUT HERE</div>

                    {/* Counterfoil — the depositor's copy. The bank stamps + signs
                        the dashed box and returns it; the office staples it to the
                        voucher. */}
                    <div className="ds-foil">
                        <div className="ds-foil-h">
                            <span className="t">Depositor&rsquo;s Copy — Bank Acknowledgment</span>
                            <span className="muted">{sample.reference} &middot; {sample.date}</span>
                        </div>
                        {(bankLine || slip.accountNo) && (
                            <div className="brow">
                                <span className="l">Bank &middot; A/C</span>
                                <span>{[bankLine, slip.accountNo].filter(Boolean).join(" · ")}</span>
                            </div>
                        )}
                        <div className="brow">
                            <span className="l">Amount</span>
                            <span className="bold">{fmtINR(total)} ({words})</span>
                        </div>
                        <div className="brow">
                            <span className="l">Deposited by</span>
                            <span className="ds-fill">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                        </div>
                        <div className="ds-stamp-row">
                            <div className="ds-stamp-note">
                                Received the above amount for deposit. Valid with the bank&rsquo;s stamp and signature.
                            </div>
                            <div className="ds-stamp">Bank&rsquo;s Stamp<br />&amp; Signature</div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

// Journal-style GL vouchers (plain Contra, Journal) — a double-entry document,
// not a sale. They print a Particulars · Debit · Credit ledger table, never the
// goods qty/rate table.
const JOURNAL_KINDS = new Set(["CONTRA", "JOURNAL"]);

/** Bespoke middle for journal-style GL vouchers — ref/date + a
 *  Particulars · Debit · Credit table with a balancing total. */
function JournalMiddle({ sample }: A4ChromeProps) {
    const lines = sample.lines;
    // A line with no explicit side falls on the debit column.
    const totalDr = lines.filter((l) => l.entryType !== "CREDIT").reduce((s, l) => s + l.amount, 0);
    const totalCr = lines.filter((l) => l.entryType === "CREDIT").reduce((s, l) => s + l.amount, 0);
    const grand = sample.total ?? totalDr;
    return (
        <>
            <div className="mr-meta">
                <div>
                    <span className="muted">Voucher No.: </span>
                    <span className="bold">{sample.reference}</span>
                </div>
                <div>
                    <span className="muted">Date: </span>
                    <span className="bold">{sample.date}</span>
                </div>
            </div>

            <table className="lines">
                <thead>
                    <tr>
                        <th style={{ textAlign: "center" }}>#</th>
                        <th>Particulars</th>
                        <th style={{ textAlign: "right" }}>Debit</th>
                        <th style={{ textAlign: "right" }}>Credit</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((l, i) => {
                        const isCr = l.entryType === "CREDIT";
                        return (
                            <tr key={i}>
                                <td className="sn">{i + 1}</td>
                                <td>{isCr ? <span style={{ paddingLeft: 16 }}>{l.description}</span> : l.description}</td>
                                <td className="amt">{isCr ? "" : fmtINR(l.amount)}</td>
                                <td className="amt">{isCr ? fmtINR(l.amount) : ""}</td>
                            </tr>
                        );
                    })}
                    <tr>
                        <td className="sn" />
                        <td className="bold">Total</td>
                        <td className="amt bold" style={{ background: "#f4f4f4" }}>{fmtINR(totalDr)}</td>
                        <td className="amt bold" style={{ background: "#f4f4f4" }}>{fmtINR(totalCr)}</td>
                    </tr>
                </tbody>
            </table>

            {sample.notes && (
                <div className="terms"><span className="bold">Narration: </span>{sample.notes}</div>
            )}
            {sample.total !== null && (
                <div className="words">{rupeesInWords(grand)}</div>
            )}
        </>
    );
}

/**
 * Tally-style goods table for tax invoices (SALE / PURCHASE / returns / …).
 *
 * Differs from the POS ladder table on purpose:
 *   • No rule between item rows — the goods read as one block.
 *   • GST and bill-level charges are LEDGER ROWS inside the table, so the
 *     printed column of figures is one continuous sum ending at the Total.
 *   • A rule sits over the item subtotal only (Tally's "where goods stop").
 *
 * Columns appear only when some line supplies the data, so a bare qty/rate
 * voucher (challan, physical stock) degrades to #/Description/Qty/Rate/Amount.
 *
 * Amount basis: when the builder supplies `line.taxable`, the table prints
 * PRE-TAX values and adds the Output CGST/SGST rows below — the arithmetic then
 * closes against the HSN summary. Without it the line amounts are shown as
 * given and the tax rows are skipped (they would double-count).
 */
interface GoodsTableProps extends A4ChromeProps {
    /** Lines on THIS sheet. Omitted → the whole voucher (single-page bill). */
    pageLines?: ThermalReceiptSample["lines"];
    /** 0-based index of the first line on this sheet, so serial numbers keep
     *  running across a page break instead of restarting at 1. */
    startIndex?: number;
    /** Running item total arriving from the previous sheet — prints as the
     *  "Brought forward" opening row. */
    broughtForward?: number | null;
    /** Running item total leaving for the next sheet. When set, the sheet ends
     *  with "Carried forward" and the ledger + Total stay on the last page. */
    carriedForward?: number | null;
}

function GoodsTable({
    template, sample, pageLines, startIndex = 0, broughtForward = null, carriedForward = null,
}: GoodsTableProps) {
    const lines = pageLines ?? sample.lines;
    // Column visibility is decided by the WHOLE voucher, never by the page —
    // otherwise page 2 would drop a column page 1 shows and the two sheets
    // would not line up.
    const all = sample.lines;
    const anyHsn = all.some((l) => !!l.hsn);
    const anyUnit = all.some((l) => !!l.unit);
    const anyDisc = all.some((l) => (l.discount ?? 0) > 0.005);
    const anyMrp = template.showMrp && all.some((l) => (l.mrp ?? 0) > 0);
    // Pre-tax basis → the GST ledger rows are safe to add.
    const exclusive = all.some((l) => l.taxable != null);

    const value = (l: typeof lines[number]) => l.taxable ?? l.amount;
    const unitRate = (l: typeof lines[number]) => {
        if (l.rate != null) return l.rate;
        const gross = value(l) + (l.discount ?? 0);
        return l.quantity > 0 ? gross / l.quantity : gross;
    };

    // Totals always describe the WHOLE voucher, not the page.
    const itemTotal = all.reduce((s, l) => s + value(l), 0);
    const discTotal = all.reduce((s, l) => s + (l.discount ?? 0), 0);
    const qtyTotal = all.reduce((s, l) => s + l.quantity, 0);
    // Quantities only carry a unit when the whole bill shares one — mixing
    // "3 Nos" and "1 Ream" into a single figure would be a lie.
    const units = new Set(all.map((l) => l.unit).filter(Boolean));
    const qtyLabel = units.size === 1 ? `${qtyTotal} ${[...units][0]}` : String(qtyTotal);

    // Ledger rows under the goods: bill charges first (discount / freight /
    // service income), then the GST legs, exactly as Tally stacks them.
    const charges = sample.charges ?? [];
    const taxRows: { label: string; amount: number }[] = [];
    if (exclusive && template.showTaxSummary && sample.taxBreakdown) {
        const tb = sample.taxBreakdown;
        if (tb.kind === "INTRA") {
            if (tb.cgst > 0.005) taxRows.push({ label: "Output CGST", amount: tb.cgst });
            if (tb.sgst > 0.005) taxRows.push({ label: "Output SGST", amount: tb.sgst });
        } else if (tb.igst > 0.005) {
            taxRows.push({ label: "Output IGST", amount: tb.igst });
        }
    }
    // Round-off rounds the tax-INCLUSIVE figure, so it lands after the GST legs.
    const roundOff = sample.roundOff ?? 0;
    // A continuation sheet ends at "Carried forward" — the ledger and the Total
    // belong to the last page only.
    const isLastPage = carriedForward == null;
    const ledger = isLastPage ? [
        ...charges,
        ...taxRows,
        ...(Math.abs(roundOff) > 0.005 ? [{ label: "Round Off", amount: roundOff }] : []),
    ] : [];
    const hasTotal = isLastPage && sample.total !== null;

    // Colspan for a ledger row's right-aligned label: everything between the
    // serial column and the amount column.
    const midCols = 1 /* description */ + (anyHsn ? 1 : 0) + (anyMrp ? 1 : 0)
        + 1 /* qty */ + (anyUnit ? 1 : 0) + 1 /* rate */ + (anyDisc ? 1 : 0);

    const signed = (n: number) => (n < 0 ? `(-)${fmtINR(Math.abs(n)).replace("Rs. ", "")}` : fmtINR(n).replace("Rs. ", ""));

    return (
        <table className="goods">
            <thead>
                <tr>
                    <th className="ctr" style={{ width: 26 }}>#</th>
                    <th style={{ textAlign: "left" }}>Description of Goods</th>
                    {anyHsn && <th className="ctr" style={{ width: 60 }}>HSN/SAC</th>}
                    {anyMrp && <th className="num" style={{ width: 60 }}>MRP</th>}
                    <th className="num" style={{ width: 56 }}>Quantity</th>
                    {anyUnit && <th className="ctr" style={{ width: 40 }}>per</th>}
                    <th className="num" style={{ width: 74 }}>Rate</th>
                    {anyDisc && <th className="num" style={{ width: 60 }}>Disc.</th>}
                    <th className="num" style={{ width: 86 }}>Amount</th>
                </tr>
            </thead>
            <tbody>
                {/* Opening balance on a continuation sheet, so the reader can
                    follow the arithmetic across the page break. */}
                {broughtForward != null && (
                    <tr className="ledger">
                        <td />
                        <td colSpan={midCols} className="num">Brought forward</td>
                        <td className="num">{fmtINR(broughtForward).replace("Rs. ", "")}</td>
                    </tr>
                )}
                {lines.map((l, i) => (
                    <tr key={i}>
                        <td className="ctr">{startIndex + i + 1}</td>
                        <td>
                            <div className="item">{l.description}</div>
                            {l.note && <div className="note">{l.note}</div>}
                        </td>
                        {anyHsn && <td className="ctr">{l.hsn ?? ""}</td>}
                        {anyMrp && <td className="num">{l.mrp ? fmtINR(l.mrp).replace("Rs. ", "") : "—"}</td>}
                        <td className="num">{l.quantity}</td>
                        {anyUnit && <td className="ctr">{l.unit ?? ""}</td>}
                        <td className="num">{fmtINR(unitRate(l)).replace("Rs. ", "")}</td>
                        {anyDisc && <td className="num">{(l.discount ?? 0) > 0.005 ? fmtINR(l.discount!).replace("Rs. ", "") : "—"}</td>}
                        <td className="num">{fmtINR(value(l)).replace("Rs. ", "")}</td>
                    </tr>
                ))}

                {/* Item subtotal — figure only, under a full-width rule, when
                    ledger rows follow it. With nothing below, the Total row
                    says it all. */}
                {ledger.length > 0 && (
                    <tr className="subtotal">
                        <td />
                        <td colSpan={midCols} className="num" style={{ padding: "10px 6px 4px" }}>
                            Sub Total
                        </td>
                        <td className="num">{fmtINR(itemTotal).replace("Rs. ", "")}</td>
                    </tr>
                )}

                {ledger.map((r, i) => (
                    <tr key={`l${i}`} className="ledger">
                        <td />
                        <td colSpan={midCols} className="num">{r.label}</td>
                        <td className="num">{signed(r.amount)}</td>
                    </tr>
                ))}

                {/* Closing balance of a continuation sheet. */}
                {carriedForward != null && (
                    <tr className="grand">
                        <td />
                        <td colSpan={midCols} className="num">Carried forward</td>
                        <td className="num">{fmtINR(carriedForward).replace("Rs. ", "")}</td>
                    </tr>
                )}

                {hasTotal && (
                    <tr className="grand">
                        <td />
                        <td className="num">Total</td>
                        {anyHsn && <td />}
                        {anyMrp && <td />}
                        <td className="num">{qtyLabel}</td>
                        {anyUnit && <td />}
                        <td />
                        {anyDisc && <td className="num">{discTotal > 0.005 ? fmtINR(discTotal).replace("Rs. ", "") : ""}</td>}
                        <td className="num">{fmtINR(sample.total!)}</td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}

/** One sheet's worth of a paginated tax invoice. Absent → the whole voucher
 *  on a single sheet (the common case). */
interface PageSlice {
    lines: ThermalReceiptSample["lines"];
    startIndex: number;
    broughtForward: number | null;
    carriedForward: number | null;
    isFirst: boolean;
    isLast: boolean;
    /** Tax-analysis annexure sheet: letterhead + party + the rate-wise HSN
     *  table + tax in words + signatory, and nothing else. Tally splits a
     *  multi-page invoice exactly here — the goods and their totals finish on
     *  the invoice sheets, and the tax analysis becomes its own document. */
    annexure: boolean;
    /** Whether the rate-wise tax analysis renders on THIS sheet. True inline on
     *  a single-sheet bill, and on the annexure when the bill needs one. */
    taxAnalysis: boolean;
    /** Terms + bank block. Mandatory part of the voucher, so it rides the last
     *  voucher sheet; never the annexure. */
    showTerms: boolean;
    /** Signature block. On the voucher's closing sheet and on the annexure —
     *  each is a document someone must be able to act on. Omitted from mid-run
     *  continuation sheets, which are pure item table. */
    showSignature: boolean;
    /** Footer line ("Thank you, visit again"). Cheap filler, so it rides every
     *  sheet — a mid-run sheet ending in bare white space looks unfinished. */
    showFooterLine: boolean;
    /** Disclaimer ("computer-generated document"). Says something about the
     *  DOCUMENT, so it belongs only where a document ends: the voucher's
     *  closing sheet and the annexure. */
    showDisclaimer: boolean;
    /** Barcode — sacrificed at rung 2, and used as filler on mid-run sheets. */
    showBarcode: boolean;
    /** Scan-to-pay QR inside the bank block — sacrificed with the barcode. */
    showQr: boolean;
}

/** Default invoice middle — bill-to meta, line items, totals, HSN, amount-in-words. */
function DefaultA4Middle({ template, sample, page }: A4ChromeProps & { page?: PageSlice }) {
    // The Bill-To / voucher band repeats on every sheet so each one stands
    // alone (Tally does the same — its tax-analysis page restates the company
    // and the party).
    //
    // Goods sheets carry the items and, on the last of them, the totals ladder,
    // amount in words and the settlement. The tax analysis (rate-wise HSN table
    // + tax in words) moves to its own annexure sheet when there is one, which
    // is what keeps both sheets inside a single A4.
    const annexure = page?.annexure ?? false;
    const showGoods = !annexure;
    // The tail rides the LAST goods sheet — the one with nothing carried
    // forward. The tax analysis is placed by the paginator: inline on a
    // single-sheet bill, on the annexure when the bill needs one.
    const showTails = !annexure && page?.carriedForward == null;
    const showTax = page ? page.taxAnalysis : true;
    const grandTotal = sample.total ?? 0;
    const receipts = sample.receipts ?? [];
    const receivedTotal = receipts.reduce((s, r) => s + r.amount, 0);
    // Total GST across the bill — drives the tax-in-words line. Prefer the
    // ladder's complete total (goods + tax-bearing charges like shipping),
    // else the rate-wise table, else the invoice-level split, else the
    // single tax figure.
    const taxTotal = sample.discounts?.taxTotal
        ?? (sample.hsnSummary && sample.hsnSummary.length > 0
            ? sample.hsnSummary.reduce((s, h) => s + h.cgst + h.sgst, 0)
            : sample.taxBreakdown
                ? (sample.taxBreakdown.kind === "INTRA"
                    ? sample.taxBreakdown.cgst + sample.taxBreakdown.sgst
                    : sample.taxBreakdown.igst)
                : sample.taxAmount ?? 0);
    return (
        <>
            {/* 3 — Bill-To / Invoice-Details (on every sheet) */}
            {/* The band normally borrows the goods table's top border as its
                bottom rule. On the annexure there is no goods table under it,
                so it has to close itself. */}
            <div className={`meta-grid${showGoods ? "" : " meta-grid-closed"}`}>
                <div className="meta-card">
                    <div className="label">{isSupplierPartyKind(template.kind) ? "Supplier" : "Bill To"}</div>
                    <div className="bold">{sample.partyName ?? "Walk-in"}</div>
                    {sample.partyPhone && <div className="small muted">{sample.partyPhone}</div>}
                    {/* Buyer GSTIN + state are mandatory on a B2B tax invoice and
                        are what justify the CGST+SGST vs IGST split. Absent for a
                        walk-in, where both rows simply don't print. */}
                    {sample.partyGstin && <div className="small muted">GSTIN/UIN : {sample.partyGstin}</div>}
                    {sample.partyState && <div className="small muted">State Name : {sample.partyState}</div>}
                </div>
                <div className="meta-card">
                    <div className="label">Voucher Details</div>
                    <div className="row between" style={{ gap: 6 }}>
                        {/* This IS the invoice number (UniversalVoucher.voucherNo);
                            "Reference" was an internal name leaking onto a
                            customer document. Suppliers' vouchers call it what
                            it is on their side. */}
                        <span className="muted small">
                            {isSupplierPartyKind(template.kind) ? "Voucher No." : "Invoice No."}
                        </span>
                        <span className="bold">{sample.reference}</span>
                    </div>
                    <div className="row between" style={{ gap: 6 }}>
                        <span className="muted small">Date</span>
                        <span>{sample.date}</span>
                    </div>
                    {sample.paymentTerms && (
                        <div className="row between" style={{ gap: 6 }}>
                            <span className="muted small">Terms of payment</span>
                            <span>{sample.paymentTerms}</span>
                        </div>
                    )}
                    {sample.dueDate && (
                        <div className="row between" style={{ gap: 6 }}>
                            <span className="muted small">Due date</span>
                            <span>{sample.dueDate}</span>
                        </div>
                    )}
                    {sample.taxBreakdown?.placeOfSupplyName && (
                        <div className="row between" style={{ gap: 6 }}>
                            <span className="muted small">Place of supply</span>
                            <span>{sample.taxBreakdown.placeOfSupplyName}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 4 — Line items. The POS price-ladder keeps its own qty/MRP/rate
                 table; every other kind prints the Tally-style goods table
                 (HSN · per · discount columns, GST + bill charges as ledger rows
                 inside the table). The annexure sheet has no goods at all — it
                 is purely the tax analysis. */}
            {!showGoods ? (
                <div className="banner banner-plain" style={{ fontSize: 12, letterSpacing: 2, marginTop: 4 }}>
                    Tax Analysis
                </div>
            ) : sample.discounts ? (() => {
                const displayLines = page?.lines ?? sample.lines;
                const startSerial = page?.startIndex ?? 0;
                return (
                    <table className="lines">
                        <thead>
                            <tr>
                                <th style={{ textAlign: "center" }}>#</th>
                                <th>Description</th>
                                <th style={{ textAlign: "right" }}>Qty</th>
                                {template.showMrp && <th style={{ textAlign: "right" }}>MRP</th>}
                                <th style={{ textAlign: "right" }}>Rate</th>
                                <th style={{ textAlign: "right" }}>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayLines.map((l, i) => {
                                const rate = l.quantity > 0 ? l.amount / l.quantity : l.amount;
                                return (
                                    <tr key={i}>
                                        <td className="sn">{startSerial + i + 1}</td>
                                        <td>{l.description}</td>
                                        <td className="qty">{l.quantity}</td>
                                        {template.showMrp && (
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
                );
            })() : (
                <GoodsTable
                    template={template}
                    sample={sample}
                    pageLines={page?.lines}
                    startIndex={page?.startIndex ?? 0}
                    broughtForward={page?.broughtForward ?? null}
                    carriedForward={page?.carriedForward ?? null}
                />
            )}

            {/* 4b — Amount chargeable in words, sitting directly under the
                 figure it restates, with the errors-and-omissions note Tally
                 prints on the same line. */}
            {!sample.discounts && showTails && sample.total !== null && (
                <div className="eoe">
                    <div>
                        <div className="xs muted" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
                            Amount Chargeable (in words)
                        </div>
                        <div className="bold" style={{ fontStyle: "italic" }}>{rupeesInWords(grandTotal)}</div>
                    </div>
                    <div className="xs muted">E. &amp; O.E.</div>
                </div>
            )}

            {/* 5 — Totals box */}
            {sample.discounts ? (() => {
                /* ── Two savings, kept distinct ─────────────────────────────────
                   • Special Discount (vs the regular/barcode price) — real money
                     off; collapsed to one highlighted ladder row, itemised left.
                   • Saving from MRP (vs the sticker) — MRP total − Grand Total;
                     informational, in its own green box. It already contains the
                     special discount, so it is NOT a ladder row. ─────────────── */
                const d = sample.discounts;
                const grandTotal = sample.total ?? (d.grossAtTag - d.total);
                const mrpValue = grandTotal + d.savingsTotal;
                return (
                    <div className="totals">
                        {(d.rows.length > 0 || d.savingsTotal > 0.005) && (
                            <div className="disc-detail">
                                {d.rows.length > 0 && (
                                    <>
                                        <div className="disc-detail-h">Today&rsquo;s Discount</div>
                                        {d.rows.map((r, i) => (
                                            <div key={i} className="disc-detail-row">
                                                <span>{r.label}</span>
                                                <span>&minus; {fmtINR(r.amount)}</span>
                                            </div>
                                        ))}
                                    </>
                                )}
                                {d.savingsTotal > 0.005 && (
                                    <div className="mrp-save">
                                        <div className="mrp-save-top">
                                            <span>Saving from MRP</span>
                                            <span>{fmtINR(d.savingsTotal)}</span>
                                        </div>
                                        <div className="mrp-save-note">
                                            MRP {fmtINR(mrpValue)} &minus; you pay {fmtINR(grandTotal)} ({d.savingsPct}% off MRP)
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="totals-box">
                            <div className="trow">
                                <span className="muted">Gross</span>
                                <span>{fmtINR(d.grossAtTag)}</span>
                            </div>
                            {d.total > 0.005 && (
                                <div className="trow special">
                                    <span>Special Discount</span>
                                    <span>&minus; {fmtINR(d.total)}</span>
                                </div>
                            )}
                            {(d.charges ?? []).map((c, i) => (
                                <div key={`c${i}`} className="trow">
                                    <span className="muted">{c.label}</span>
                                    <span>{c.amount < 0 ? "−" : "+"} {fmtINR(Math.abs(c.amount))}</span>
                                </div>
                            ))}
                            <div className="trow grand">
                                <span>Grand Total</span>
                                <span>{fmtINR(grandTotal)}</span>
                            </div>
                            {/* GST is included in the inclusive amounts above — note, not a row.
                            The HSN/SAC table below gives the full rate-wise breakup. */}
                            {template.showTaxSummary && sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
                                const inter = sample.taxBreakdown?.kind === "INTER";
                                const tax = sample.discounts?.taxTotal
                                    ?? sample.hsnSummary.reduce((s, h) => s + h.cgst + h.sgst, 0);
                                return tax > 0.005 ? (
                                    <div className="trow"><span className="muted">incl. {inter ? "GST (IGST)" : "GST (CGST+SGST)"}</span><span>{fmtINR(tax)}</span></div>
                                ) : null;
                            })()}
                        </div>
                    </div>
                );
            })() : null /* the goods table carries its own totals + ledger rows */}

            {/* 5b — HSN/SAC-wise tax summary (separate table, toggleable) */}
            {showTax && template.showTaxSummary && sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
                const inter = sample.taxBreakdown?.kind === "INTER";
                const num = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const sum = sample.hsnSummary.reduce(
                    (a, h) => ({ taxable: a.taxable + h.taxable, cgst: a.cgst + h.cgst, sgst: a.sgst + h.sgst }),
                    { taxable: 0, cgst: 0, sgst: 0 },
                );
                const hsnTax = sum.cgst + sum.sgst;
                const totalTaxFromSource = sample.discounts?.taxTotal
                    ?? (sample.taxBreakdown
                        ? (sample.taxBreakdown.kind === "INTRA"
                            ? sample.taxBreakdown.cgst + sample.taxBreakdown.sgst
                            : sample.taxBreakdown.igst)
                        : sample.taxAmount ?? 0);
                const chargeTax = Math.max(0, totalTaxFromSource - hsnTax);
                const chargeAmount = (sample.charges ?? [])
                    .filter((c) => (c.taxAmount ?? 0) > 0.005)
                    .reduce((s, c) => s + c.amount, 0);
                const chargeTaxable = chargeAmount > 0.005 ? Math.max(0, chargeAmount - chargeTax) : 0;
                const chargeRatePct = (sample.charges ?? []).find((c) => (c.taxAmount ?? 0) > 0.005)?.taxRate ?? 0;
                const totalTaxable = sum.taxable + (chargeTax > 0.005 && chargeAmount > 0.005 ? chargeTaxable : 0);
                const totalCgst = inter ? 0 : sum.cgst + chargeTax / 2;
                const totalSgst = inter ? 0 : sum.sgst + chargeTax / 2;
                const totalTax = hsnTax + chargeTax;
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
                            {chargeTax > 0.005 && chargeAmount > 0.005 && (
                                <tr>
                                    <td className="l">—</td>
                                    <td className="num">{num(chargeTaxable)}</td>
                                    {inter ? (
                                        <><td>{chargeRatePct}%</td><td className="num">{num(chargeTax)}</td></>
                                    ) : (
                                        <>
                                            <td>{chargeRatePct / 2}%</td><td className="num">{num(chargeTax / 2)}</td>
                                            <td>{chargeRatePct / 2}%</td><td className="num">{num(chargeTax / 2)}</td>
                                        </>
                                    )}
                                    <td className="num">{num(chargeTax)}</td>
                                </tr>
                            )}
                            <tr className="tot">
                                <td>Total</td>
                                <td className="num">{num(totalTaxable)}</td>
                                {inter ? (
                                    <><td /><td className="num">{num(totalTax)}</td></>
                                ) : (
                                    <><td /><td className="num">{num(totalCgst)}</td><td /><td className="num">{num(totalSgst)}</td></>
                                )}
                                <td className="num">{num(totalTax)}</td>
                            </tr>
                        </tbody>
                    </table>
                );
            })()}

            {/* 6 — Amount in words. The tax invoice prints its own, directly
                 under the goods table (with E. & O.E.), so the figure sits next
                 to the total it belongs to; only the ladder needs one here. */}
            {sample.discounts && sample.total !== null && (
                <div className="words">{rupeesInWords(grandTotal)}</div>
            )}

            {/* 6b — Tax amount in words. GST law wants the tax stated in words
                 as well as figures, so it follows the rate-wise table. */}
            {!sample.discounts && showTax && template.showTaxSummary && taxTotal > 0.005 && (
                <div className="words">
                    <span className="muted">Tax Amount (in words): </span>
                    {rupeesInWords(taxTotal)}
                </div>
            )}

            {/* 6c — Settlement. Only prints when money has actually been
                 received against the voucher; a fully-paid bill shows no
                 balance row rather than a "Balance Rs. 0.00" line. */}
            {!sample.discounts && showTails && (receipts.length > 0 || (sample.balanceDue ?? 0) > 0.005) && (
                <div className="settle">
                    {/* Left — what was actually tendered. A pure credit sale has
                        nothing here, which is why the block can't be gated on it. */}
                    {receipts.length > 0 && (
                        <div style={{ minWidth: 240 }}>
                            <div className="label" style={{ fontSize: 9, color: "#666", textTransform: "uppercase", letterSpacing: 0.6 }}>Received in</div>
                            {receipts.map((r, i) => (
                                <div key={i} className="settle-row">
                                    <span className="muted">{r.label}</span>
                                    <span>{fmtINR(r.amount)}</span>
                                </div>
                            ))}
                            {receipts.length > 1 && (
                                <div className="settle-row bold" style={{ borderTop: "1px solid #d0d0d0", marginTop: 2, paddingTop: 2 }}>
                                    <span>Total received</span>
                                    <span>{fmtINR(receivedTotal)}</span>
                                </div>
                            )}
                        </div>
                    )}
                    {/* Right — what is still owed on THIS bill, and (opt-in) where
                        that leaves the party's running account. */}
                    <div className="settle-right">
                        {(sample.balanceDue ?? 0) > 0.005 && (
                            <div className="settle-row bold">
                                <span>Balance due{sample.partyName ? ` — ${sample.partyName}` : ""}</span>
                                <span>{fmtINR(sample.balanceDue!)}</span>
                            </div>
                        )}
                        {template.showPartyBalance && sample.balanceBefore && (
                            <div className="settle-row">
                                <span className="muted">Previous balance</span>
                                <span>{sample.balanceBefore}</span>
                            </div>
                        )}
                        {template.showPartyBalance && sample.balanceAfter && (
                            <div className="settle-row bold" style={{ borderTop: "1px solid #d0d0d0", marginTop: 2, paddingTop: 2 }}>
                                <span>Closing balance</span>
                                <span>{sample.balanceAfter}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

/** Template-driven footer chrome (notes · terms · signature · footer line · barcode). */
function A4Footer({ template }: A4ChromeProps) {
    return (
        <div className="footer-block">
            {/* 7 — Terms + signature + footer.
                 No narration here by design: the voucher narration is internal
                 bookkeeping text and never goes on a customer document (Tally
                 behaves the same way). The per-line item note is a different
                 field and DOES print, under its item in the goods table. The
                 money-receipt / journal / handover middles keep their own
                 narration lines — there the narration is the document's
                 content, not an incidental note. */}
            {template.termsText && (
                <div className="terms"><span className="bold">Terms &amp; Conditions:</span>{"\n"}{template.termsText}</div>
            )}

            {/* The bank block lives in <A4SignOff>, beside the signature, so
                the two sit on one row with their bottoms aligned. */}
        </div>
    );
}

/** Bank heading + scan-to-pay QR beside the labelled account lines. */
function BankBlock({ template }: { template: VoucherTemplateDefaults }) {
    return (
        <div>
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
    );
}

/**
 * Sign-off strip — signature, footer line, disclaimer, barcode.
 *
 * Repeated on EVERY sheet, not just the last. Tally prints an Authorised
 * Signatory on each page of a multi-page invoice (the tax-analysis annexure
 * carries its own), because a loose sheet with no signature and no brand is not
 * a document anyone can act on. Kept separate from <A4Footer> for exactly that
 * reason: the terms + bank block is bulky boilerplate that belongs once, at the
 * end, while this strip belongs on all of them.
 */
function A4SignOff({ template, sample, showBank }: A4ChromeProps & { showBank?: boolean }) {
    const bank = !!showBank && template.showBank
        && !!(template.bankDetails || template.bankUpiQr);
    return (
        <div className="signoff">
            {/* Bank block and signature share ONE row with their bottoms
                aligned — the account details and the authorising signature are
                the two things a reader looks for at the foot of a bill, so they
                should sit on a common baseline rather than stacked. The QR
                travels with the account lines: a bare scan code says nothing
                about who is being paid. */}
            {(bank || template.showSignature) && (
                <div className="signoff-row">
                    <div className="signoff-bank">{bank && <BankBlock template={template} />}</div>
                    {template.showSignature && (
                        <div className="sig-block">{template.signatureLabel}</div>
                    )}
                </div>
            )}

            {template.footerLine && (
                <div className="footer-line">{template.footerLine}</div>
            )}
            {template.disclaimerLine && (
                <div className="disclaimer">{template.disclaimerLine}</div>
            )}

            {/* Scannable voucher number — for pulling up the sale at return time.
                 Centred under the footer, sized well below full width so it
                 reads as a reference mark rather than a headline element. */}
            {template.showBarcode && sample.reference && (
                <div className="barcode-corner">
                    <BarcodeSvg value={sample.reference} height={40} fontSize={13} margin={4} className="barcode" />
                </div>
            )}
        </div>
    );
}

/**
 * Split the goods lines across A4 sheets.
 *
 * Heights are ESTIMATED, not measured — the print document is rendered on the
 * server (and by the thermal bridge), where there is no layout engine to ask.
 * The unit is a "slot" ≈ one 6mm table row; a line with a note costs two. The
 * estimates are deliberately conservative, so a sheet ends slightly early
 * rather than spilling a row onto the next page.
 *
 * Returns a single full-voucher page when everything fits, which is the common
 * case and keeps short bills byte-identical to the un-paginated layout.
 */
// All measured off a real rendered invoice, not guessed. Earlier estimates were
// wrong in BOTH directions (chrome and totals over, terms+bank badly under) and
// happened to cancel, which is how a 2-item bill missed fitting by 1mm while
// leaving 41mm of the sheet empty.
// 297mm sheet − 2 × 16mm padding = 265mm, minus 7mm of safety. Every figure
// below is an ESTIMATE (the print document renders server-side, where there is
// no layout engine to measure against), so the estimates must lean pessimistic:
// a sheet that ends slightly early costs nothing, while one that ends slightly
// late spills its sign-off onto a page of its own.
const SHEET_USABLE_MM = 258;
// Every sheet carries the same chrome (letterhead + title + Bill-To band),
// measured at 47mm after tightening; 1mm of slack keeps rounding safe.
const PAGE_CHROME_MM = 48;
const TABLE_HEAD_MM = 7;   // measured 6.9
const PAGE_FOOT_MM = 5;   // measured 4.9
const ROW_MM = 6.7; // measured 6.6 per item row
const NOTE_MM = 4;   // extra height when a line carries a remark
// Fewer goods lines than this on a sheet reads as an overflow accident rather
// than a deliberate second page, so the balancer refuses such a split.
const MIN_LINES_PER_SHEET = 3;

function paginateGoods(sample: ThermalReceiptSample, template: VoucherTemplateDefaults): PageSlice[] {
    const lines = sample.lines;
    const rowMm = (l: ThermalReceiptSample["lines"][number]) => ROW_MM + (l.note ? NOTE_MM : 0);
    const sumMm = (ls: typeof lines) => ls.reduce((s, l) => s + rowMm(l), 0);

    // Everything that must sit under the last line: ledger rows, Total, words,
    // HSN summary, tax words, settlement, then terms + bank + signature.
    const ledgerRows = (sample.charges?.length ?? 0)
        + (sample.taxBreakdown ? (sample.taxBreakdown.kind === "INTRA" ? 2 : 1) : 0)
        + (Math.abs(sample.roundOff ?? 0) > 0.005 ? 1 : 0);
    const hsnRows = template.showTaxSummary ? (sample.hsnSummary?.length ?? 0) : 0;
    // What has to stay with the LAST goods line: the ledger rows, Total, amount
    // in words and the settlement. Splitting a total away from the items it
    // totals is what's genuinely unreadable. Calibrated against measured render
    // heights, not guessed — on a real invoice ledger+Total came to ≈45mm,
    // words 8mm, settlement 21.2mm.
    const tailMm = 7 /* subtotal gap */ + ledgerRows * 5.3 + 7 /* Total */ + 8 /* words + E&OE */
        + (sample.receipts?.length ? 21 : 0);
    // The tax analysis (rate-wise HSN table + tax in words) is separable: it
    // describes the bill, not the last line, so it can become its own annexure
    // sheet. Measured at 26.5mm for a single HSN row plus 4.4mm of words.
    const taxAnalysisMm = hsnRows ? hsnRows * 8 + 18 + 5 : 0;
    // Terms + the bank / QR block print ONCE, on the final sheet, so only that
    // sheet reserves their height. Not reserving it at all (an earlier attempt)
    // made the last sheet overflow the paper, which is how a stray third page
    // carrying nothing but boilerplate appears.
    // Measured on the compressed layout: terms + bank text + QR = 51.1mm, of
    // which the QR contributes only ~6mm — it sits BESIDE the account lines, so
    // it costs just the amount it sticks out past them, not its full height.
    const footerMm = (template.termsText ? 20 : 0);
    // Every sheet spends the same height on chrome AND on its own sign-off,
    // since the signature / footer / barcode now repeat per sheet. Measured off
    // the template's own flags rather than a flat guess: a template with no
    // signature and no barcode really does get more room for goods.
    // The bank block and the signature now share one row, so the row costs the
    // TALLER of the two, not their sum — stacking them was over-reserving ~12mm
    // on every closing sheet.
    const footerLineMm = template.footerLine ? 5 : 0;
    const bankBlockMm = template.showBank && (template.bankDetails || template.bankUpiQr) ? 25 : 0;
    const sigLabelMm = template.showSignature ? 12 : 0;
    const signRowMm = Math.max(bankBlockMm, sigLabelMm);
    const sigMm = signRowMm + footerLineMm + (template.disclaimerLine ? 4 : 0);
    // Mid-run sheets carry only the barcode as filler.
    const fillerMm = template.showBarcode ? 14 : 0;
    const barcodeMm = template.showBarcode ? 14 : 0;
    // Only the amount the QR sticks out past the account lines it sits beside.
    const qrMm = template.showBank && template.bankUpiQr ? 6 : 0;
    // Terms + bank TEXT, priced without the QR so the ladder can drop the QR
    // on its own.
    const termsMm = Math.max(0, footerMm - qrMm);

    // ── Overflow ladder ─────────────────────────────────────────────────────
    // Page count is what we protect; decorative chrome is the currency we spend
    // to protect it. Rungs are tried in order; the first that fits wins.
    //
    //   0  one sheet, everything on it
    //   1  voucher sheet + tax-analysis annexure, both fully dressed
    //   2  break the item table across voucher sheets; annexure unchanged.
    //      Terms, signatory, bank/QR and barcode all live on the LAST voucher
    //      sheet. Mid-run sheets carry letterhead + Bill-To + items + barcode.
    //
    // NOTE: an earlier rung that bought space by stripping the barcode and QR
    // off the voucher is GONE. A closing sheet without bank details or a
    // scannable number is a worse document than a longer one, so those are no
    // longer currency the ladder may spend — only page count is.
    const contentMm = SHEET_USABLE_MM - PAGE_CHROME_MM - TABLE_HEAD_MM;
    const goodsMm = sumMm(lines);

    // Rung 0 — everything together on one sheet.
    if (goodsMm + tailMm + taxAnalysisMm + termsMm + qrMm + sigMm + barcodeMm <= contentMm) {
        return [{
            lines, startIndex: 0, broughtForward: null, carriedForward: null,
            isFirst: true, isLast: true, annexure: false, taxAnalysis: true,
            showTerms: true, showSignature: true, showFooterLine: true,
            showDisclaimer: true, showBarcode: true, showQr: true,
        }];
    }

    /** The tax-analysis annexure — identical on every rung that has one. */
    const annexureSheet = (startIndex: number): PageSlice => ({
        lines: [], startIndex, broughtForward: null, carriedForward: null,
        isFirst: false, isLast: true, annexure: true, taxAnalysis: true,
        showTerms: false, showSignature: true, showFooterLine: true,
        showDisclaimer: true, showBarcode: true, showQr: true,
    });

    // From here on every sheet also spends height on the "Page n of m" strip.
    const sheetCap = contentMm - PAGE_FOOT_MM;

    // Rung 1 — voucher + annexure, voucher fully dressed.
    if (goodsMm + tailMm + termsMm + qrMm + sigMm + barcodeMm <= sheetCap) {
        return [{
            lines, startIndex: 0, broughtForward: null, carriedForward: null,
            isFirst: true, isLast: false, annexure: false, taxAnalysis: false,
            showTerms: true, showSignature: true, showFooterLine: true,
            showDisclaimer: true, showBarcode: true, showQr: true,
        }, annexureSheet(lines.length)];
    }

    // Rung 2 — break the item table. Mid-run sheets carry items plus the
    // barcode (the one piece of filler that identifies a loose page) and get
    // the rest of the sheet for goods; the closing voucher sheet carries the
    // tail plus the full dress.

    // ── How many sheets, then BALANCE across them ───────────────────────────
    // Greedy fill (pack sheet 1, spill the rest) is what produces a second
    // sheet carrying two stray lines and every total — it reads as an overflow
    // accident. So: find the smallest sheet count that fits, then spread the
    // lines evenly, so each sheet carries a comparable, deliberate-looking
    // share and the totals land under a real block of goods.
    // Only the CLOSING voucher sheet reserves the tail and the full dress; the
    // mid-run sheets are pure item table.
    const closingReserve = tailMm + termsMm + qrMm + sigMm + barcodeMm;
    const capacityFor = (isLast: boolean) => sheetCap - (isLast ? closingReserve : 0);

    /** Can `count` sheets hold every line, split as evenly as possible? */
    const splitInto = (count: number): typeof lines[] | null => {
        const out: typeof lines[] = Array.from({ length: count }, () => []);
        const caps = Array.from({ length: count }, (_, i) => capacityFor(i === count - 1));
        const total = sumMm(lines);
        const capSum = caps.reduce((a, b) => a + b, 0);
        if (total > capSum) return null;
        // Balance by FULLNESS, not by raw height: the last sheet also carries
        // the totals, so an equal-height split over-fills it and would force
        // more sheets than the bill needs. Giving each sheet a share of the
        // lines proportional to its own capacity leaves every sheet looking
        // equally full, which is what makes both pages read as deliberate.
        const targets = caps.map((c) => total * c / capSum);
        // Height still to place from sheet i onwards — used to make sure we
        // never advance past a sheet while the remainder can't fit behind it.
        const capsAfter = caps.map((_, i) => caps.slice(i + 1).reduce((a, b) => a + b, 0));

        let page = 0;
        let used = 0;
        let left = total;
        for (let i = 0; i < lines.length; i++) {
            const h = rowMm(lines[i]);
            const hadShare = used + h > targets[page];
            const wontFit = used + h > caps[page];
            // Advance when this sheet has had its share or physically can't take
            // more — but only while what's left still fits on the sheets behind
            // it, and never leaving a later sheet with nothing to show.
            if (out[page].length > 0 && (wontFit || hadShare)
                && page < count - 1 && left <= capsAfter[page]) {
                page++;
                used = 0;
            }
            if (used + h > caps[page]) return null;
            out[page].push(lines[i]);
            used += h;
            left -= h;
        }
        // Every sheet must carry a meaningful block of goods, never a stray
        // line or two — that is the whole point of balancing. Enforced
        // unconditionally: an earlier version skipped this check once
        // `count * MIN` exceeded the line count, which let the search "succeed"
        // at a high sheet count with 1–2 lines per sheet — precisely the
        // outcome it was meant to prevent.
        if (out.some((p) => p.length < MIN_LINES_PER_SHEET)) return null;
        return out;
    };

    // Search ascending for the fewest sheets that split cleanly, and no further
    // than the point where every sheet could still hold the minimum.
    let split: typeof lines[] | null = null;
    const maxCount = Math.max(2, Math.floor(lines.length / MIN_LINES_PER_SHEET));
    for (let count = 2; count <= maxCount && !split; count++) {
        split = splitInto(count);
    }
    const goodsPages: { lines: typeof lines; startIndex: number }[] = [];
    if (split) {
        let idx = 0;
        for (const p of split) {
            goodsPages.push({ lines: p, startIndex: idx });
            idx += p.length;
        }
    } else {
        // Nothing balanced cleanly — the tail plus the closing dress is too tall
        // to leave a meaningful number of goods on the final sheet. Pack from
        // the END so the closing sheet's reduced capacity is respected first,
        // then fill whole sheets backwards with the remaining items. Packing
        // forwards at full capacity (an earlier version) silently overflowed the
        // closing sheet, since it never subtracted the closing dress.
        const capClosing = Math.max(0, sheetCap - closingReserve);
        const capMid = Math.max(0, sheetCap - fillerMm);
        // If the closing dress leaves room for only a stray line or two, the
        // closing sheet takes NO goods at all. A sheet holding the totals, terms
        // and signatory is a deliberate closing page; the same sheet holding two
        // orphan items reads as an overflow accident.
        const closingHoldsGoods = capClosing >= MIN_LINES_PER_SHEET * ROW_MM;
        const chunks: typeof lines[] = [];
        // A closing sheet with no goods on it is a legitimate closing page —
        // totals + terms + signatory — exactly what Tally prints when the dress
        // fills the sheet. Seed it here so the item sheets unshift in front.
        if (!closingHoldsGoods) chunks.push([]);
        let current: typeof lines = [];
        let used = 0;
        let cap = closingHoldsGoods ? capClosing : capMid;
        for (let i = lines.length - 1; i >= 0; i--) {
            const h = rowMm(lines[i]);
            if (current.length > 0 && used + h > cap) {
                chunks.unshift(current);
                current = [];
                used = 0;
                cap = capMid; // every earlier sheet is pure item table + filler
            }
            current.unshift(lines[i]);
            used += h;
        }
        if (current.length) chunks.unshift(current);
        let idx = 0;
        for (const c of chunks) {
            goodsPages.push({ lines: c, startIndex: idx });
            idx += c.length;
        }
    }

    const lastGoodsIndex = goodsPages.length - 1;
    let running = 0;
    const voucherSheets: PageSlice[] = goodsPages.map((p, i) => {
        const before = running;
        running += p.lines.reduce((s, l) => s + (l.taxable ?? l.amount), 0);
        const isClosing = i === lastGoodsIndex;
        return {
            lines: p.lines,
            startIndex: p.startIndex,
            broughtForward: i === 0 ? null : before,
            carriedForward: isClosing ? null : running,
            isFirst: i === 0,
            isLast: false,
            annexure: false,
            taxAnalysis: false,
            // The closing dress lands on the last voucher sheet. A mid-run
            // sheet gets the barcode ONLY: it identifies a page that got
            // separated, whereas the footer greeting and the
            // computer-generated disclaimer describe the document as a whole
            // and belong where the document actually ends.
            showTerms: isClosing,
            showSignature: isClosing,
            showDisclaimer: isClosing,
            showFooterLine: isClosing,
            showBarcode: true,
            showQr: isClosing,
        };
    });

    if (taxAnalysisMm === 0) {
        // No rate-wise summary to annex — the last voucher sheet is the last sheet.
        voucherSheets[voucherSheets.length - 1].isLast = true;
        voucherSheets[voucherSheets.length - 1].taxAnalysis = true;
        return voucherSheets;
    }
    return [...voucherSheets, annexureSheet(lines.length)];
}

/** Assembles letterhead + (custom or default) middle + footer chrome, so a
 *  bespoke document (repair ticket / shipping slip / payment slip) reuses the
 *  template-driven letterhead + footer and only supplies its own `body`. */
function InvoiceBody({ template, sample, body }: InvoiceBodyProps) {
    const bespoke = body
        ?? (DEPOSIT_SLIP_KINDS.has(template.kind) && sample.depositSlip
            ? <DepositSlipMiddle template={template} sample={sample} />
            : MONEY_RECEIPT_KINDS.has(template.kind)
                ? <MoneyReceiptMiddle template={template} sample={sample} />
                : JOURNAL_KINDS.has(template.kind)
                    ? <JournalMiddle template={template} sample={sample} />
                    : null);

    if (bespoke) {
        return (
            <div className="a4-sheet">
                <A4Header template={template} sample={sample} />
                {bespoke}
                <A4Footer template={template} sample={sample} />
                <A4SignOff template={template} sample={sample} showBank />
            </div>
        );
    }

    // Goods vouchers paginate. Every sheet is SELF-CONTAINED, the way Tally
    // prints one: full letterhead with the company details and GSTIN, the
    // Bill-To / voucher band, and its own sign-off with the Authorised Signatory
    // and barcode. A sheet that gets separated from the bundle is still a
    // document you can identify and act on. Only the bulky boilerplate — terms
    // and the bank / QR block — is printed once, on the final sheet.
    const pages = paginateGoods(sample, template);
    return (
        <>
            {pages.map((page, i) => (
                <div className="a4-sheet" key={i}>
                    <A4Header template={template} sample={sample} />
                    <DefaultA4Middle template={template} sample={sample} page={page} />
                    {/* Terms + bank/QR close the VOUCHER, so they sit on its
                        last sheet — the tax-analysis annexure is its own
                        document and carries only its table and signatory.
                        The per-sheet template overrides let the overflow ladder
                        drop the barcode and the scan-to-pay QR without touching
                        the saved template. */}
                    {page.showTerms && <A4Footer template={template} sample={sample} />}
                    <A4SignOff
                        template={{
                            ...template,
                            showSignature: template.showSignature && page.showSignature,
                            footerLine: page.showFooterLine ? template.footerLine : "",
                            disclaimerLine: page.showDisclaimer ? template.disclaimerLine : "",
                            showBarcode: template.showBarcode && page.showBarcode,
                            // Rung 2 gives up the QR; the account text stays.
                            bankUpiQr: page.showQr ? template.bankUpiQr : "",
                        }}
                        sample={sample}
                        // Bank details ride the same sheets the signature does —
                        // the voucher's closing sheet and the annexure.
                        showBank={page.showSignature}
                    />
                    {pages.length > 1 && (
                        <div className="pagefoot">
                            Page {i + 1} of {pages.length}
                            {!page.isLast && " · continued overleaf"}
                        </div>
                    )}
                </div>
            ))}
        </>
    );
}

export interface A4InvoicePreviewProps {
    template: VoucherTemplateDefaults;
    sample: ThermalReceiptSample;
    /** True → returns just the sheet (for in-page preview). False → full HTML document. */
    previewMode?: boolean;
    /** previewMode: grow to natural height (host owns the scroll) instead of
     *  scrolling inside its own maxHeight box. Prevents a nested double scroll. */
    previewFill?: boolean;
    /** Inserted before the sheet inside <body>. Used by the print route for the Print/Close toolbar. */
    toolbar?: React.ReactNode;
    /** document.title when not in previewMode (applied via SetDocumentTitle). */
    docTitle?: string;
    /** Custom middle for bespoke documents (repair ticket / shipping slip /
     *  payment slip). Replaces the invoice meta/lines/totals block; the
     *  template-driven letterhead + footer chrome stay shared. */
    body?: React.ReactNode;
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

    // Full-document mode still renders into the app's normal <html>/<body> (set
    // by the root layout) — it does NOT mount its own. A second <html>/<body>
    // nested inside the first used to work by accident (browsers merge
    // duplicate <body> tags while parsing) but made React throw a "mounting a
    // new body" console error. `docTitle` is applied to document.title via
    // SetDocumentTitle instead of a hand-rolled <title> tag.
    return (
        <>
            <SetDocumentTitle title={docTitle ?? sample.reference} />
            <style>{inlineA4Styles("")}</style>
            {toolbar}
            <InvoiceBody template={template} sample={sample} body={body} />
        </>
    );
}
