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
}

export function TallyDateInput({ value, onValueChange, placeholder, inputMode, monthMode, ...rest }: TallyDateInputProps) {
    const { display, onChange, onBlur, onFocus, onKeyDown } = useTallyDate(value, onValueChange, monthMode);
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
