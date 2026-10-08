"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";
import AppBottomSheet from "@/modules/external/shopApp/AppBottomSheet";
import { APP } from "@/modules/external/shopApp/appPaths";
import { formatDate } from "@/shared/lib/format/formatDate";

/** ISO date (yyyy-mm-dd) `days` before `iso`. */
function minusDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

/** 1 April of the Indian financial year `iso` falls in, `back` years earlier. */
function fyStart(iso: string, back = 0): string {
    const [y, m] = iso.split("-").map(Number);
    return `${(m >= 4 ? y : y - 1) - back}-04-01`;
}

/**
 * The bills' period as a chip; tapping it opens a sheet of the usual choices
 * (this year, last year, 3 months, 30 days) plus From / To with the phone's own
 * date picker.
 */
export default function AppPeriodPicker({ fromIso, toIso, todayIso, tab }: { fromIso: string; toIso: string; todayIso: string; tab: string }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState(fromIso);
    const [to, setTo] = useState(toIso);

    const go = (f: string, t: string) => {
        setOpen(false);
        router.replace(`${APP}/bills?${new URLSearchParams({ tab, from: f, to: t })}`);
    };
    const presets = [
        { label: "This financial year", from: fyStart(todayIso), to: todayIso },
        { label: "Last financial year", from: fyStart(todayIso, 1), to: minusDays(fyStart(todayIso), 1) },
        { label: "Last 3 months", from: minusDays(todayIso, 91), to: todayIso },
        { label: "Last 30 days", from: minusDays(todayIso, 30), to: todayIso },
    ];
    const dateBox = "h-12 w-full rounded-xl border bg-background px-3 text-[15px]";

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs active:bg-muted">
                <CalendarDays className="size-3.5" />
                {formatDate(fromIso)} – {toIso === todayIso ? "today" : formatDate(toIso)}
                <ChevronDown className="size-3.5" />
            </button>
            <AppBottomSheet
                open={open}
                title="Show bills for"
                onClose={() => setOpen(false)}
                footer={
                    <button
                        type="button"
                        disabled={!from || !to || from > to}
                        onClick={() => go(from, to)}
                        className="h-12 w-full rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
                    >
                        Show
                    </button>
                }
            >
                <ul className="py-1">
                    {presets.map((p) => (
                        <li key={p.label}>
                            <button type="button" onClick={() => go(p.from, p.to)} className="w-full px-4 py-3.5 text-left text-[15px] active:bg-muted">
                                {p.label}
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="grid grid-cols-2 gap-3 border-t px-4 py-4">
                    <label className="space-y-1 text-xs text-muted-foreground">
                        From
                        <input type="date" value={from} max={todayIso} onChange={(e) => setFrom(e.target.value)} className={dateBox} />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                        To
                        <input type="date" value={to} max={todayIso} onChange={(e) => setTo(e.target.value)} className={dateBox} />
                    </label>
                </div>
            </AppBottomSheet>
        </>
    );
}
