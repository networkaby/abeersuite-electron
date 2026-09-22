// Thin shadcn-styled wrapper around the Tally-style date hook.
//
// Caller binds an ISO `yyyy-mm-dd` string; the component renders a text input
// showing dd/mm/yyyy and parses shorthand on blur / Enter. Submit payloads are
// unchanged because the ISO value continues to flow through `onValueChange`.
//
// Usage:
//   <TallyDateInput value={form.date} onValueChange={(iso) => setForm(f => ({ ...f, date: iso }))} />
//
// See `useTallyDate.ts` for the full shorthand grammar.

"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { useTallyDate, type MonthMode } from "@/shared/hooks/useTallyDate";

type InputProps = React.ComponentProps<typeof Input>;

export interface TallyDateInputProps extends Omit<InputProps, "value" | "onChange" | "type"> {
    /** ISO yyyy-mm-dd (or empty string). */
    value: string;
    /** Called with the new ISO yyyy-mm-dd on blur / Enter when parsing succeeds. */
    onValueChange: (iso: string) => void;
    /** How a bare month name (e.g. "feb") resolves. Default "start" (1st of
     *  month) — fits single-date and "From" fields. Pass "end" on "To" fields
     *  so it resolves to the last day of the month instead. */
    monthMode?: MonthMode;
    /** Earliest / latest ISO date this field may hold. A date outside the bound
     *  is pulled to it rather than refused: the person sees what the rule allows
     *  instead of a box that will not take what they typed. The caller should
     *  say WHY on screen — a value that moves without explanation is worse than
     *  one that is rejected. Clamping happens after parsing, so the shorthand
     *  grammar is untouched. */
    minIso?: string;
    maxIso?: string;
}

export function TallyDateInput({ value, onValueChange, placeholder, inputMode, monthMode, minIso, maxIso, ...rest }: TallyDateInputProps) {
    const commit = React.useCallback((iso: string) => {
        if (iso && minIso && iso < minIso) return onValueChange(minIso);
        if (iso && maxIso && iso > maxIso) return onValueChange(maxIso);
        onValueChange(iso);
    }, [onValueChange, minIso, maxIso]);
    const { display, onChange, onBlur, onFocus, onKeyDown } = useTallyDate(value, commit, monthMode);
    return (
        <Input
            type="text"
            value={display}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            inputMode={inputMode ?? "text"}
            placeholder={placeholder ?? "dd/mm/yyyy"}
            autoComplete="off"
            {...rest}
        />
    );
}
