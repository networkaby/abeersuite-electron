// Tally-style date input hook.
//
// Lets users type dates in shorthand and have them auto-expand to a full
// dd/mm/yyyy display on blur / Enter, while keeping an ISO `yyyy-mm-dd` value
// for form submission. Calendar year is used when missing (NOT financial year).
//
// Supported shorthand (see plan / test table for the canonical list):
//   t … today              → today  (any prefix of "today", case-insensitive)
//   y … yesterday          → yesterday  (any prefix of "yesterday")
//   +                      → tomorrow
//   -                      → yesterday
//   15                     → 15th of current month + year
//   23feb / 23 feb / 23FEB → day + month name (3-letter prefix), current year
//   23mar25                → day + month + 2-digit year (2000-2099)
//   15/4                   → dd/m, current year
//   15/4/25 · 15-4-25      → dd/m/yy with / or - separator
//   15/04/2025             → full dd/mm/yyyy
//   15042025               → DDMMYYYY (8 digits, no separators)
//   2026-04-15             → native ISO accepted
//
// Trigger: blur + Enter only. Invalid input keeps the raw text in the box and
// leaves the ISO value at the previous good date so callers don't need to
// special-case partial typing.

import { useCallback, useEffect, useRef, useState } from "react";

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** Build a Date guarding against rollover (e.g. Feb 31 → Mar 3). Returns null if y/m/d don't round-trip. */
function makeDate(y: number, m: number, d: number): Date | null {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
}

/** Resolve a month from a 3+ char lowercase prefix. Returns 1-12 or null. */
function monthFromPrefix(s: string): number | null {
    if (s.length < 3) return null;
    const prefix = s.slice(0, 3);
    const idx = MONTH_NAMES.indexOf(prefix as typeof MONTH_NAMES[number]);
    return idx >= 0 ? idx + 1 : null;
}

/** Expand a 2-digit year to a full year. Prototype rule: yy → 2000 + yy. */
function expandYear(raw: string): number {
    return raw.length === 2 ? 2000 + Number(raw) : Number(raw);
}

/** Parse a Tally-style shorthand into a Date. Returns null for any unrecognised input. */
export function parseTallyDate(input: string, today: Date = new Date()): Date | null {
    const s = input.trim().toLowerCase();
    if (!s) return null;

    // ── Literal commands ──
    // "today" and "yesterday" are matched by any non-empty prefix, case-
    // insensitive. So `t`, `to`, `tod`, … `today` all resolve to today; `y`
    // through `yesterday` all resolve to yesterday. `+` and `-` are explicit
    // single-char shortcuts kept for muscle memory.
    if ("today".startsWith(s)) return new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (s === "+") {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        d.setDate(d.getDate() + 1);
        return d;
    }
    if (s === "-" || "yesterday".startsWith(s)) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        d.setDate(d.getDate() - 1);
        return d;
    }

    // ── ISO yyyy-mm-dd (native input fallthrough) ──
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

    // ── dd<monthname>[yy|yyyy]?  (e.g. 23feb, 23 feb, 23mar25) ──
    const monAlpha = /^(\d{1,2})\s*([a-z]+)\s*(\d{2}|\d{4})?$/.exec(s);
    if (monAlpha) {
        const day = Number(monAlpha[1]);
        const month = monthFromPrefix(monAlpha[2]);
        if (month != null) {
            const year = monAlpha[3] ? expandYear(monAlpha[3]) : today.getFullYear();
            return makeDate(year, month, day);
        }
    }

    // ── dd[/-]m[/-]yy  or  dd[/-]mm[/-]yyyy ──
    const ddMmYy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
    if (ddMmYy) {
        const year = expandYear(ddMmYy[3]);
        return makeDate(year, Number(ddMmYy[2]), Number(ddMmYy[1]));
    }

    // ── dd[/-]m  (no year — use current year) ──
    const ddMm = /^(\d{1,2})[/-](\d{1,2})$/.exec(s);
    if (ddMm) return makeDate(today.getFullYear(), Number(ddMm[2]), Number(ddMm[1]));

    // ── DDMMYYYY (8 digits, no separators) ──
    if (/^\d{8}$/.test(s)) {
        return makeDate(Number(s.slice(4, 8)), Number(s.slice(2, 4)), Number(s.slice(0, 2)));
    }

    // ── Pure 1-2 digit: day of current month + year ──
    if (/^\d{1,2}$/.test(s)) {
        return makeDate(today.getFullYear(), today.getMonth() + 1, Number(s));
    }

    return null;
}

/** ISO yyyy-mm-dd from a Date, using local (not UTC) components. */
export function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Format an ISO yyyy-mm-dd as dd/mm/yyyy for display. Empty string in → empty out. */
export function isoToDisplay(iso: string): string {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso; // not ISO — pass through (e.g. partially typed)
    return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Hook that wires a text input to ISO-yyyy-mm-dd state with Tally-style
 * shorthand parsing on blur / Enter. Pass the current ISO `value` and an
 * `onValueChange` callback (called with the new ISO when parsing succeeds).
 *
 * Returns props to spread onto an <input> (or shadcn <Input>) plus the
 * current `display` string. Display defaults to dd/mm/yyyy; raw text is kept
 * verbatim while the user is typing.
 */
export function useTallyDate(value: string, onValueChange: (iso: string) => void): {
    display: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
} {
    const [display, setDisplay] = useState<string>(() => isoToDisplay(value));
    // `prevValue` (state, not a ref) detects prop changes during render.
    // React 19 forbids ref reads/writes during render, so we cannot store
    // the previous prop in a ref.
    const [prevValue, setPrevValue] = useState<string>(value);
    // `lastIso` mirrors the most-recently-emitted ISO so `commit` can dedupe
    // outbound onValueChange calls. Touched only in effects and event
    // handlers — never during render.
    const lastIso = useRef<string>(value);

    // Sync external value changes (e.g. parent resets the form) without
    // clobbering in-flight typing — only resync when the prop genuinely
    // changes away from what we last saw.
    if (value !== prevValue) {
        setPrevValue(value);
        setDisplay(isoToDisplay(value));
    }
    // Mirror the latest prop into `lastIso` so commit() dedupes against it.
    useEffect(() => { lastIso.current = value; }, [value]);

    const commit = useCallback(() => {
        const trimmed = display.trim();
        if (!trimmed) {
            if (lastIso.current !== "") {
                lastIso.current = "";
                onValueChange("");
            }
            return;
        }
        const parsed = parseTallyDate(trimmed);
        if (parsed) {
            const iso = toIsoDate(parsed);
            setDisplay(isoToDisplay(iso));
            if (iso !== lastIso.current) {
                lastIso.current = iso;
                onValueChange(iso);
            }
        }
        // Invalid: keep raw text, leave ISO at last good value
    }, [display, onValueChange]);

    return {
        display,
        onChange: (e) => setDisplay(e.target.value),
        onBlur: commit,
        // Tally-style: focusing the field selects its whole value so the user
        // can immediately type a replacement without manual Ctrl+A.
        onFocus: (e) => e.currentTarget.select(),
        onKeyDown: (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            }
        },
    };
}
