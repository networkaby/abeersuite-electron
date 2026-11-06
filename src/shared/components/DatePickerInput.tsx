"use client";

// A date box you can type into (TallyDateInput shorthand) or pick from a small
// calendar. Binds an ISO yyyy-mm-dd string. `rangeFrom` / `rangeTo` shade a
// period on the calendar so a From / Till pair reads as one span.

import { useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { TallyDateInput, type TallyDateInputProps } from "@/shared/components/TallyDateInput";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const monthName = (y: number, m: number) =>
    new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export interface DatePickerInputProps extends TallyDateInputProps {
    rangeFrom?: string;
    rangeTo?: string;
}

export function DatePickerInput({ value, onValueChange, rangeFrom, rangeTo, minIso, maxIso, className, ...rest }: DatePickerInputProps) {
    const [open, setOpen] = useState(false);
    const base = value || new Date().toISOString().slice(0, 10);
    const [view, setView] = useState({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) });

    const openAt = (o: boolean) => {
        if (o) { const b = value || base; setView({ y: Number(b.slice(0, 4)), m: Number(b.slice(5, 7)) }); }
        setOpen(o);
    };
    const step = (delta: number) => setView((v) => {
        const d = new Date(Date.UTC(v.y, v.m - 1 + delta, 1));
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    });

    const first = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
    const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => isoOf(view.y, view.m, i + 1))];

    return (
        <div className={`relative ${className ?? ""}`}>
            <TallyDateInput value={value} onValueChange={onValueChange} minIso={minIso} maxIso={maxIso} className="h-9 w-full pr-9 text-sm" {...rest} />
            <PopoverPrimitive.Root open={open} onOpenChange={openAt}>
                <PopoverPrimitive.Trigger asChild>
                    <button type="button" aria-label="Open calendar" className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <CalendarDays size={15} />
                    </button>
                </PopoverPrimitive.Trigger>
                <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Content align="start" sideOffset={6} className="z-50 w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                        <div className="mb-2 flex items-center justify-between">
                            <button type="button" aria-label="Previous month" className="rounded p-1 hover:bg-muted" onClick={() => step(-1)}><ChevronLeft size={15} /></button>
                            <span className="text-sm font-semibold">{monthName(view.y, view.m)}</span>
                            <button type="button" aria-label="Next month" className="rounded p-1 hover:bg-muted" onClick={() => step(1)}><ChevronRight size={15} /></button>
                        </div>
                        <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
                            {DOW.map((d, i) => <div key={i} className="py-1 text-[10px] text-muted-foreground">{d}</div>)}
                            {cells.map((iso, i) => {
                                if (!iso) return <div key={`b${i}`} />;
                                const off = (minIso && iso < minIso) || (maxIso && iso > maxIso);
                                const picked = iso === value;
                                const inRange = !!rangeFrom && !!rangeTo && iso >= rangeFrom && iso <= rangeTo;
                                return (
                                    <button
                                        key={iso}
                                        type="button"
                                        disabled={!!off}
                                        onClick={() => { onValueChange(iso); setOpen(false); }}
                                        className={`rounded-md py-1.5 tabular-nums ${picked ? "bg-primary font-semibold text-primary-foreground" : inRange ? "bg-primary/15" : "hover:bg-muted"} ${off ? "cursor-not-allowed opacity-30" : ""}`}
                                    >
                                        {Number(iso.slice(8))}
                                    </button>
                                );
                            })}
                        </div>
                    </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
        </div>
    );
}
