// ── A4 goods table ──────────────────────────────────────────────────────────
// The Tally-style item table a tax invoice prints (one sheet's slice of it
// when the bill is paginated). Rendered by DefaultA4Middle in
// A4InvoicePreview.tsx.

import { formatAmount } from "@/shared/lib/format/moneyInr";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { fmtINR, type A4ChromeProps } from "@/shared/components/print/a4/a4Shared";

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
    /** Blank mm to draw as a filler row before the ledger — see `PageSlice.fillerRowMm`. */
    fillerRowMm?: number;
}

export function GoodsTable({
    template, sample, pageLines, startIndex = 0, broughtForward = null, carriedForward = null,
    fillerRowMm = 0,
}: GoodsTableProps) {
    const lines = pageLines ?? sample.lines;
    // Column visibility is decided by the WHOLE voucher, never by the page —
    // otherwise page 2 would drop a column page 1 shows and the two sheets
    // would not line up.
    const all = sample.lines;
    const anyHsn = all.some((l) => !!l.hsn);
    const anyUnit = all.some((l) => !!l.unit);
    // A challan printed with "Show prices" off keeps only # / goods / HSN / qty.
    const priced = !sample.hidePrices;
    const anyDisc = priced && all.some((l) => (l.discount ?? 0) > 0.005);
    const anyMrp = priced && template.showMrp && all.some((l) => (l.mrp ?? 0) > 0);
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
    // Never toggleable: the GST legs are part of the Total's arithmetic
    // (Sub Total + charges + GST + round off = Total) and the law wants the tax
    // charged on the face of the bill. `showTaxSummary` only drops the separate
    // HSN/SAC analysis table lower down.
    if (exclusive && sample.taxBreakdown) {
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
    // An unpriced challan still closes with the quantity total.
    const hasTotal = isLastPage && (sample.total !== null || !priced);

    // Colspan for a ledger row's right-aligned label: everything between the
    // serial column and the amount column.
    const midCols = 1 /* description */ + (anyHsn ? 1 : 0) + (anyMrp ? 1 : 0)
        + 1 /* qty */ + (anyUnit ? 1 : 0) + (priced ? 1 : 0) /* rate */ + (anyDisc ? 1 : 0);

    const signed = (n: number) => (n < 0 ? `(-)${formatAmount(Math.abs(n))}` : formatAmount(n));

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
                    {priced && <th className="num" style={{ width: 74 }}>Rate</th>}
                    {anyDisc && <th className="num" style={{ width: 60 }}>Disc.</th>}
                    {priced && <th className="num" style={{ width: 86 }}>Amount</th>}
                </tr>
            </thead>
            <tbody>
                {/* Opening balance on a continuation sheet, so the reader can
                    follow the arithmetic across the page break. */}
                {priced && broughtForward != null && (
                    <tr className="ledger">
                        <td />
                        <td colSpan={midCols} className="num">Brought forward</td>
                        <td className="num">{formatAmount(broughtForward)}</td>
                    </tr>
                )}
                {lines.map((l, i) => (
                    <tr key={i}>
                        <td className="ctr">{startIndex + i + 1}</td>
                        <td>
                            <div className="item">{l.description}</div>
                            {template.showLineNote && l.note && <div className="note">{l.note}</div>}
                        </td>
                        {anyHsn && <td className="ctr">{l.hsn ?? ""}</td>}
                        {anyMrp && <td className="num">{l.mrp ? formatAmount(l.mrp) : "—"}</td>}
                        <td className="num">{l.quantity}</td>
                        {anyUnit && <td className="ctr">{l.unit ?? ""}</td>}
                        {priced && <td className="num">{formatAmount(unitRate(l))}</td>}
                        {anyDisc && <td className="num">{(l.discount ?? 0) > 0.005 ? formatAmount(l.discount!) : "—"}</td>}
                        {priced && <td className="num">{formatAmount(value(l))}</td>}
                    </tr>
                ))}

                {/* Blank stretch absorbing a short voucher's leftover sheet
                    space — see PageSlice.fillerRowMm. One empty cell per real
                    item column (not a single span, unlike the open ledger
                    rows below) so the column rules run straight down through
                    it — the frame reads as unbroken from the header to
                    Sub Total, not stopped after the last item. */}
                {fillerRowMm > 0 && (
                    <tr className="filler" style={{ height: `${fillerRowMm}mm` }}>
                        <td className="ctr" />
                        <td />
                        {anyHsn && <td className="ctr" />}
                        {anyMrp && <td className="num" />}
                        <td className="num" />
                        {anyUnit && <td className="ctr" />}
                        {priced && <td className="num" />}
                        {anyDisc && <td className="num" />}
                        {priced && <td className="num" />}
                    </tr>
                )}

                {/* Item subtotal — figure only, under a full-width rule, when
                    ledger rows follow it. With nothing below, the Total row
                    says it all. */}
                {ledger.length > 0 && (
                    <tr className="subtotal">
                        <td />
                        <td colSpan={midCols} className="num" style={{ padding: "10px 6px 4px" }}>
                            Sub Total
                        </td>
                        <td className="num">{formatAmount(itemTotal)}</td>
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
                {priced && carriedForward != null && (
                    <tr className="grand">
                        <td />
                        <td colSpan={midCols} className="num">Carried forward</td>
                        <td className="num">{formatAmount(carriedForward)}</td>
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
                        {priced && <td />}
                        {anyDisc && <td className="num">{discTotal > 0.005 ? formatAmount(discTotal) : ""}</td>}
                        {priced && <td className="num">{fmtINR(sample.total!)}</td>}
                    </tr>
                )}
            </tbody>
        </table>
    );
}
