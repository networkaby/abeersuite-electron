"use client";

// Cash note-counting for a voucher row (deposit slip). Moved out of
// GlVoucherPage.tsx unchanged.

import { Input } from "@/components/ui/input";
import { fmt, round2 } from "@/shared/lib/format/moneyInr";

// ── Contra denomination capture ─────────────────────────────────────────────
// While the "Denomination details" box is ticked (auto-on when Transfer-to is
// a bank), each CASH "Transfer from" row gets a note-counting panel in the side
// space and its amount is LOCKED to the counted total. A CHEQUE is a separate
// Transfer-from row marked with the "Cheque" toggle (its ledger = the drawer's
// account, its amount typed). At save the cash notes merge note-wise and the
// cheque rows collect into ONE final DenomJson stored on the spine.

export type RowDenom = { counts: Record<number, string> };  // denomination → count (input string)
export const emptyRowDenom = (): RowDenom => ({ counts: {} });
export const FALLBACK_DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

/** The notes actually counted, as a stable key — a box typed "0" or emptied
 *  again is no count at all. */
export const countedNotes = (d: RowDenom | undefined): [string, number][] =>
    Object.entries(d?.counts ?? {})
        .map(([den, c]): [string, number] => [den, parseInt(c || "0", 10) || 0])
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => Number(a) - Number(b));

export const rowDenomTotal = (d: RowDenom): number =>
    Object.entries(d.counts).reduce((s, [den, c]) => s + Number(den) * (parseInt(c || "0", 10) || 0), 0);

/** One cash row's note-counting panel — counts per denomination + running total.
 *  `target` (Payment) = the amount the count must reach; shows short / excess. */
export function DenomPanel({ title, denomList, value, onChange, target }: {
    title:     string;
    denomList: number[];
    value:     RowDenom;
    onChange:  (updater: (d: RowDenom) => RowDenom) => void;
    target?:   number;
}) {
    const gap = target == null ? 0 : round2(rowDenomTotal(value) - target);
    return (
        <div className="rounded-md border border-border bg-card p-3 space-y-2 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{title}</p>
            <table className="w-full text-xs">
                <tbody>
                    {denomList.map((d) => {
                        const c = parseInt(value.counts[d] || "0", 10) || 0;
                        return (
                            <tr key={d}>
                                <td className="w-16 py-0.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">{d} &times;</td>
                                <td className="w-16 py-0.5">
                                    <Input
                                        value={value.counts[d] ?? ""}
                                        inputMode="numeric"
                                        placeholder="0"
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (/^\d*$/.test(v)) onChange((dd) => ({ ...dd, counts: { ...dd.counts, [d]: v } }));
                                        }}
                                        className="h-6 text-right text-xs font-mono"
                                    />
                                </td>
                                <td className="py-0.5 pl-2 text-right font-mono tabular-nums text-muted-foreground">
                                    {c > 0 ? fmt(d * c) : ""}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="flex justify-between border-t border-border pt-1.5 text-xs font-medium">
                <span>Total</span>
                <span className="font-mono tabular-nums">₹ {fmt(rowDenomTotal(value))}</span>
            </div>
            {target != null && Math.abs(gap) > 0.005 && (
                <div className="flex justify-between text-xs text-destructive">
                    <span>{gap < 0 ? "Short of payment" : "More than payment"}</span>
                    <span className="font-mono tabular-nums">₹ {fmt(Math.abs(gap))}</span>
                </div>
            )}
        </div>
    );
}
