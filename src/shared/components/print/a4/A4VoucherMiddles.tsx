// ── A4 bespoke middles: money receipt, deposit / handover slip, journal ─────
// Vouchers that are not a sale print one of these between the shared
// letterhead and sign-off instead of the goods table. InvoiceBody
// (A4InvoicePreview.tsx) picks one by kind — see the kind sets in a4Shared.ts.

import { rupeesInWords } from "@/shared/lib/format/numberToWords";
import { formatAmount } from "@/shared/lib/format/moneyInr";
import { fmtINR, type A4ChromeProps } from "@/shared/components/print/a4/a4Shared";

/** Bespoke middle for money vouchers — classic receipt-book prose
 *  ("Received with thanks from ___ the sum of Rupees ___") with dotted
 *  fill-ins and a boxed amount. Letterhead + footer chrome stay shared. */
export function MoneyReceiptMiddle({ template, sample }: A4ChromeProps) {
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
export function DepositSlipMiddle({ sample }: A4ChromeProps) {
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
export function JournalMiddle({ sample }: A4ChromeProps) {
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
