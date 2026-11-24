"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useValueChange } from "@/shared/hooks/useValueChange";

/** Wait before opening, so a mouse passing across the rail doesn't flash it open. */
const OPEN_DELAY_MS = 150;
/** Wait before closing, so a brief slip off the edge doesn't snap it shut. */
const CLOSE_DELAY_MS = 250;

/**
 * Hover-to-peek for a side panel in "hover" mode: the rail stays narrow in the
 * layout and floats open over the page while the mouse is on it.
 * `peeking` is always false when `enabled` is false.
 */
export function useHoverPeek(enabled: boolean) {
    const [peeking, setPeeking] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clear = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };

    const onMouseEnter = useCallback(() => {
        if (!enabled) return;
        clear();
        timer.current = setTimeout(() => setPeeking(true), OPEN_DELAY_MS);
    }, [enabled]);

    const onMouseLeave = useCallback(() => {
        clear();
        timer.current = setTimeout(() => setPeeking(false), CLOSE_DELAY_MS);
    }, []);

    // Leaving hover mode drops the peek — while rendering, not in an effect
    // (useValueChange), so no extra render. The effect only clears the timer.
    if (useValueChange(enabled) && !enabled && peeking) setPeeking(false);
    useEffect(() => clear, [enabled]);

    return { peeking: enabled && peeking, onMouseEnter, onMouseLeave };
}
