"use client";

// Pick a period: quick chips, a month stepper and From / Till date boxes with a
// calendar. The caller owns the dates and the chips (each knows its own range
// and whether it is the one in force), so any screen can reuse it.

import { useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Field } from "@/shared/components/Field";
import { DatePickerInput } from "@/shared/components/DatePickerInput";

export interface PeriodPreset {
    label: string;
    active: boolean;
    apply: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** First and last day of a month, the last held at `capIso` (e.g. today). */
export function monthPeriod(y: number, m: number, capIso?: string): { from: string; to: string } {
    const d = new Date(Date.UTC(y, m - 1, 1));
    const yy = d.getUTCFullYear(), mm = d.getUTCMonth() + 1;
    const last = `${yy}-${pad(mm)}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
    return { from: `${yy}-${pad(mm)}-01`, to: capIso && last > capIso ? capIso : last };
}

/** Days in an inclusive ISO range. */
export function periodDays(from: string, to: string): number {
    if (!from || !to || to < from) return 0;
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function PeriodPicker({ from, to, onChange, presets = [], monthCapIso }: {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
    presets?: PeriodPreset[];
    /** A month picked or stepped to stops here (e.g. today) — a month still
     *  running is taken up to that day. The date boxes themselves are free. */
    monthCapIso?: string;
}) {
    const y = Number(from.slice(0, 4)) || new Date().getFullYear();
    const m = Number(from.slice(5, 7)) || new Date().getMonth() + 1;
    const [pickYear, setPickYear] = useState(y);
    const [monthsOpen, setMonthsOpen] = useState(false);
    const go = (yy: number, mm: number) => { const p = monthPeriod(yy, mm, monthCapIso); onChange(p.from, p.to); };
    const nextBlocked = !!monthCapIso && monthPeriod(y, m + 1).from > monthCapIso;
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

    return (
        <div className="space-y-3">
            {presets.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {presets.map((p) => (
                        <button
                            key={p.label}
                            type="button"
                            onClick={p.apply}
                            aria-pressed={p.active}
                            className={`rounded-full border px-3 py-1 text-xs transition ${p.active ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-background hover:border-primary/50"}`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
                <Field label="Month">
                    {() => (
                        <div className="flex h-9 items-center rounded-md border border-input">
                            <button type="button" aria-label="Previous month" className="h-full px-2 text-muted-foreground hover:text-foreground" onClick={() => go(y, m - 1)}><ChevronLeft size={15} /></button>
                            <PopoverPrimitive.Root open={monthsOpen} onOpenChange={(o) => { if (o) setPickYear(y); setMonthsOpen(o); }}>
                                <PopoverPrimitive.Trigger asChild>
                                    <button type="button" className="flex min-w-36 items-center justify-center gap-1 text-sm font-medium">{label}<ChevronDown size={13} /></button>
                                </PopoverPrimitive.Trigger>
                                <PopoverPrimitive.Portal>
                                    <PopoverPrimitive.Content align="center" sideOffset={6} className="z-50 w-56 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                                        <div className="mb-2 flex items-center justify-between">
                                            <button type="button" aria-label="Previous year" className="rounded p-1 hover:bg-muted" onClick={() => setPickYear((v) => v - 1)}><ChevronLeft size={15} /></button>
                                            <span className="text-sm font-semibold">{pickYear}</span>
                                            <button type="button" aria-label="Next year" className="rounded p-1 hover:bg-muted" onClick={() => setPickYear((v) => v + 1)}><ChevronRight size={15} /></button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-1">
                                            {MONTHS.map((name, i) => {
                                                const off = !!monthCapIso && monthPeriod(pickYear, i + 1).from > monthCapIso;
                                                const on = pickYear === y && i + 1 === m;
                                                return (
                                                    <button key={name} type="button" disabled={off}
                                                        onClick={() => { go(pickYear, i + 1); setMonthsOpen(false); }}
                                                        className={`rounded-md py-1.5 text-sm ${on ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted"} ${off ? "cursor-not-allowed opacity-30" : ""}`}>
                                                        {name}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </PopoverPrimitive.Content>
                                </PopoverPrimitive.Portal>
                            </PopoverPrimitive.Root>
                            <button type="button" aria-label="Next month" disabled={nextBlocked} className="h-full px-2 text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => go(y, m + 1)}><ChevronRight size={15} /></button>
                        </div>
                    )}
                </Field>
                <Field label="From">
                    {(id) => <DatePickerInput id={id} value={from} onValueChange={(v) => onChange(v, to < v ? v : to)} rangeFrom={from} rangeTo={to} className="w-40" />}
                </Field>
                <Field label="Till">
                    {(id) => <DatePickerInput id={id} value={to} onValueChange={(v) => onChange(from > v ? v : from, v)} monthMode="end" rangeFrom={from} rangeTo={to} className="w-40" />}
                </Field>
            </div>
        </div>
    );
}
