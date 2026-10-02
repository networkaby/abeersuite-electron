"use client";

// ── UpiPartsPanel ────────────────────────────────────────────────────────────
// The "UPI in parts" panel that opens BESIDE the checkout (CheckoutDialog's
// sidePanel) — never over it, so the cashier can still move money between the
// rows while the customer scans. Every part has three states:
//   • on display — the part being received; its QR is on the customer display.
//     Click any part still to come in to put it there.
//   • received   — its checkbox is ticked. Ticking the part on display passes
//     the display to the next part still to come in.
//   • waiting    — the rest.
// Ticking or picking one part never changes another's amount (the row's plan is
// kept as it stands — paymentMdr.ts upiPlan). Below the parts, the choice
// between parts (no bank charge) and one scan (MDR in the price). Presentational
// only: the plan and the figures come from usePosBilling.

import { Check, MonitorSmartphone, Smartphone, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatInr } from "@/shared/lib/format";
import type { UpiPart } from "@/modules/pos/lib/paymentMdr";

export type UpiPanelState = {
    rowId: string;
    /** The counter's UPI account — "PhonePe". */
    label: string;
    /** Every part of the row, in the order shown. */
    parts: UpiPart[];
    /** The part on the customer display; −1 when every part is in. */
    active: number;
    /** The rest is taken as one payment (carries MDR). */
    oneGo: boolean;
    /** What this row comes to when the rest is taken in parts / in one scan. */
    inPartsAmount: number;
    oneScanAmount: number;
};

export function UpiPartsPanel({ panel, onReceived, onToggle, onSelect, onOneGo, onSplit }: {
    panel: UpiPanelState;
    /** Tick the part on display. */
    onReceived: () => void;
    /** A part's checkbox — that part only. */
    onToggle: (index: number, on: boolean) => void;
    /** Put a part on the customer display. */
    onSelect: (index: number) => void;
    onOneGo: () => void;
    onSplit: () => void;
}) {
    const { label, parts, active, oneGo, inPartsAmount, oneScanAmount } = panel;
    const now = active >= 0 ? parts[active] : undefined;
    const receivedCount = parts.filter((p) => p.received).length;
    const charge = Math.max(0, Math.round((oneScanAmount - inPartsAmount) * 100) / 100);
    // A single fresh payment with nothing received needs no tick — the plain
    // one-scan UPI the counter always took.
    const tracked = receivedCount > 0 || parts.length > 1;

    return (
        <aside className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium">
                {tracked ? <Split size={14} /> : <Smartphone size={14} />}
                {tracked ? "UPI in parts" : "UPI in one scan"}
                <span className="font-normal text-muted-foreground">· {label}</span>
            </div>

            {/* The part on display — its QR is on the customer display. */}
            {tracked && now && (
                <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5 text-center">
                    <div className="text-xs text-muted-foreground">
                        {parts.length > 1 ? `Receiving part ${active + 1} of ${parts.length}` : "Receiving"}
                    </div>
                    <div className="text-2xl font-semibold tabular-nums">{formatInr(now.amount)}</div>
                    <div className="text-[11px] text-muted-foreground">QR is on the customer display</div>
                </div>
            )}
            {tracked && !now && (
                <div className="flex items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <Check size={14} /> All {parts.length > 1 ? `${parts.length} parts` : "of it"} received
                </div>
            )}

            {tracked && now && (
                <Button type="button" size="sm" className="w-full" onClick={onReceived}>
                    <Check size={14} /> {parts.length > 1 ? `Part ${active + 1} received` : "Received"}
                </Button>
            )}

            {/* Every part: click to put it on display, tick when its money is in. */}
            {tracked && (
                <ol className="space-y-1">
                    {parts.map((p, i) => {
                        const isNow = i === active;
                        return (
                            <li
                                key={i}
                                role="button"
                                tabIndex={p.received ? -1 : 0}
                                aria-pressed={isNow}
                                title={p.received ? undefined : "Show this part's QR on the customer display"}
                                onClick={() => { if (!p.received) onSelect(i); }}
                                onKeyDown={(e) => {
                                    if (!p.received && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(i); }
                                }}
                                className={`flex items-center gap-2.5 rounded-md border px-2 py-1.5 text-xs tabular-nums ${
                                    p.received
                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                                        : isNow
                                          ? "cursor-pointer border-primary bg-primary/10 font-semibold"
                                          : "cursor-pointer border-border text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                <Checkbox
                                    checked={p.received}
                                    onClick={(e) => e.stopPropagation()}
                                    onCheckedChange={(v) => onToggle(i, v === true)}
                                    aria-label={`Part ${i + 1} received`}
                                    className="size-5 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
                                />
                                <span>Part {i + 1}</span>
                                <span className="ml-auto flex items-center gap-1.5">
                                    {formatInr(p.amount)}
                                    {p.received ? (
                                        <span className="text-[10px] font-normal">received</span>
                                    ) : isNow ? (
                                        <span className="flex items-center gap-0.5 text-[10px] font-normal text-primary">
                                            <MonitorSmartphone size={11} /> on display
                                        </span>
                                    ) : null}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}

            {/* Parts or one scan — what each comes to for this row. Only a real
                choice when one scan costs a bank charge. */}
            {now && charge > 0 && (
                <div className="space-y-1.5 border-t border-border pt-2 text-xs">
                    <div className={`flex items-center justify-between ${oneGo ? "text-muted-foreground" : "font-medium"}`}>
                        <span>In parts · no bank charge</span>
                        <span className="tabular-nums">{formatInr(inPartsAmount)}</span>
                    </div>
                    <div className={`flex items-center justify-between ${oneGo ? "font-medium" : "text-muted-foreground"}`}>
                        <span>One scan · +{formatInr(charge)} bank charge</span>
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

            {tracked && now && (
                <p className="text-[11px] text-muted-foreground">
                    Click a part to show its QR · tick it when the money is in. Confirm unlocks once every part is received.
                </p>
            )}
        </aside>
    );
}
