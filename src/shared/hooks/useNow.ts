"use client";

import { useEffect, useState } from "react";

/**
 * Current wall-clock time in milliseconds, captured so the render stays pure.
 * Calling `Date.now()` directly during render trips the React Compiler's
 * `react-hooks/purity` rule on compilable components.
 *
 * The initial value is computed once via a lazy `useState` initializer (the
 * canonical "compute once" spot — exempt from the purity rule, unlike a bare
 * `Date.now()` in render). Pass `intervalMs` to keep it ticking (e.g. live
 * countdowns); the interval updates state from a callback, which is allowed.
 */
export function useNow(intervalMs?: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!intervalMs) return;
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
