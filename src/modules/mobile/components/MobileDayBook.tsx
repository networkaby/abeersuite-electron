"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatInr } from "@/shared/lib/format/moneyInr";
import { businessTodayIso } from "@/shared/lib/format/formatDate";
import MobileListScreen from "./MobileListScreen";
import { useMobileList } from "../hooks/useMobileList";
import MobileVoucherSheet, { useVoucherSheet } from "./MobileVoucherSheet";

type DayRow = {
    id: string;
    /** The spine id; absent on a day saved on the phone before it was sent. */
    uvId?: number;
    kind: string;
    ref: string;
    party: string | null;
    narration: string | null;
    amount: number;
    status: string;
};

/** yyyy-mm-dd moved by `days`, on the calendar (no timezone involved). */
function shiftDate(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One day of the Day Book, newest first: ◀ date ▶ at the top (today to start),
 * a total per voucher kind, then every voucher. Cancelled ones are struck through
 * and left out of the totals; drafts are marked. Search narrows the day by party,
 * voucher number or narration. A tap opens the voucher in the voucher sheet.
 */
export default function MobileDayBook({ userId }: { userId: string }) {
    // The shop's day, not the device's or the server's clock — so the server's
    // first render and the phone agree on "today" at any hour.
    const today = businessTodayIso();
    const [date, setDate] = useState(today);
    const [query, setQuery] = useState("");
    const list = useMobileList<DayRow>("/api/mobile/daybook", query, userId, { date });
    const sheet = useVoucherSheet();

    // Totals per kind over the vouchers on screen (posted only).
    const totals = new Map<string, { count: number; amount: number }>();
    for (const r of list.items) {
        if (r.status !== "POSTED") continue;
        const t = totals.get(r.kind) ?? { count: 0, amount: 0 };
        t.count += 1;
        t.amount += r.amount;
        totals.set(r.kind, t);
    }

    const summary = (
        <div className="space-y-3 border-b px-3 pb-3">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setDate(shiftDate(date, -1))} className="rounded-md border p-2 active:bg-muted" aria-label="Previous day">
                    <ChevronLeft className="size-5" />
                </button>
                <input
                    type="date"
                    value={date}
                    max={today}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="h-10 flex-1 rounded-md border bg-transparent px-3 text-center"
                    aria-label="Day"
                />
                <button
                    type="button"
                    onClick={() => setDate(shiftDate(date, 1))}
                    disabled={date >= today}
                    className="rounded-md border p-2 active:bg-muted disabled:opacity-40"
                    aria-label="Next day"
                >
                    <ChevronRight className="size-5" />
                </button>
            </div>
            {totals.size > 0 && (
                <div className="flex flex-wrap gap-2">
                    {[...totals.entries()].map(([kind, t]) => (
                        <span key={kind} className="rounded-full border px-3 py-1 text-xs">
                            {kind} ({t.count}) <span className="font-semibold">{formatInr(t.amount, 0)}</span>
                        </span>
                    ))}
                    {list.hasMore && <span className="px-1 py-1 text-xs text-muted-foreground">so far — load more for the rest</span>}
                </div>
            )}
        </div>
    );

    return (
        <>
            <MobileListScreen
                title="Day Book"
                placeholder="Party, voucher no. or narration"
                query={query}
                onQuery={setQuery}
                list={list}
                emptyText="No vouchers on this day."
                summary={summary}
            >
                {list.items.map((r) => {
                    const cancelled = r.status === "CANCELLED";
                    return (
                        <li key={r.id}>
                            <button
                                type="button"
                                onClick={() => r.uvId != null && sheet.open(r.uvId)}
                                className={`flex w-full items-start gap-3 px-3 py-3 text-left active:bg-muted ${cancelled ? "opacity-60" : ""}`}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className={`font-medium leading-snug ${cancelled ? "line-through" : ""}`}>
                                        {r.kind} <span className="font-normal text-muted-foreground">{r.ref}</span>
                                    </p>
                                    {r.party && <p className="truncate text-sm">{r.party}</p>}
                                    {r.narration && <p className="truncate text-xs text-muted-foreground">{r.narration}</p>}
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className={`font-semibold ${cancelled ? "line-through" : ""}`}>{formatInr(r.amount)}</p>
                                    {r.status !== "POSTED" && (
                                        <p className="text-xs text-muted-foreground">{cancelled ? "Cancelled" : "Draft"}</p>
                                    )}
                                </div>
                            </button>
                        </li>
                    );
                })}
            </MobileListScreen>
            {sheet.openId != null && <MobileVoucherSheet id={sheet.openId} userId={userId} onClose={sheet.close} />}
        </>
    );
}
