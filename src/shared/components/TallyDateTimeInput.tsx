// Tally-style date + time input.
//
// A thin composite over `TallyDateInput` (date, dd/mm/yyyy with shorthand) plus
// a native time field, bound to a single `datetime-local`-style string value
// `yyyy-MM-ddTHH:mm` (the same contract a raw `<input type="datetime-local">`
// produces), so callers and submit payloads stay unchanged.
//
// Empty value → both fields blank. Picking a date with no time defaults the
// time to 00:00; clearing the date clears the whole value. The time field is
// disabled until a date is present (a time alone is meaningless).
//
// Usage:
//   <TallyDateTimeInput value={dueDate} onValueChange={setDueDate} />

"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";

export interface TallyDateTimeInputProps {
    /** datetime-local string `yyyy-MM-ddTHH:mm` (or empty). */
    value: string;
    /** Called with the new combined `yyyy-MM-ddTHH:mm` string (or "" when the date is cleared). */
    onValueChange: (value: string) => void;
    /** Extra classes on the wrapping flex row. */
    className?: string;
    /** Extra classes forwarded to the date input. */
    dateClassName?: string;
    /** Extra classes for the time input (defaults to a fixed compact width). */
    timeClassName?: string;
    disabled?: boolean;
}

/** Split a `yyyy-MM-ddTHH:mm` value into its ISO date and `HH:mm` time parts. */
function splitValue(value: string): readonly [string, string] {
    if (!value) return ["", ""] as const;
    const t = value.indexOf("T");
    if (t === -1) return [value, ""] as const;
    return [value.slice(0, t), value.slice(t + 1, t + 6)] as const;
}

export function TallyDateTimeInput({
    value,
    onValueChange,
    className,
    dateClassName,
    timeClassName,
    disabled,
}: TallyDateTimeInputProps) {
    const [datePart, timePart] = splitValue(value);

    const emit = (date: string, time: string) => {
        if (!date) {
            onValueChange("");
            return;
        }
        onValueChange(`${date}T${time || "00:00"}`);
    };

    return (
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
            <div className="min-w-0 flex-1">
                <TallyDateInput
                    value={datePart}
                    onValueChange={(iso) => emit(iso, timePart)}
                    className={dateClassName}
                    disabled={disabled}
                />
            </div>
            <Input
                type="time"
                value={timePart}
                onChange={(e) => emit(datePart, e.target.value)}
                disabled={disabled || !datePart}
                aria-label="Time"
                className={timeClassName ?? "w-[120px] shrink-0"}
            />
        </div>
    );
}
