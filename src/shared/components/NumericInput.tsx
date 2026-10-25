// The one numeric text input for the whole app.
//
// House rule (AGENTS.md §2): never `<input type="number">`.
// The spinner steals the scroll wheel, paste breaks, and the browser silently
// blanks a value it dislikes instead of telling the user. So we render plain
// text, sanitise what is typed, and validate in code.
//
// This is a thin shell over the sanitisers that already run in ~84 places
// (`@/shared/lib/format/parseNumericInput`) — it does not invent a second set
// of parsing rules, it just gives them an input box and a `min`/`max` that we
// enforce on blur instead of the browser.
//
// The caller binds a string and gets a string back: the sanitised one while
// typing, the clamped one once focus leaves.
//
// Usage:
//   <NumericInput value={copies} onValueChange={setCopies} min={1} max={999} />
//   <NumericInput mode="decimal" value={amount} onValueChange={setAmount} min={0} />

"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { clampNumber, parseDecimalInput, parseDigitsInput, parseSignedInput } from "@/shared/lib/format";

type InputProps = React.ComponentProps<typeof Input>;

export interface NumericInputProps extends Omit<InputProps, "value" | "onChange" | "type" | "min" | "max"> {
    /** Current value as a string (empty string means nothing typed). */
    value: string | number;
    /** Called with the sanitised text while typing, and with the clamped text
     *  on blur / Enter. */
    onValueChange: (value: string) => void;
    /** "digits" for counts, days, occurrences. "decimal" for rupees and qty.
     *  "signed" for figures that may be negative. */
    mode?: "digits" | "decimal" | "signed";
    /** Lower bound, applied in code on blur. */
    min?: number;
    /** Upper bound, applied in code on blur. */
    max?: number;
}

const SANITISE = {
    digits: parseDigitsInput,
    decimal: parseDecimalInput,
    signed: parseSignedInput,
} as const;

export function NumericInput({ value, onValueChange, mode = "digits", min, max, inputMode, ...rest }: NumericInputProps) {
    const bound = value === null || value === undefined ? "" : String(value);
    const [draft, setDraft] = React.useState(bound);
    const [focused, setFocused] = React.useState(false);

    // While the field has focus the draft is the truth, so a half-typed "1."
    // survives. Once focus leaves, the caller's value wins again.
    const shown = focused ? draft : bound;

    const commit = React.useCallback(
        (raw: string) => {
            const cleaned = SANITISE[mode](raw);
            if (cleaned === "" || cleaned === "-" || cleaned === ".") {
                setDraft("");
                onValueChange("");
                return;
            }
            const n = Number(cleaned);
            const next = Number.isFinite(n) ? String(clampNumber(n, min, max)) : "";
            setDraft(next);
            onValueChange(next);
        },
        [mode, min, max, onValueChange],
    );

    return (
        <Input
            {...rest}
            type="text"
            value={shown}
            inputMode={inputMode ?? (mode === "digits" ? "numeric" : "decimal")}
            autoComplete="off"
            onFocus={(e) => {
                setDraft(bound);
                setFocused(true);
                rest.onFocus?.(e);
            }}
            onChange={(e) => {
                const next = SANITISE[mode](e.target.value);
                setDraft(next);
                onValueChange(next);
            }}
            onBlur={(e) => {
                setFocused(false);
                commit(e.target.value);
                rest.onBlur?.(e);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") commit(e.currentTarget.value);
                rest.onKeyDown?.(e);
            }}
        />
    );
}
