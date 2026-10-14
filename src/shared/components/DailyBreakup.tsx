"use client";

// Tally's "daily breakup" for any statement: one line per day carrying that
// day's totals and closing balance, so a wrong balance can be pinned to its day
// first and the day opened to find the voucher. Shared by the party Transactions
// tab and the Ledger explorer (bank, cash, every account). One tick for all of
// them, remembered for this tab.

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useSessionState } from "@/shared/hooks";
import { cn } from "@/shared/lib/format/utils";

export type DayGroup<T> = { date: string; rows: T[] };

/** Consecutive rows of the same calendar day, in the order given. */
export function groupByDay<T>(rows: T[], dateOf: (row: T) => string): DayGroup<T>[] {
    const out: DayGroup<T>[] = [];
    for (const row of rows) {
        const date = dateOf(row).slice(0, 10);
        const last = out[out.length - 1];
        if (last && last.date === date) last.rows.push(row);
        else out.push({ date, rows: [row] });
    }
    return out;
}

/** The Daily tick — one switch for every statement, remembered for this tab. */
export function useDailyTick() {
    return useSessionState("statement:daily-breakup", false);
}

/** Which days of a daily breakup are opened to show their vouchers. */
export function useOpenDays() {
    const [openDays, setOpenDays] = useState<Set<string>>(new Set());
    const toggleDay = (date: string) =>
        setOpenDays((prev) => {
            const next = new Set(prev);
            if (next.has(date)) next.delete(date); else next.add(date);
            return next;
        });
    return { isOpen: (date: string) => openDays.has(date), toggleDay };
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

/** The caret + voucher count shown in a day row's first cell. */
export function DayRowLabel({ open, count }: { open: boolean; count: number }) {
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium">
            <ChevronRight size={12} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
            {count} {count === 1 ? "voucher" : "vouchers"}
        </span>
    );
}
