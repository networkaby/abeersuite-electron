"use client";

// Tally's "Daily Breakup of Ledger" for any statement: every day of the period
// with its Debit, Credit and Closing Balance, then Grand Total and Average — so
// a wrong balance is pinned to its day first, and the day opened to find the
// voucher. Shared by the party Transactions tab and the Ledger explorer (bank,
// cash, every account). One tick for all of them, remembered for this tab.

import { Fragment, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useSessionState } from "@/shared/hooks";
import { cn } from "@/shared/lib/format/utils";
import { fmt, formatDrCr } from "@/shared/lib/format/moneyInr";
import { formatDate } from "@/shared/lib/format/formatDate";

type NormalBalance = "DEBIT" | "CREDIT";

/** The Daily tick — one switch for every statement, remembered for this tab. */
export function useDailyTick() {
    return useSessionState("statement:daily-breakup", false);
}

export function DailyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
            <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
            Daily
        </label>
    );
}

/** One voucher's share of a day. */
export type DailyEntry<T> = { date: string; debit: number; credit: number; row: T };

// A runaway range (a typo'd year) must not paint a hundred thousand rows.
const MAX_DAYS = 3660;

/** yyyy-mm-dd for every calendar day from..to, inclusive. */
function daysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    const d = new Date(`${from.slice(0, 10)}T00:00:00Z`);
    const end = new Date(`${to.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(+d) || Number.isNaN(+end)) return out;
    while (d <= end && out.length < MAX_DAYS) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

export function DailyBreakupTable<T>({ entries, opening, from, to, normalBalance, renderVouchers }: {
    entries:       DailyEntry<T>[];
    /** Balance brought forward, signed onto the account's normal side. */
    opening:       number;
    from:          string;
    to:            string;
    normalBalance: NormalBalance | null;
    /** A day's own vouchers, drawn when the day is opened. */
    renderVouchers: (rows: T[]) => ReactNode;
}) {
    const [openDays, setOpenDays] = useState<Set<string>>(new Set());
    const toggle = (date: string) =>
        setOpenDays((prev) => {
            const next = new Set(prev);
            if (next.has(date)) next.delete(date); else next.add(date);
            return next;
        });

    const nb = normalBalance ?? "DEBIT";
    const byDay = new Map<string, DailyEntry<T>[]>();
    for (const e of entries) {
        const key = e.date.slice(0, 10);
        const list = byDay.get(key);
        if (list) list.push(e); else byDay.set(key, [e]);
    }

    let balance = opening;
    let totalDr = 0;
    let totalCr = 0;
    let closingSum = 0;
    const days: { date: string; list: DailyEntry<T>[]; debit: number; credit: number; closing: number }[] = [];
    for (const date of daysBetween(from, to)) {
        const list = byDay.get(date) ?? [];
        const debit = list.reduce((s, e) => s + e.debit, 0);
        const credit = list.reduce((s, e) => s + e.credit, 0);
        balance += nb === "DEBIT" ? debit - credit : credit - debit;
        totalDr += debit;
        totalCr += credit;
        closingSum += balance;
        days.push({ date, list, debit, credit, closing: balance });
    }
    const n = days.length || 1;

    const money = (v: number) => (Math.abs(v) < 0.005 ? "" : fmt(v));
    const bal = (v: number) => formatDrCr(Math.round(v * 100) / 100, nb);

    return (
        <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Particulars</th>
                    <th className="px-4 py-2 text-right font-medium">Debit</th>
                    <th className="px-4 py-2 text-right font-medium">Credit</th>
                    <th className="px-4 py-2 text-right font-medium">Closing balance</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                <tr className="bg-muted/30 text-xs">
                    <td className="px-4 py-2 italic text-muted-foreground">Opening balance</td>
                    <td />
                    <td />
                    <td className="px-4 py-2 text-right font-mono font-semibold">{bal(opening)}</td>
                </tr>
                {days.map((day) => {
                    const has = day.list.length > 0;
                    const open = has && openDays.has(day.date);
                    return (
                        <Fragment key={day.date}>
                            <tr
                                className={cn("text-xs", has ? "cursor-pointer hover:bg-muted/40" : "text-muted-foreground")}
                                onClick={has ? () => toggle(day.date) : undefined}
                            >
                                <td className="px-4 py-1.5 whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1">
                                        <ChevronRight
                                            size={12}
                                            className={cn("shrink-0 transition-transform", !has && "invisible", open && "rotate-90")}
                                        />
                                        <span className={cn(has && "font-medium")}>{formatDate(day.date)}</span>
                                        {has && (
                                            <span className="text-muted-foreground">
                                                · {day.list.length} {day.list.length === 1 ? "voucher" : "vouchers"}
                                            </span>
                                        )}
                                    </span>
                                </td>
                                <td className="px-4 py-1.5 text-right font-mono">{money(day.debit)}</td>
                                <td className="px-4 py-1.5 text-right font-mono">{money(day.credit)}</td>
                                <td className={cn("px-4 py-1.5 text-right font-mono", has && "font-semibold")}>{bal(day.closing)}</td>
                            </tr>
                            {open && (
                                <tr>
                                    <td colSpan={4} className="bg-muted/20 p-2 pl-8">
                                        {renderVouchers(day.list.map((e) => e.row))}
                                    </td>
                                </tr>
                            )}
                        </Fragment>
                    );
                })}
                <tr className="border-t-2 border-border bg-muted/40 text-xs font-semibold">
                    <td className="px-4 py-2">Grand total</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(totalDr)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(totalCr)}</td>
                    <td className="px-4 py-2 text-right font-mono text-primary">{bal(balance)}</td>
                </tr>
                <tr className="bg-muted/30 text-xs text-muted-foreground">
                    <td className="px-4 py-2">Average</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(totalDr / n)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(totalCr / n)}</td>
                    <td className="px-4 py-2 text-right font-mono">{bal(closingSum / n)}</td>
                </tr>
            </tbody>
        </table>
    );
}
