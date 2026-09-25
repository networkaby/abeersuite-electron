"use client";

// "Paid days a month" — the divisor a salary is built on, and what it works out
// to per day and per hour.
//
// Owner, 2026-09-22: *"salary is decided for 26 days as per gvt. rule"*, and the
// hourly price is *"(monthly salary / 26) / standard office hour"*. Both numbers
// are shown live beside the field, because 26 is not a number anybody should
// have to divide in their head to know what a day off or an extra hour costs.

import { Field } from "@/shared/components/Field";
import { NumericInput } from "@/shared/components/NumericInput";
import { formatRupeesFromPaise } from "@/shared/lib/format/moneyInr";
import { DEFAULT_DUTY_MINUTES, DEFAULT_PAY_DAYS } from "@/shared/lib/constants/hr";
import { payDaysOf, perDayPaise, perHourPaise } from "../lib/payrollProrate";

/** "₹615.38 a day · ₹68.38 an hour on a 9h duty" — empty until there is a gross. */
export function payRateHint(grossPaise: number, payDays: number, dutyMinutes: number | null | undefined): string {
    if (grossPaise <= 0) return "";
    const duty = dutyMinutes && dutyMinutes > 0 ? dutyMinutes : DEFAULT_DUTY_MINUTES;
    const hours = duty / 60;
    const perDay = formatRupeesFromPaise(Math.round(perDayPaise(grossPaise, payDays)));
    const perHour = formatRupeesFromPaise(Math.round(perHourPaise(grossPaise, payDays, duty)));
    const hoursLabel = Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
    return `${perDay} a day · ${perHour} an hour on a ${hoursLabel} duty`;
}

export default function PayDaysField({ value, onChange, grossPaise, dutyMinutes }: {
    /** What is typed, kept as text so the box can be emptied while editing. */
    value: string;
    onChange: (v: string) => void;
    grossPaise: number;
    dutyMinutes?: number | null;
}) {
    const n = Number(value);
    const bad = value.trim() === "" || !Number.isInteger(n) || n < 1 || n > 31;
    const hint = payRateHint(grossPaise, payDaysOf(bad ? DEFAULT_PAY_DAYS : n), dutyMinutes);

    return (
        <Field label="Paid days a month">
            {(id) => (
                <div className="space-y-1">
                    <NumericInput
                        id={id}
                        value={value}
                        onValueChange={onChange}
                        min={1}
                        max={31}
                        aria-invalid={bad}
                        aria-describedby={`${id}-hint`}
                        className="h-9 w-20 text-right text-sm tabular-nums"
                    />
                    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                        {bad
                            ? "Between 1 and 31 — 26 is the government month."
                            : `A month buys ${n} working days. ${hint}`}
                    </p>
                </div>
            )}
        </Field>
    );
}
