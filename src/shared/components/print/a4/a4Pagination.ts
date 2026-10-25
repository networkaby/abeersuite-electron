// ── A4 pagination ───────────────────────────────────────────────────────────
// How a tax invoice's goods lines are split across A4 sheets, and which
// blocks ride which sheet. Read by <A4InvoicePreview> (A4InvoicePreview.tsx).

import type { VoucherTemplateDefaults } from "@/shared/lib/print/voucherTemplateDefaults";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";

/** One sheet's worth of a paginated tax invoice. Absent → the whole voucher
 *  on a single sheet (the common case). */
export interface PageSlice {
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
    /** Blank space (mm) left on the sheet after everything else is laid out —
     *  rendered as a single filler row inside the goods table so a short
     *  voucher's ruled frame reaches down near the totals instead of ending
     *  early and leaving a bare gap before the sign-off. 0 on every
     *  multi-sheet rung; only the single self-contained sheet ever has slack
     *  worth filling. */
    fillerRowMm: number;
}

/** Does the settlement block (Received in · Balance due · party balance) print?
 *  Only once money has been received or is still owed — a fully-paid bill
 *  shows no "Balance ₹ 0.00" row. The discount-ladder receipts skip it,
 *  except POS: a counter bill on credit has to say what is still owed, same
 *  as a Sale. The Online Invoice ladder keeps it off (owner's call, 2026-09-28). */
export function printsSettlement(sample: ThermalReceiptSample, template: VoucherTemplateDefaults): boolean {
    if (sample.discounts && template.kind !== "POS") return false;
    return (sample.receipts?.length ?? 0) > 0 || (sample.balanceDue ?? 0) > 0.005;
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
// Slack below this reads as normal breathing room under the last item, not a
// hole in the page, so no filler row is worth drawing for it.
const FILLER_MIN_MM = 10;
// Cap how much of a near-empty voucher's sheet the filler claims — beyond
// this a two-line credit note would stretch the goods table across most of
// the page, which looks as manufactured as the gap it's meant to fix.
const FILLER_MAX_MM = 150;
// Fewer goods lines than this on a sheet reads as an overflow accident rather
// than a deliberate second page, so the balancer refuses such a split.
const MIN_LINES_PER_SHEET = 3;

export function paginateGoods(sample: ThermalReceiptSample, template: VoucherTemplateDefaults): PageSlice[] {
    const lines = sample.lines;
    const rowMm = (l: ThermalReceiptSample["lines"][number]) => ROW_MM + (template.showLineNote && l.note ? NOTE_MM : 0);
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
        + (printsSettlement(sample, template) ? 21 : 0);
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
    const rung0Used = goodsMm + tailMm + taxAnalysisMm + termsMm + qrMm + sigMm + barcodeMm;
    if (rung0Used <= contentMm) {
        // Slack left after the whole voucher fits — a short bill (few lines)
        // ends the goods table early and leaves bare paper before the totals.
        // Below FILLER_MIN_MM the gap reads as normal breathing room, not a
        // hole, so it's left alone; above it, a filler row inside the goods
        // table absorbs the space so the ruled frame reaches the totals.
        const slack = contentMm - rung0Used;
        const fillerRowMm = slack >= FILLER_MIN_MM ? Math.min(slack, FILLER_MAX_MM) : 0;
        return [{
            lines, startIndex: 0, broughtForward: null, carriedForward: null,
            isFirst: true, isLast: true, annexure: false, taxAnalysis: true,
            showTerms: true, showSignature: true, showFooterLine: true,
            showDisclaimer: true, showBarcode: true, showQr: true, fillerRowMm,
        }];
    }

    /** The tax-analysis annexure — identical on every rung that has one. */
    const annexureSheet = (startIndex: number): PageSlice => ({
        lines: [], startIndex, broughtForward: null, carriedForward: null,
        isFirst: false, isLast: true, annexure: true, taxAnalysis: true,
        showTerms: false, showSignature: true, showFooterLine: true,
        showDisclaimer: true, showBarcode: true, showQr: true, fillerRowMm: 0,
    });

    // From here on every sheet also spends height on the "Page n of m" strip.
    const sheetCap = contentMm - PAGE_FOOT_MM;

    // Rung 1 — voucher + annexure, voucher fully dressed.
    if (goodsMm + tailMm + termsMm + qrMm + sigMm + barcodeMm <= sheetCap) {
        return [{
            lines, startIndex: 0, broughtForward: null, carriedForward: null,
            isFirst: true, isLast: false, annexure: false, taxAnalysis: false,
            showTerms: true, showSignature: true, showFooterLine: true,
            showDisclaimer: true, showBarcode: true, showQr: true, fillerRowMm: 0,
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
            fillerRowMm: 0,
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
