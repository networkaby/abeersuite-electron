"use client";

import { formatInr } from "@/shared/lib/format/moneyInr";
import { balanceLabel } from "../lib/partyBalance";

export type PartyVoucher = {
    id: number;
    kind: string;
    ref: string;
    date: string;
    /** When it was actually saved (a till's own clock), else when it reached the office. */
    savedAt: string;
    by: string | null;
    amount: number;
    /** + they owe us more, − they owe us less. */
    movement: number;
    /** The party's balance after this voucher. */
    balanceAfter: number;
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

/** One party's posted vouchers, newest first, with the balance after each.
 *  Drafts and cancelled ones are not sent — the phone cannot act on them. */
export default function MobilePartyVouchers({ items }: { items: PartyVoucher[] }) {
    return (
        <ul className="divide-y">
            {/* A list saved on the phone before drafts were dropped still holds them,
                with no balance — skip those until the next fresh answer replaces it. */}
            {items.filter((v) => v.balanceAfter != null).map((v) => {
                const bal = balanceLabel(v.balanceAfter);
                return (
                    <li key={v.id} className="flex items-start gap-3 px-3 py-3">
                        <div className="min-w-0 flex-1">
                            <p className="font-medium leading-snug">
                                {v.kind} <span className="font-normal text-muted-foreground">{v.ref}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {when(v.date, v.savedAt)}{v.by ? ` · ${v.by}` : ""}
                            </p>
                        </div>
                        <div className="shrink-0 text-right">
                            <p className="font-semibold">{formatInr(v.amount)}</p>
                            <p className={`text-xs ${bal.tone}`}>Bal {bal.text}</p>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
