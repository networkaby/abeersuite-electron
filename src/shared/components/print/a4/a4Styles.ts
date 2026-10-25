// ── A4 stylesheet ───────────────────────────────────────────────────────────
// The one stylesheet every A4 document prints with. Emitted inline by
// <A4InvoicePreview> (A4InvoicePreview.tsx) — scoped in preview mode, global
// in a standalone print document.

// Class used to scope the inline <style> block when rendered inline in the
// host page (previewMode=true). MUST stay in sync with the wrapper div in
// A4InvoicePreview.tsx.
export const A4_PREVIEW_SCOPE_CLASS = "vt-a4-preview-root";

/**
 * Emits the A4 stylesheet. In standalone HTML mode `scope === ""` so the
 * rules target `body`/global selectors as a normal print document would.
 * In previewMode `scope === ".vt-a4-preview-root"` so every selector is
 * prefixed and the styles can't leak into the host settings page (which
 * would otherwise lose its global font, padding, and any utility classes
 * that share names like .row / .center / .bold).
 */
export function inlineA4Styles(scope: string): string {
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
        ${s}table.goods .note, ${s}table.lines .note {
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
