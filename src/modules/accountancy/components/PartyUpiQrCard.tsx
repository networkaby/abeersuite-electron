"use client";

/**
 * Scan-to-pay card on the Payment voucher: the payee party's UPI id as a QR,
 * amount pre-filled, so the cashier pays from a phone and then saves the
 * voucher. Sits under the open-bills panel in the same side scroll.
 *
 * The QR proves nothing — the app never learns whether the phone payment went
 * through — hence the "save only after success" line.
 */

import { QrSvg } from "@/shared/components/print/QrSvg";
import { buildPartyUpiLink } from "@/shared/lib/parties/partyBank";
import { fmt, round2 } from "@/shared/lib/format/moneyInr";

type Props = {
    partyName: string;
    upiVpa?: string;
    upiPayee?: string;
    amount: number;
};

export function PartyUpiQrCard({ partyName, upiVpa, upiPayee, amount }: Props) {
    const payee = upiPayee || partyName;
    const link = upiVpa ? buildPartyUpiLink({ upiVpa, beneficiary: upiPayee ?? "" }, partyName, round2(amount)) : "";

    return (
        <div className="rounded-md border bg-card p-3 text-xs">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
                Scan to pay (UPI) — {partyName}
            </div>
            {!link ? (
                <p className="mt-2 text-muted-foreground">
                    No UPI ID saved for this party. Add it in the party&rsquo;s Bank tab.
                </p>
            ) : (
                <>
                    <div className="mt-2 flex gap-3">
                        <div className="shrink-0 rounded border bg-white p-1">
                            <QrSvg value={link} size={128} />
                        </div>
                        <div className="min-w-0 space-y-1.5 leading-snug">
                            <div>
                                <div className="text-[10px] uppercase text-muted-foreground">Pay to</div>
                                <div className="font-semibold break-words">{payee}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase text-muted-foreground">UPI ID</div>
                                <div className="font-mono break-all">{upiVpa}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase text-muted-foreground">Amount</div>
                                <div className="font-mono text-sm font-bold tabular-nums">
                                    {amount > 0 ? `₹ ${fmt(round2(amount))}` : "Payer types it"}
                                </div>
                            </div>
                        </div>
                    </div>
                    <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        Save the voucher only after the payment is successful on your phone.
                    </p>
                </>
            )}
        </div>
    );
}
