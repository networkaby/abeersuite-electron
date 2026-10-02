"use client";

// ── UpiPartsPanel ────────────────────────────────────────────────────────────
// The "UPI in parts" panel that opens BESIDE the checkout (CheckoutDialog's
// sidePanel) — never over it, so the cashier can still move money between the
// rows while the customer scans. It shows the part due now (its QR is on the
// customer display), a checkbox on every part — ticked as the money comes in —
// and the choice between parts (no bank charge) and one scan (MDR in the price).
// Parts are paid in order (one QR at a time), so ticking a part ticks the ones
// before it, and un-ticking one clears it and the ones after. Presentational only: the parts and the figures come from
// usePosBilling (paymentMdr.ts), the buttons call back into it.

import { Check, Smartphone, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatInr } from "@/shared/lib/format";

export type UpiPanelState = {
    rowId: string;
    /** The counter's UPI account — "PhonePe". */
    label: string;
    /** Parts already received — bank credits, fixed. */
    received: number[];
    /** Parts still to take; the first is due now. */
    pending: number[];
    /** The rest is taken as one payment (carries MDR). */
    oneGo: boolean;
    /** What this row comes to when the rest is taken in parts / in one scan. */
    inPartsAmount: number;
    oneScanAmount: number;
};

export function UpiPartsPanel({ panel, onReceived, onToggle, onOneGo, onSplit }: {
    panel: UpiPanelState;
    /** Tick the part due now. */
    onReceived: () => void;
    /** A part's checkbox — `on` ticks it (and the ones before), off clears it
     *  (and the ones after). */
    onToggle: (index: number, on: boolean) => void;
    onOneGo: () => void;
    onSplit: () => void;
}) {
    const { label, received, pending, oneGo, inPartsAmount, oneScanAmount } = panel;
    const all = [...received, ...pending];
    const due = pending[0];
    const charge = Math.max(0, Math.round((oneScanAmount - inPartsAmount) * 100) / 100);
    // A single fresh payment with nothing received needs no tick — the plain
    // one-scan UPI the counter always took.
    const tracked = received.length > 0 || all.length > 1;

    return (
        <aside className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium">
                {oneGo && received.length === 0 ? <Smartphone size={14} /> : <Split size={14} />}
                {oneGo && received.length === 0 ? "UPI in one scan" : "UPI in parts"}
                <span className="font-normal text-muted-foreground">· {label}</span>
            </div>

            {/* The payment due now — its QR is on the customer display. */}
            {tracked && due != null && (
                <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5 text-center">
                    <div className="text-xs text-muted-foreground">
                        {all.length > 1 ? `Customer scans part ${received.length + 1} of ${all.length}` : "Customer scans"}
                    </div>
                    <div className="text-2xl font-semibold tabular-nums">{formatInr(due)}</div>
                    <div className="text-[11px] text-muted-foreground">QR is on the customer display</div>
                </div>
            )}
            {tracked && due == null && (
                <div className="flex items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <Check size={14} /> All {all.length > 1 ? `${all.length} parts` : "of it"} received
                </div>
            )}

            {tracked && due != null && (
                <Button type="button" size="sm" className="w-full" onClick={onReceived}>
                    <Check size={14} /> {all.length > 1 ? `Part ${received.length + 1} received` : "Received"}
                </Button>
            )}

            {/* Every part, in the order the customer pays them — a checkbox each. */}
            {tracked && (
                <ol className="space-y-1">
                    {all.map((p, i) => {
                        const isIn = i < received.length;
                        const isNow = i === received.length;
                        return (
                            <li key={i}>
                                <label
                                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2 py-1.5 text-xs tabular-nums ${
                                        isIn
                                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                                            : isNow
                                              ? "border-primary/40 bg-primary/10 font-semibold"
                                              : "border-transparent text-muted-foreground"
                                    }`}
                                >
                                    <Checkbox
                                        checked={isIn}
                                        onCheckedChange={(v) => onToggle(i, v === true)}
                                        aria-label={`Part ${i + 1} received`}
                                        className="size-5 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
                                    />
                                    <span>Part {i + 1}</span>
                                    <span className="ml-auto flex items-center gap-1.5">
                                        {formatInr(p)}
                                        {isIn ? <span className="text-[10px] font-normal">received</span> : isNow ? <span className="text-[10px] font-normal">now</span> : null}
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ol>
            )}

            {/* Parts or one scan — what each comes to for this row. Only a real
                choice when one scan costs a bank charge. */}
            {due != null && charge > 0 && (
                <div className="space-y-1.5 border-t border-border pt-2 text-xs">
                    <div className={`flex items-center justify-between ${oneGo ? "text-muted-foreground" : "font-medium"}`}>
                        <span>In parts · no bank charge</span>
                        <span className="tabular-nums">{formatInr(inPartsAmount)}</span>
                    </div>
                    <div className={`flex items-center justify-between ${oneGo ? "font-medium" : "text-muted-foreground"}`}>
                        <span>One scan{charge > 0 ? ` · +${formatInr(charge)} bank charge` : ""}</span>
                        <span className="tabular-nums">{formatInr(oneScanAmount)}</span>
                    </div>
                    {oneGo ? (
                        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onSplit}>
                            <Split size={14} /> Split into parts instead
                        </Button>
                    ) : (
                        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onOneGo}>
                            <Smartphone size={14} /> Take the rest in one scan
                        </Button>
                    )}
                </div>
            )}

            {tracked && due != null && (
                <p className="text-[11px] text-muted-foreground">Confirm unlocks once every part is received.</p>
            )}
        </aside>
    );
}
