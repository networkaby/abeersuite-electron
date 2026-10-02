"use client";

import { formatInr } from "@/shared/lib/format/moneyInr";
import { balanceLabel } from "./partyBalance";

export type PartyVoucher = {
    id: number;
    kind: string;
    ref: string;
    date: string;
    /** When it was actually saved (a till's own clock), else when it reached the office. */
    savedAt: string;
    by: string | null;
    status: "POSTED" | "DRAFT" | "CANCELLED";
    amount: number;
    /** + they owe us more, − they owe us less. */
    movement: number;
    /** The party's balance after this voucher — null when it is not posted. */
    balanceAfter: number | null;
};

const thisYear = new Date().getFullYear();

/** "2 Oct" this year, "2 Oct 2025" otherwise. */
function day(d: Date): string {
    return d.toLocaleDateString("en-IN", {
        day: "numeric", month: "short", ...(d.getFullYear() === thisYear ? {} : { year: "numeric" }),
    });
}

/**
 * The voucher's date, plus when it was saved — but only a REAL save time.
 * Imported and older vouchers carry midnight UTC (it would read "5:30 am"), so
 * those show the date alone. A save on another day than the voucher's own date
 * (back-dated) says so.
 */
function when(dateIso: string, savedIso: string): string {
    // A DATE column — a calendar day, read as one (never shifted by a time zone).
    const date = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
    const saved = new Date(savedIso);
    if (savedIso.endsWith("T00:00:00.000Z")) return day(date);
    const time = saved.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return saved.toDateString() === date.toDateString()
        ? `${day(date)}, ${time}`
        : `${day(date)} · saved ${day(saved)}, ${time}`;
}

/**
 * One party's vouchers, newest first, with the balance after each — "was the last
 * voucher posted?" at a glance. Drafts and cancelled vouchers are listed and
 * tagged but move no balance (only posted ones count, as in the ledger).
 */
export default function MobilePartyVouchers({ items }: { items: PartyVoucher[] }) {
    return (
        <ul className="divide-y">
            {items.map((v) => {
                const posted = v.status === "POSTED";
                const bal = v.balanceAfter == null ? null : balanceLabel(v.balanceAfter);
                return (
                    <li key={v.id} className={`flex items-start gap-3 px-3 py-3 ${v.status === "CANCELLED" ? "opacity-60" : ""}`}>
                        <div className="min-w-0 flex-1">
                            <p className={`font-medium leading-snug ${v.status === "CANCELLED" ? "line-through" : ""}`}>
                                {v.kind} <span className="font-normal text-muted-foreground">{v.ref}</span>
                                {posted && <span className="ml-1 text-emerald-600 dark:text-emerald-400" title="Posted">✓</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {when(v.date, v.savedAt)}{v.by ? ` · ${v.by}` : ""}
                            </p>
                            {!posted && (
                                <span
                                    className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                        v.status === "DRAFT"
                                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                            : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                    {v.status === "DRAFT" ? "Draft — not posted" : "Cancelled"}
                                </span>
                            )}
                        </div>
                        <div className="shrink-0 text-right">
                            <p className={`font-semibold ${v.status === "CANCELLED" ? "line-through" : ""}`}>{formatInr(v.amount)}</p>
                            {bal && <p className={`text-xs ${bal.tone}`}>Bal {bal.text}</p>}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
