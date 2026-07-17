"use client";

import { useEffect, useState } from "react";

/** Returns a copy of `value` that only updates after it has stayed unchanged
 *  for `delayMs`. Used to throttle server search — keep the input state live
 *  for a responsive box, but fire the API call off the debounced value. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const id = window.setTimeout(() => setDebounced(value), delayMs);
        return () => window.clearTimeout(id);
    }, [value, delayMs]);

    return debounced;
}
