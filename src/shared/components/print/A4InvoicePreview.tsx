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
import { rupeesInWords } from "@/shared/lib/format/numberToWords";
import { formatAmount } from "@/shared/lib/format/moneyInr";
import type { ThermalReceiptSample } from "@/shared/components/print/ThermalReceiptPreview";
import { BarcodeSvg } from "@/modules/inventory/components/BarcodeSvg";
import { QrSvg } from "@/shared/components/print/QrSvg";
import SetDocumentTitle from "@/shared/components/print/SetDocumentTitle";
import { gstinDerivedStateCode } from "@/shared/lib/gst/computeGstSplit";
import { stateNameForCode } from "@/shared/lib/gst/indianStates";
import { A4_PREVIEW_SCOPE_CLASS, inlineA4Styles } from "@/shared/components/print/a4/a4Styles";
import { DEPOSIT_SLIP_KINDS, fmtINR, JOURNAL_KINDS, MONEY_RECEIPT_KINDS, type A4ChromeProps } from "@/shared/components/print/a4/a4Shared";
import { paginateGoods, printsSettlement, type PageSlice } from "@/shared/components/print/a4/a4Pagination";

interface InvoiceBodyProps {
    template: VoucherTemplateDefaults;
    sample: ThermalReceiptSample;
    /** Custom middle for bespoke documents (repair ticket / shipping slip /
     *  payment slip). Replaces the invoice meta/lines/totals block; the
     *  template-driven letterhead + footer chrome stay shared. */
    body?: React.ReactNode;
}

/** Template-driven letterhead (logo · brand · address · GSTIN · phone) + banner. */
function A4Header({ template, sample }: A4ChromeProps) {
    // headerLine1 is always filled by mergeTemplateWithOrg (Organisation brand
    // fallback) — one brand source, no second fallback here.
    const brand = template.headerLine1;
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
                {template.showPartyBalance && (sample.balanceBefore || sample.balanceAfter) && (
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

/** Bespoke middle for a Cash → Bank CONTRA, or a cash PAYMENT deposited into
 *  the party's bank (`slip.paidTo` set) — a bank pay-in slip. Top portion
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
                        {slip.paidTo && <div className="brow"><span className="l">Paid to</span><span className="bold">{slip.paidTo}</span></div>}
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
                                                <td className="amt">{formatAmount(n.denom * n.count)}</td>
                                            </tr>
                                        ))}
                                        <tr className="tot">
                                            <td>Cash Total</td>
                                            <td className="cnt" style={{ textAlign: "center" }}>{counted.notes.reduce((s, n) => s + n.count, 0)}</td>
                                            <td className="amt">{formatAmount(counted.notes.reduce((s, n) => s + n.denom * n.count, 0))}</td>
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
                                                <td className="amt">{formatAmount(c.amount)}</td>
                                            </tr>
                                        ))}
                                        {counted.cheques.length > 1 && (
                                            <tr className="tot">
                                                <td>Cheques Total</td>
                                                <td className="amt">{formatAmount(counted.cheques.reduce((s, c) => s + c.amount, 0))}</td>
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
                                <tr className="tot"><td>Total</td><td className="cnt" /><td className="amt">{formatAmount(total)}</td></tr>
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
                        {/* A party deposit is our proof of payment — name who it went to. */}
                        {slip.paidTo && (
                            <div className="brow">
                                <span className="l">Paid to</span>
                                <span>{slip.paidTo}</span>
                            </div>
                        )}
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
    /** Blank mm to draw as a filler row before the ledger — see `PageSlice.fillerRowMm`. */
    fillerRowMm?: number;
}

function GoodsTable({
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
                                        <td>
                                            {l.description}
                                            {template.showLineNote && l.note && <div className="note">{l.note}</div>}
                                        </td>
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
                    fillerRowMm={page?.fillerRowMm ?? 0}
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
                            The HSN/SAC table below gives the full rate-wise breakup.
                            Belongs to the total block, so it is never toggleable. */}
                            {sample.hsnSummary && sample.hsnSummary.length > 0 && (() => {
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
                // `amount` on a charge row is ALREADY the pre-tax net (its GST
                // sits in taxAmount), so it IS the taxable value. Subtracting the
                // tax from it a second time shrank a ₹254.24 service to ₹208.46
                // and left the summary short of the bill.
                const chargeTaxable = chargeAmount > 0.005 ? chargeAmount : 0;
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
                                    <td className="num">{formatAmount(h.taxable)}</td>
                                    {inter ? (
                                        <><td>{h.ratePct}%</td><td className="num">{formatAmount(h.cgst + h.sgst)}</td></>
                                    ) : (
                                        <>
                                            <td>{h.ratePct / 2}%</td><td className="num">{formatAmount(h.cgst)}</td>
                                            <td>{h.ratePct / 2}%</td><td className="num">{formatAmount(h.sgst)}</td>
                                        </>
                                    )}
                                    <td className="num">{formatAmount(h.cgst + h.sgst)}</td>
                                </tr>
                            ))}
                            {chargeTax > 0.005 && chargeAmount > 0.005 && (
                                <tr>
                                    <td className="l">—</td>
                                    <td className="num">{formatAmount(chargeTaxable)}</td>
                                    {inter ? (
                                        <><td>{chargeRatePct}%</td><td className="num">{formatAmount(chargeTax)}</td></>
                                    ) : (
                                        <>
                                            <td>{chargeRatePct / 2}%</td><td className="num">{formatAmount(chargeTax / 2)}</td>
                                            <td>{chargeRatePct / 2}%</td><td className="num">{formatAmount(chargeTax / 2)}</td>
                                        </>
                                    )}
                                    <td className="num">{formatAmount(chargeTax)}</td>
                                </tr>
                            )}
                            <tr className="tot">
                                <td>Total</td>
                                <td className="num">{formatAmount(totalTaxable)}</td>
                                {inter ? (
                                    <><td /><td className="num">{formatAmount(totalTax)}</td></>
                                ) : (
                                    <><td /><td className="num">{formatAmount(totalCgst)}</td><td /><td className="num">{formatAmount(totalSgst)}</td></>
                                )}
                                <td className="num">{formatAmount(totalTax)}</td>
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
            {showTails && printsSettlement(sample, template) && (
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
            {(bank || (template.kind !== "SHIFT_CLOSE" && template.showSignature)) && (
                <div className="signoff-row">
                    <div className="signoff-bank">{bank && <BankBlock template={template} />}</div>
                    {template.kind !== "SHIFT_CLOSE" && template.showSignature && (
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
